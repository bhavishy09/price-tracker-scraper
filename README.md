# INE Product Price Tracker

A full-stack app that tracks the price and stock of products on INE's hosted
mock store (<https://demo.inelabteamdev.com>) by scraping it on a 2-hour
schedule. The scraper is the heart of this project — see
[`DESIGN_NOTE.md`](./DESIGN_NOTE.md) for the reliability approach.

Built for the INE Software Engineer Intern Assignment.

---

## What it does

- **Search** the mock store by product name / brand / category / SKU.
- **Track** a product with one click — its metadata is persisted to Supabase.
- **Scrape on a schedule** — every 2 hours an external cron
  (`cron-job.org`) hits a secret-protected endpoint on the backend. The
  backend uses Playwright to drive a real Chromium browser that solves the
  site's anti-bot challenge + interaction gate, then reads the rendered
  price and stock off the DOM.
- **View price history** — a per-product chart of price + stock over time.
- **View scrape logs** — every attempt is recorded (success / retried /
  failed), with the failure reason shown verbatim. Failures are never hidden.

The scraper is reliable by construction: 3 outer attempts with backoff,
generous fixed waits for late-loading content, validation before saving,
and **never** writes null/zero/blank to `price_history` on failure.

---

## Tech stack

| Layer        | Choice                                   | Why                                            |
| ------------ | ---------------------------------------- | ---------------------------------------------- |
| Frontend     | React.js (Vite) on Vercel               | Fast to build; Vercel free tier is generous    |
| Backend      | Node.js + Express on Render              | Lightweight, Playwright-friendly                |
| Database     | Supabase (PostgreSQL)                    | Free managed Postgres with a usable dashboard  |
| Search       | Plain `fetch()` to INE's catalog JSON API | Recon confirmed catalog is unprotected JSON    |
| Price/stock  | Playwright (real Chromium)              | Price is behind a PoW challenge + interaction gate; cannot be done with fetch |
| Scheduling   | External cron via `cron-job.org`        | Render free tier sleeps when idle               |

See `DESIGN_NOTE.md` for the full evidence-based justification of
fetch-vs-Playwright.

---

## Repository layout

```
ine-tracker/
├── db/
│   └── schema.sql              # Supabase / Postgres schema (run once)
├── backend/                    # Express + Playwright scraper
│   ├── src/
│   │   ├── server.js           # Express entry point
│   │   ├── config.js           # Every env var in one place
│   │   ├── db/supabase.js      # Supabase client singleton
│   │   ├── services/
│   │   │   ├── catalog.js      # Plain fetch() to INE's catalog API
│   │   │   └── lock.js         # Scrape overlap lock
│   │   ├── scraper/
│   │   │   ├── scraper.js      # ★ THE CORE — Playwright scrape + retry
│   │   │   └── run-scrape.js   # Standalone CLI for isolation testing
│   │   └── routes/
│   │       ├── search.js
│   │       ├── trackedProducts.js
│   │       └── scrapeTrigger.js
│   ├── .env.example
│   ├── render-build.sh         # Installs Playwright + OS deps on Render
│   └── package.json
├── frontend/                   # React (Vite)
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── styles.css
│   │   ├── lib/{api,format}.js
│   │   └── components/         # One file per component, small + readable
│   ├── vite.config.js
│   ├── vercel.json
│   ├── .env.example
│   └── package.json
├── DESIGN_NOTE.md              # Reliability approach, trade-offs, AI failures
└── README.md                   # ← you are here
```

---

## Setup (local development)

### Prerequisites

- Node.js 18+
- A free [Supabase](https://supabase.com) project
- (Optional, for headed demo recording) a desktop OS with a display

### 1. Database — Supabase

1. Create a new Supabase project at <https://app.supabase.com>.
2. Open the SQL editor and paste in [`db/schema.sql`](./db/schema.sql).
3. Run it. You should see four tables (`tracked_products`, `price_history`,
   `scrape_logs`, `scrape_lock`) and one view (`latest_price_per_product`).
4. From *Project Settings → API*, copy the **Project URL** and the
   **service_role** key (NOT the anon key — the backend is a trusted server
   and must bypass RLS).

### 2. Backend — local

```bash
cd backend
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
npm install
# install Playwright Chromium once:
npx playwright install chromium
npm start          # http://localhost:3001
```

Generate a strong `CRON_SECRET`:

```bash
openssl rand -hex 32
```

Smoke test (no DB required):

```bash
curl http://localhost:3001/api/health
curl 'http://localhost:3001/api/search?q=domus'
```

### 3. Scraper — isolation test (no Express, no DB)

Run the scraper standalone against the real mock store to verify the
retry / backoff / validation / extraction logic works before wiring it
into the API:

```bash
# headless (default)
npm run scrape -- 921 36 459

# HEADED (visible browser — for the demo recording; needs a real display)
npm run scrape:headed -- 921
# or:
HEADLESS=false npm run scrape -- 921
```

Output is a JSON object per product showing outcome (`success` /
`retried` / `failed`), attempts made, price, stock, and any failure reason.

### 4. Frontend — local

```bash
cd frontend
npm install
npm run dev       # http://localhost:5173
```

Vite proxies `/api/*` to `http://localhost:3001` (see `vite.config.js`),
so you don't need to set `VITE_BACKEND_URL` for local dev.

---

## Deployment

### Backend → Render

1. Push the repo to GitHub.
2. On Render, create a new **Web Service** from the GitHub repo, with:
   - **Root Directory:** `backend`
   - **Build Command:** `bash render-build.sh`
   - **Start Command:** `npm start`
   - **Environment variables** (see below)
3. Render will assign a port via `PORT` automatically — don't set it.

The `render-build.sh` script installs Playwright Chromium **and** the OS
shared libraries it links against, which Render's base image is missing.

### Frontend → Vercel

1. On Vercel, import the same GitHub repo.
2. Set:
   - **Root Directory:** `frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Environment variable:** `VITE_BACKEND_URL=https://<your-render-url>`
3. Deploy. `vercel.json` already routes unknown paths to `index.html`
   so client-side routing works.

### Cron → cron-job.org

1. Sign up at <https://cron-job.org>.
2. Create a job:
   - **URL:** `https://<your-render-url>/api/scrape-trigger`
   - **Method:** `POST`
   - **Schedule:** every 2 hours (e.g. `0 */2 * * *`)
   - **Headers:** `X-Cron-Secret: <your CRON_SECRET value>`
3. Save. You can hit "Run now" to test before the next scheduled slot.

---

## Environment variables (complete list)

### Backend (`backend/.env`)

| Variable                       | Required | Description                                                            |
| ------------------------------ | -------- | ---------------------------------------------------------------------- |
| `SUPABASE_URL`                 | yes      | Supabase project URL, e.g. `https://abcd.supabase.co`                  |
| `SUPABASE_SERVICE_ROLE_KEY`    | yes      | Service role key (NOT anon). Backend is trusted, bypasses RLS.         |
| `CRON_SECRET`                  | yes      | Long random string. cron-job.org must send it in `X-Cron-Secret`.      |
| `INE_STORE_BASE_URL`           | no       | Default `https://demo.inelabteamdev.com`.                              |
| `INE_FETCH_TIMEOUT_MS`         | no       | Default `15000`. Per-catalog-fetch timeout.                            |
| `HEADLESS`                     | no       | `false` → run scraper headed (demo recording). Anything else → headless. |
| `SCRAPER_CONCURRENCY`          | no       | Default `1`. How many products to scrape in parallel. Keep at 1.       |
| `SCRAPE_STALE_AFTER_MINUTES`   | no       | Default `15`. If a run crashes without releasing the lock, the next run forcibly takes it after this long. |
| `CORS_ORIGINS`                 | no       | Default `*`. Comma-separated allowed origins. Lock down in production with auth. |
| `PORT`                         | no       | Default `3001`. Render injects this automatically.                     |
| `NODE_ENV`                     | no       | `production` for less verbose logging.                                 |

### Frontend (`frontend/.env`)

| Variable             | Required | Description                                              |
| -------------------- | -------- | -------------------------------------------------------- |
| `VITE_BACKEND_URL`   | no\*     | Backend URL. \*In local dev, leave blank — Vite proxies. In production, set to your Render URL. |

---

## Scraping schedule

- **Every 2 hours**, `cron-job.org` POSTs to `/api/scrape-trigger`.
- The endpoint checks the secret, then the overlap lock. If a previous
  run is still going, it skips cleanly and returns HTTP 409.
- Otherwise it launches one shared Playwright browser and scrapes every
  tracked product **sequentially** (concurrency = 1; the mock store is
  intentionally flaky under concurrent load).
- For each product:
  - 3 outer attempts with backoff (0s, 4s, 10s before attempts 1, 2, 3).
  - Each attempt: navigate → simulate the required 8+ mouse moves + 600ms+
    dwell on the price area → click "Reveal price" if needed → wait up to
    30s for `.price-block.price-success` (or `.price-block.price-error`).
  - Extract price + stock from the rendered DOM, skipping the honeypot
    `display:none` `.price-value` span. Validate `price > 0` and
    `stock >= 0` before declaring success.
- **On success/retried**: insert one `price_history` row + one `scrape_logs` row.
- **On failure**: insert ONLY a `scrape_logs` row with the honest reason.
  `price_history` is NEVER written on failure — the last known good price
  remains the latest data point.

---

## API reference

| Method & path                                | Description                                  |
| -------------------------------------------- | -------------------------------------------- |
| `GET  /api/health`                           | Liveness check. No auth.                     |
| `GET  /api/search?q=...`                     | Search INE's catalog by name/brand/category. |
| `POST /api/tracked-products`                 | Body: `{sourceProductId}`. Track a product.  |
| `GET  /api/tracked-products`                  | List all tracked products + latest price.    |
| `GET  /api/tracked-products/:id`             | Get one tracked product + latest price.      |
| `DELETE /api/tracked-products/:id`            | Untrack (cascades to history + logs).         |
| `GET  /api/tracked-products/:id/history`     | Price history rows (for the chart).           |
| `GET  /api/tracked-products/:id/logs`        | Scrape log rows (failures included).          |
| `GET  /api/scrape-trigger/status`            | Read-only lock status. No auth.              |
| `POST /api/scrape-trigger`                    | Run a scrape. **Requires `X-Cron-Secret`.**   |

---

## Headed demo recording

The required 2–4 minute screen recording shows the scraper running in headed
mode against the live mock store, including how it handles a slow/failing
response.

```bash
cd backend
HEADLESS=false npm run scrape -- 921 36 459
```

The console output prints each attempt, the backoff between attempts, the
final outcome (`success` / `retried` / `failed`), and the extracted price +
stock. The visible browser window shows the React SPA loading, the
simulated hover/mouse-move interaction on the price area, the "Reveal
price" button being clicked, and the price-block transitioning from
`price-idle` → `price-success` (or, on a real failure, `price-error`).

If a slow/failing moment doesn't occur naturally in one take, run the
scraper 3–5 more times — the mock store is intentionally flaky and will
eventually produce a real failure or slow load that the scraper handles
live.

---

## Project decisions worth knowing

- **No login/auth** — there is a single shared list of tracked products,
  per the assignment. CORS is `*` in dev; lock down to your Vercel URL
  in production.
- **Sequential scraping (concurrency = 1)** — the mock store is
  deliberately fragile under concurrent load. Sequential is slower but
  dramatically more reliable. This is the right trade-off for this
  assignment.
- **One shared browser per scrape-trigger run** — opening a browser per
  product would multiply cold-start cost. We launch once and create a
  fresh context per product (for cookie/session isolation).
- **Stock is an integer, not a boolean.** The site shows a count;
  `stock_quantity = 0` is "out of stock", anything else is "in stock".
- **Scrape log is append-only.** Failures are recorded honestly; the
  frontend renders them with red highlighting so they are impossible to
  miss.

---

## What I'd improve next (given more time)

In priority order (these are the bonus features from the spec, NOT
implemented in the current submission):

1. **Configurable per-product scrape frequency** — would require a
   `scrape_frequency_minutes` column + a smarter trigger that filters
   products due for scraping rather than always scraping all of them.
2. **Page-structure change detection** — hash the rendered HTML after
   scrape and compare to the last known hash; flag in `scrape_logs` if it
   changed.
3. **Price-drop / back-in-stock alerts** — SendGrid email on transition.
4. **CI/CD via GitHub Actions** — explicitly OUT OF SCOPE per the spec.
