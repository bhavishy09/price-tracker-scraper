# Design Note — INE Product Price Tracker

An engineering design document detailing:
1. How scraper reliability was achieved against an adversarial mock store.
2. Architectural trade-offs made and their rationales.
3. An honest account of what AI tools got wrong during implementation and how we corrected each issue.

---

## 1. How Scraping Reliability Was Achieved

The core challenge of this assignment is that the target mock store ([demo.inelabteamdev.com](https://demo.inelabteamdev.com)) is intentionally designed to simulate an adversarial e-commerce environment: prices change dynamically, network responses are intentionally throttled or error-prone, prices are protected behind client-side challenges and human interaction gates, and the rendered DOM employs several anti-scraping obfuscation techniques.

Every reliability mechanism is concentrated in [`backend/src/scraper/scraper.js`](./backend/src/scraper/scraper.js) and [`backend/src/scraper/browserHelper.js`](./backend/src/scraper/browserHelper.js).

### 1.1 Evidence-Based Architecture: `fetch()` vs. Playwright
Early network inspection revealed two distinct parts of the mock store:
- **Product Catalog & Search**: The `/api/products` endpoint returns plain, unencrypted JSON. For searching and tracking products, running a headless browser would waste substantial memory and add unnecessary latency. Therefore, search uses lightweight native `fetch()`.
- **Price & Stock Data**: On product detail pages, the price is not rendered in static HTML and is not available via simple REST calls. The client application executes a WebAssembly (WASM) Proof-of-Work (PoW) algorithm, collects cursor telemetry (`minMoves: 8`, `minDwellMs: 600`), exchanges this data for a session token, and decrypts the price into the DOM. Reverse-engineering the WASM binary in Node.js would be brittle; driving a real headless Chromium browser via Playwright is the robust, production-standard solution.

### 1.2 Bypassing the Human Interaction Gate
The mock store disables the "Reveal price" button until it registers authentic user interaction. In `scraper.js`, we simulate:
1. **Cookie Overlay Dismissal**: First checks for and dismisses any blocking cookie banners so pointer events are not intercepted.
2. **Cursor Telemetry Simulation**: Performs 14 discrete cursor movements (`INTERACTION_MOVE_COUNT = 14`) across the bounding box of the price area with small randomized steps (`INTERACTION_STEP_MS = 75ms`).
3. **Hover Dwell Time**: Pauses for 300ms (`POST_INTERACTION_DWELL_MS`) directly over the element before clicking, satisfying the store's minimum 600ms dwell threshold.

### 1.3 Accommodating Late-Loading Content & Internal Site Retries
The mock store's frontend implements its own internal retry loop (up to 6 retries with exponential backoff) before either displaying the price or rendering a failure message. Naive scrapers read the DOM immediately after clicking and extract placeholder text like *"Loading current price..."*.

Our scraper waits up to **30 seconds** (`PRICE_REVEAL_TIMEOUT_MS = 30000`) explicitly for either `.price-block.price-success` or `.price-block.price-error` to resolve. We only read data once the container has transitioned out of the pending state.

### 1.4 Defeating DOM Obfuscation & Character-Split Carriers
Inspection of the mock store's bundle revealed that it employs several DOM traps:
- **Honeypot Decoy Elements**: The markup contains decoy elements like `<span class="price-value" aria-hidden="true" style="display:none">` containing fake numbers. Naive selectors like `page.locator('.price-value')` grab these decoys. Our extraction inspects computed styles and filters out any element with `display: none`, `visibility: hidden`, or `aria-hidden="true"`.
- **Character-Split Carriers**: When `priceCarrier === "split"`, the mock store splits price digits across individual `<span>` tags separated by zero-width spaces (`\u200b`):
  ```html
  <div class="pv-k2">
    <span>₹​</span><span>1​</span><span>6​</span><span>,​</span><span>2​</span><span>4​</span><span>4</span>
  </div>
  ```
  Grabbing the first matching `span` extracts only `1`, resulting in products being incorrectly parsed as ₹1. Our extractor targets the parent container, gathers all child spans, and reads the unified string.
- **Unicode & Number Formatting Normalization**: The store randomizes between European formatting (`16.244,00`), fullwidth Unicode digits (`１６,２４４`), space delimiters (`16 244`), and Indian Lakh notation (`Rs. 16,244.00`). We apply `rawText.normalize('NFKC')` to transform fullwidth digits to standard ASCII and normalize formatting before parsing.

### 1.5 Outer Retry Policy with Exponential Backoff
For transient network dropouts, 502 errors, or context stalls, each product is given up to **3 outer attempts** with progressive backoff (0s before attempt 1, 4s before attempt 2, 10s before attempt 3). Each attempt operates within a freshly spawned browser context to ensure no leaked state, stale cookies, or stuck workers persist.

### 1.6 Strict Validation Guard & Honest Logging
Before any scraped data is accepted, `validateScrapedValues(price, stock)` verifies that:
- `price` is a valid positive number (`price > 0`), falls below sanity caps (`< 1,000,000`), and specifically is not an accidental single-digit parse (`price >= 10`).
- `stock` is an integer `>= 0`.

If validation fails, the attempt is marked as failed. **`price_history` is NEVER written on failure.** Only genuine, successful scrapes create historical price points, ensuring charts are never corrupted with null or 0. Meanwhile, every attempt (success, retried, or failed) is recorded in `scrape_logs` with honest, verbatim error messages for complete transparency.

---

## 2. Trade-offs Made

| Decision | Trade-off | Engineering Rationale |
| :--- | :--- | :--- |
| **Playwright Chromium vs. Pure HTTP** | Higher memory consumption (~200MB) and slower execution (~3–5s per item) compared to raw HTTP (~50ms). | Mandatory because prices are gated behind client-side WebAssembly PoW and canvas/mouse interaction telemetry. |
| **Sequential Scraping (`concurrency = 1`)** | Scraping 10 products takes ~30–45 seconds instead of 5 seconds. | The mock store becomes unstable and returns elevated rate-limit errors under parallel load. Reliability and clean data take priority over raw throughput. |
| **3 Outer Attempts (instead of 5+)** | Potential failure if a prolonged store outage lasts over 1 minute. | Avoids runaway execution times that could trigger cloud serverless and PaaS HTTP timeout limits. |
| **External Cron (`cron-job.org`) vs. Internal Loop** | Requires configuring an external service webhook. | Essential for free-tier cloud PaaS (Render). Internal `setInterval` loops die when free containers go idle after 15 minutes. |
| **Supabase Lock Table vs. Postgres Advisory Locks** | Relies on a stale-timeout check (`stale_after_minutes: 15`) if a container dies mid-scrape. | The `scrape_lock` table is transparent, observable, and directly editable/debuggable within the Supabase dashboard without needing active database connection sessions. |

---

## 3. What AI Tools Got Wrong on the First Attempt & How We Corrected It

During the pair-programming and development lifecycle of this project, AI assistants proposed several initial solutions that failed in subtle or critical ways when tested against real systems. Documenting these specific failures and how we engineered the corrections highlights the value of critical oversight.

### 3.1 Mistake: Falling Directly into the Honeypot Trap
- **What the AI did**: When instructed to extract the price, the AI wrote:
  ```javascript
  const priceText = await page.locator('.price-value').innerText();
  ```
- **Why it failed**: The mock store specifically creates an invisible decoy element:
  ```html
  <span class="price-value" aria-hidden="true" style="display:none">742</span>
  ```
  The AI's selector grabbed this hidden element. Because `742` looked like a plausible integer, the scraper silently extracted completely incorrect prices without throwing any runtime error.
- **The Correction**: We inspected the actual DOM hierarchy and replaced the selector with logic that evaluates computed CSS styles (`getComputedStyle`), explicitly filtering out any elements with `display: none`, `visibility: hidden`, or `aria-hidden="true"`.

### 3.2 Mistake: The Single-Digit "₹1" Split-Carrier Bug
- **What the AI did**: To bypass the honeypot, the AI revised the scraper to iterate over all visible `<span>` elements and pick the first one matching a digit:
  ```javascript
  const span = spans.find(s => /\d/.test(s.textContent));
  ```
- **Why it failed**: The mock store dynamically uses `priceCarrier === "split"`, slicing formatted prices into individual single-character `<span>` tags separated by zero-width spaces (`\u200b`):
  ```html
  <div class="pv-k2">
    <span>₹​</span><span>1​</span><span>6​</span><span>,​</span><span>2​</span><span>4​</span><span>4</span>
  </div>
  ```
  The first matching span was literally `<span>1​</span>`. The parser extracted `"1\u200b"`, stripped non-digits, and stored `₹1` for a product that cost `₹16,244`.
- **The Correction**: We shifted from matching child `<span>` elements to targeting the containing price element (`.pv-k2` or `style*="2.4rem"`). We read the parent's full `textContent`, stripped all zero-width spaces (`\u200b`), applied Unicode NFKC normalization, and added a validation assertion rejecting any price `< 10`.

### 3.3 Mistake: Invoking `sudo` in Render's Build Environment
- **What the AI did**: In `backend/render-build.sh`, the AI generated:
  ```bash
  npx playwright install --with-deps chromium
  ```
- **Why it failed**: In cloud hosting environments like Render, build scripts run as non-root users without `sudo` privileges. The `--with-deps` flag attempted to invoke `sudo apt-get`, immediately failing the deploy with:
  ```text
  Password: su: Authentication failure
  Error: Installation process exited with code: 1
  ```
- **The Correction**: We removed `--with-deps` from the build script and configured `export PLAYWRIGHT_BROWSERS_PATH=0`. This tells Playwright to download Chromium into `node_modules/playwright-core/.local-browsers` (which Render's filesystem preserves across builds). We also created a self-healing launcher in [`browserHelper.js`](./backend/src/scraper/browserHelper.js) that checks for the binary on-demand and downloads it automatically if missing.

### 3.4 Mistake: Express CORS Array Literal Trap
- **What the AI did**: In `backend/src/server.js`, the AI configured CORS using:
  ```javascript
  app.use(cors({ origin: ['*'] }));
  ```
- **Why it failed**: In the npm `cors` package, passing `origin: '*'` as a string enables wildcard access, but passing `origin: ['*']` as an array causes the middleware to search for an exact literal match against the incoming request's `Origin` header. Because requests from Vercel send `Origin: https://price-tracker-scraper-....vercel.app`, the array lookup failed and the server omitted the `Access-Control-Allow-Origin` header, causing browser preflight blocks.
- **The Correction**: We refactored the CORS configuration to use a dynamic function that inspects the request origin, validates wildcards correctly, and responds with appropriate credentials and preflight handling.

### 3.5 Mistake: PostgreSQL Foreign Key Data Type Mismatch
- **What the AI did**: When adding the schema for notifications, the AI generated:
  ```sql
  create table notifications (
    id bigserial primary key,
    tracked_product_id bigint not null references tracked_products(id) on delete cascade,
    ...
  );
  ```
- **Why it failed**: In `tracked_products`, the primary key `id` was defined as a `uuid`. PostgreSQL strictly forbids foreign keys between incompatible types (`bigint` referencing `uuid`), causing the Supabase migration to crash with:
  ```text
  ERROR 42804: Key columns "tracked_product_id" and "id" are of incompatible types: bigint and uuid.
  ```
- **The Correction**: We updated `tracked_product_id` in `notifications` to `uuid`, aligning it with `price_history` and `scrape_logs`.

---

## 4. Summary & Verification

Through these iterations, the tracker balances:
1. **High resilience**: Defends against honeypots, character-split carriers, PoW computation, and interaction gates.
2. **Honest observability**: Records every attempt with transparent diagnostics, never fabricating or zeroing out price points on failure.
3. **Reliable cloud execution**: Seamlessly coordinates external crons on `cron-job.org`, headless browser automation on Render, relational integrity on Supabase, and a reactive frontend on Vercel.
