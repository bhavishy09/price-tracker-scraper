# INE Product Price Tracker

A robust full-stack application that monitors product prices and inventory on INE's intentionally challenging mock store ([demo.inelabteamdev.com](https://demo.inelabteamdev.com)). Built with an emphasis on scraper reliability, honest diagnostic observability, and resilience against real-world anti-bot techniques.

Built for the **INE Software Engineer Intern Assignment**.

---

## Live Deployments

- **Frontend (Vercel)**: [https://price-tracker-scraper-ohswku54i-bhavishy2.vercel.app](https://price-tracker-scraper-ohswku54i-bhavishy2.vercel.app)
- **Backend API (Render)**: [https://ine-price-tracker-backend-l401.onrender.com](https://ine-price-tracker-backend-l401.onrender.com)
- **Target Mock Store**: [https://demo.inelabteamdev.com](https://demo.inelabteamdev.com)

---

## Core Capabilities

- **Search without Scraping Overhead**: Rapidly searches INE's catalog by product name, brand, or category using lightweight HTTP requests to the unprotected catalog JSON API.
- **Resilient Playwright Scraping**: Price and stock are protected by client-side WebAssembly Proof-of-Work (PoW) challenges and a human interaction gate (requiring cursor movements and dwell time). The scraper uses real headless Chromium to solve these challenges reliably.
- **Never Stores Corrupt Data**: If a scrape fails or times out, the failure is recorded verbatim in the `scrape_logs` table. `price_history` is **never** written with null, zero, or placeholder prices — the last known good price remains active.
- **Scheduled & On-Demand Triggers**: Runs automatically every 2 hours via external cron (`cron-job.org`). Also supports manual "Scrape" triggers per product directly from the UI.
- **Configurable Frequencies**: Users can tune scrape frequency per product (`Every 30m`, `Every 1h`, `Every 2h`, `Every 6h`).
- **Interactive Price & Stock Charts**: Visual timeline charts built with Recharts showing price shifts alongside inventory levels over time.
- **Multi-Channel Alerting**:
  - **In-App Badges**: Clear badges for price drops (`▼ Price drop (-₹X)`) and back-in-stock items.
  - **In-App Notification Bell**: Dropdown feed tracking price drops, price increases, and restocks with one-click dismissal.
  - **Email Alerts (SendGrid)**: Asynchronous email dispatches for price drops, price increases, and restocks.
- **Transparent Diagnostics**: Every single attempt (successful, retried, or failed) is visible with its execution duration, attempt count, and exact error reason in the scrape log table.

---

## Tech Stack & Architectural Rationale

| Layer | Technology | Engineering Rationale |
| :--- | :--- | :--- |
| **Frontend** | React (Vite) on Vercel | Clean component separation, responsive design system, and fast client-side routing with `vercel.json` rewrites. |
| **Backend** | Node.js + Express on Render | Lightweight server driving headless Playwright Chromium. |
| **Database** | Supabase (Managed PostgreSQL) | Relational persistence for tracked products, price history, transparent scrape logs, and concurrency locks. |
| **Catalog Search** | Native `fetch()` | Direct JSON queries to `/api/products`. Zero browser overhead for search. |
| **Price & Stock Extraction** | Playwright Chromium | Solves WASM PoW challenges, simulates cursor telemetry, and de-obfuscates character-split DOM carriers. |
| **Automated Scheduling** | External Cron (`cron-job.org`) | Bypasses free-tier PaaS sleep cycles by triggering webhook scrapes externally. |
| **Email Alerts** | SendGrid API | Non-blocking, isolated email alerts with strict timeouts. |

---

## Scraping Schedule & Lifecycle

### 1. The 2-Hour Automated Cycle
Free-tier hosting platforms (such as Render) spin down container instances after 15 minutes of inactivity. Rather than relying on a fragile internal `setInterval` loop that dies when the instance sleeps, scheduling is driven externally:
- **`cron-job.org`** sends a `POST` request to `/api/scrape-trigger` every 2 hours (`0 */2 * * *`).
- The request includes an `X-Cron-Secret` header matching the backend's `CRON_SECRET`.
- When received, the backend acquires a mutual exclusion lock (`scrape_lock` table) to prevent overlapping runs.
- The scraper iterates through tracked products sequentially (concurrency = 1) to respect the mock store's rate limits.
- For each product, the backend checks whether `next_scrape_due_at <= now()`. If not yet due, it skips cleanly; if due, it scrapes and advances the schedule by `scrape_interval_minutes`.

### 2. Manual On-Demand Scraping
Users can click **"Scrape"** on any product row in the dashboard or detail view. This immediately fires an isolated headless run for that specific product, updates its latest price, logs the attempt, and checks for price drop/increase alerts.

### 3. Keeping Free Instances Warm (Optional)
To avoid 30–50 second cold starts when opening the web app, a secondary 10-minute ping job on `cron-job.org` hits `GET /api/health`. Because `/api/health` performs no database or browser work, it consumes virtually zero resources while keeping the backend container awake.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `PORT` | No | `3001` | Local port. Injected automatically by Render in production. |
| `NODE_ENV` | No | `development` | Set to `production` in production environments. |
| `SUPABASE_URL` | **Yes** | — | Supabase Project URL (e.g. `https://xxxx.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | — | Supabase `service_role` secret key (bypasses RLS). |
| `CRON_SECRET` | **Yes** | — | Shared secret token. Must match `X-Cron-Secret` in cron-job.org. |
| `INE_STORE_BASE_URL` | No | `https://demo.inelabteamdev.com` | Base URL of the mock store. |
| `INE_FETCH_TIMEOUT_MS` | No | `15000` | Timeout for catalog search API requests. |
| `HEADLESS` | No | `true` | `false` enables headed browser mode (useful for demo video recordings). |
| `SCRAPER_CONCURRENCY` | No | `1` | Number of simultaneous browser scrapes (keep at 1 for stability). |
| `SCRAPE_STALE_AFTER_MINUTES` | No | `15` | Timeout after which a locked scrape is considered crashed and released. |
| `CORS_ORIGINS` | No | `*` | Allowed origins (e.g. `https://your-app.vercel.app` or `*`). |
| `SENDGRID_API_KEY` | No | — | SendGrid API key for email alerts. |
| `ALERT_EMAIL` | No | — | Target email address to receive price drop/increase alerts. |
| `SENDGRID_FROM_EMAIL` | No | `alerts@ine-tracker.local` | Verified sender email in your SendGrid account. |
| `PLAYWRIGHT_BROWSERS_PATH` | No | `0` | Forces Playwright to store browsers in `node_modules` for container persistence. |

### Frontend (`frontend/.env`)

| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `VITE_BACKEND_URL` | No* | `""` | Base URL of your backend. Leave blank in local dev (Vite proxies `/api`). Set to your Render URL in production (e.g. `https://ine-price-tracker-backend-l401.onrender.com`). |

---

## Local Development Setup

### 1. Database Setup (Supabase)
1. Create a free project at [supabase.com](https://supabase.com).
2. Navigate to the **SQL Editor** tab.
3. Open [`db/schema.sql`](./db/schema.sql), copy the entire SQL script, paste it into the editor, and click **Run**.
4. Go to **Project Settings** → **API**:
   - Copy **Project URL**.
   - Copy the **`service_role`** key under *Project API Keys*.

### 2. Backend Setup
```bash
cd backend
cp .env.example .env
# Edit .env with your SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CRON_SECRET

npm install
npx playwright install chromium
npm start
```
The server will run at `http://localhost:3001`. Verify with:
```bash
curl http://localhost:3001/api/health
```

### 3. Standalone Scraper CLI (Isolation Testing)
You can test the scraper against specific mock store product IDs without running Express or Supabase:
```bash
# Headless scrape
npm run scrape -- 921 41 201

# Headed mode (visible browser window for inspection/recording)
npm run scrape:headed -- 921
```

### 4. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## Production Deployment Guide

### 1. Backend on Render
1. Create a **New Web Service** from your GitHub repository.
2. Configure settings:
   - **Root Directory**: `backend`
   - **Runtime**: `Node`
   - **Build Command**: `bash render-build.sh`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
3. Add Environment Variables:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `NODE_ENV=production`, `HEADLESS=true`, `PLAYWRIGHT_BROWSERS_PATH=0`
   - Optional SendGrid vars: `SENDGRID_API_KEY`, `ALERT_EMAIL`, `SENDGRID_FROM_EMAIL`.
4. Deploy and copy your assigned URL (e.g. `https://ine-price-tracker-backend-l401.onrender.com`).

### 2. Frontend on Vercel
1. Import your GitHub repository in Vercel.
2. Configure settings:
   - **Root Directory**: `frontend`
   - **Framework Preset**: `Vite`
3. Under **Environment Variables**, add:
   - `VITE_BACKEND_URL` = `https://<your-render-backend-url>.onrender.com` (no trailing slash).
4. Deploy.

### 3. Automated Cron on `cron-job.org`
1. Create a new cron job on [cron-job.org](https://cron-job.org).
2. Set:
   - **URL**: `https://<your-render-backend-url>.onrender.com/api/scrape-trigger`
   - **Schedule**: Every 2 hours (`0 */2 * * *`)
   - **Method**: `POST`
   - **Header**: `X-Cron-Secret: <your CRON_SECRET value>`
   - **Timeout**: `60` or `120` seconds.

---

## Headed Demo Recording Instructions

To record the 2–4 minute demo showing real-time Playwright automation handling late loading and interaction gates:
```bash
cd backend
HEADLESS=false npm run scrape -- 921 41 201
```
The browser window will open on your desktop, demonstrating:
1. Automated cookie banner dismissal.
2. Simulated cursor movements and dwell time on the price block to pass the telemetry gate.
3. Clicking the "Reveal price" button.
4. Waiting for WASM PoW computation and loading state resolution.
5. Accurate extraction of clean price and stock values printed to stdout.
