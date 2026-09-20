# Assignment 1: Web Scraping & Architecture Investigation Report

**Target Website:** `https://demo.inelabteamdev.com`  
**Date of Investigation:** September 20, 2026  
**Investigator:** Antigravity Pairing Agent  

---

## Executive Summary

An in-depth investigation of `https://demo.inelabteamdev.com` was conducted using automated browser sessions, DOM inspections, network traffic analysis, and JavaScript bundle reverse-engineering.

### Key Takeaways:
1. **HTML Delivery:** The website is a client-side Single Page Application (SPA) built with React and Vite. The initial HTML document is a skeletal shell (`<div id="root"></div>`) containing zero product, price, or inventory data.
2. **JavaScript Data Loading:** All product data is fetched dynamically via JavaScript using asynchronous `fetch()` calls after the client app boots in the browser.
3. **Network Architecture:**
   - Catalog data is retrieved from `/api/catalog?page={page}&pageSize={pageSize}`.
   - Individual product specifications and reviews are retrieved from `/api/product/{id}`.
   - The endpoints `/api/products` (returns `404 Not Found`) and `/products` (serves the SPA `index.html`) do not serve product JSON.
4. **Target JSON Structure `{ "name": "Nike Shoe", "price": 2499, "stock": true }`:**
   - **Does NOT exist.**
   - All products are fictional brands (e.g., *Nordkraft*, *Copperpot*, *Meridian*, *Larkspur*).
   - Price and stock are decoupled from catalog and product endpoints.
   - Price and stock are protected behind an anti-bot Proof-of-Work (PoW) and WebAssembly challenge (`/api/challenge` and `/api/session`), then returned encrypted via `/api/products/{id}/price`.
   - Once decrypted, `stock` is an integer quantity (`stock: 14`), not a boolean (`true`/`false`).
5. **Resilience & Error States:** The application includes granular UI states for initial loading, anti-bot dwell delays, animated spinners, automated retries (up to 6 attempts), detailed error diagnostics, and retry buttons.

---

## Detailed Investigation & Findings

### 1. Does product data appear directly in the HTML?

**Finding: NO.**

When sending a raw HTTP GET request to `https://demo.inelabteamdev.com/`, the server returns only 459 bytes of boilerplate HTML:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>INE Store</title>
    <script type="module" crossorigin src="/assets/index-B9UiQq4X.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-DrctpSuy.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

- No product titles, prices, descriptions, images, or stock levels exist in the initial HTML response.
- Standard web scrapers relying strictly on HTTP GET without JavaScript execution (such as simple cURL, standard Cheerio, BeautifulSoup, or requests without headless browsers) will only see an empty `<div id="root"></div>`.

---

### 2. Is the data loaded using JavaScript?

**Finding: YES.**

- The page loads Vite/React bundles (`/assets/index-B9UiQq4X.js` and `/assets/index-DrctpSuy.css`).
- Once loaded, React mounts into `<div id="root"></div>`.
- A series of asynchronous JavaScript `fetch()` requests are triggered from `useEffect` hooks to fetch data from API endpoints and dynamically construct the DOM nodes for product cards, details, reviews, and pricing blocks.

---

### 3. DevTools Network Tab Analysis & Endpoints

Filtering network activity for API and JSON requests reveals the following architecture:

| Endpoint | Method | Status | Purpose & Response Schema |
| :--- | :--- | :--- | :--- |
| `/api/layout` | GET | 200 OK | Storefront layout settings, features, and styling configuration. |
| `/api/catalog?page=1&pageSize=20` | GET | 200 OK | Paginated list of products: `id`, `slug`, `name`, `brand`, `category`, `sku`, `description`. **Note: Does NOT include prices or stock.** |
| `/api/product/:id` | GET | 200 OK | Detailed view of a single product: specs (warranty, country of origin, weight, material) and user reviews. **Note: Does NOT include prices or stock.** |
| `/api/products` | GET | 404 Not Found | Returns `{"error": "not_found"}`. |
| `/products` | GET | 200 OK | Serves the SPA HTML shell (`index.html`) via client-side routing fallback. |
| `/api/challenge` | GET | 200 OK | Anti-bot challenge returning `salt`, `ts`, `difficulty`, `csig`, and a compiled `wasm` binary. |
| `/api/session` | POST | 200 OK | Submits computed PoW nonce, WebAssembly execution output, and browser interaction telemetry to obtain a temporary Bearer session token. |
| `/api/products/:id/price` | GET | 200 OK / 401 | Requires `Authorization: Bearer <token>`. Returns an encrypted payload `{ "e": "<ciphertext>" }`. Direct unauthenticated requests return `401 Unauthorized`. |

---

### 4. Check for `{ "name": "Nike Shoe", "price": 2499, "stock": true }`

**Finding: The browser does NOT call an API returning this structure.**

#### Comparison:

| Field | User Prompt Expectation | Actual API & Application Reality |
| :--- | :--- | :--- |
| **Product Name** | `"Nike Shoe"` | Products are fictional store brands (e.g. *Nordkraft Headphones Pro*, *Meridian Bridge Hub Air*, *Helix Hiking Boot S*, *Vista Field Watch Pro*). |
| **Price Location** | Directly in product JSON | Decoupled into a dedicated `/api/products/:id/price` endpoint. |
| **Price Format** | Plain integer/number | Delivered as encrypted ciphertext `{ "e": "..." }`, decrypted client-side via XOR key derived from session token. Decrypted key is `p` (shown price) and formatted as INR currency (e.g. `₹2,499`). |
| **Stock Format** | Boolean (`stock: true`) | Decrypted stock is an **integer count** (e.g., `s: 14`), not a boolean. The UI renders dynamic badges such as `"In stock · 14 left"` when `stock > 0`, or `"Out of stock"` when `stock <= 0`. |

#### Decrypted Price Object Schema (`wr()` function):
```json
{
  "p": 2499,
  "m": 3499,
  "n": 2299,
  "b": 28,
  "s": 14,
  "c": "INR",
  "t": 1789891045000,
  "r": 4.5,
  "rc": 128,
  "sl": "Verified Seller",
  "dd": 3,
  "v": "Standard",
  "g": 0,
  "f": "standard",
  "x": 0
}
```
*Key mapping: `p` = shown price, `m` = MRP, `n` = sale price, `b` = badge discount %, `s` = stock count, `c` = currency, `t` = timestamp, `r` = rating, `rc` = rating count, `dd` = delivery days.*

---

### 5. Behavior Under Slow Network or Failure Conditions

The frontend codebase (`index-B9UiQq4X.js`) implements comprehensive handling for slow networks, interaction gating, and network errors:

#### A. Catalog & Product Detail Pages:
- **Loading State:** Displays `<div class="grid-empty">Loading products…</div>` or `"Loading product details…"`.
- **Failure State:** If network drops or the server returns an error status (e.g. 500), an error banner renders:
  ```html
  <div class="grid-empty grid-error">Couldn’t load products: [Error Message]</div>
  ```

#### B. Price Interaction & Anti-Bot Dwell Delays:
- **Idle / Interaction Gating:** Price is initially hidden. The `"Reveal price"` button is `disabled` until the user interacts with the price box:
  - User must hover inside the price container for at least **600ms** (`minDwellMs: 600`).
  - User must record at least **8 mouse movements** (`minMoves: 8`).
  - Dynamic helper messages:
    - `"Hover over the price area to load the current price."`
    - `"Hold on — checking availability…"`
- **Loading & Retry Feedback:**
  - Shows an animated SVG/CSS spinner (`<div class="spinner"></div>`).
  - Screen reader announcement (`aria-live="polite"`, `aria-busy="true"`).
  - Status text: `"Loading current price…"`.
  - **Automatic Retries:** If transient errors or 429 rate limits occur, the client automatically retries up to **6 attempts** with exponential backoff:
    ```
    "Retrying (attempt 2/6)… Store responded with “challenge_failed”."
    ```
- **Terminal Error State:**
  - If all 6 attempts fail or authentication is rejected (HTTP 401/403):
  - Renders `<div class="price-block price-error">`.
  - Displays:
    ```
    Couldn’t load the price after 6 attempts.
    [Specific error reason]
    [Try again button]
    ```
  - Users can click `"Try again"` to restart the challenge and price retrieval lifecycle.
