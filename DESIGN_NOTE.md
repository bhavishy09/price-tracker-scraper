# Design Note — INE Product Price Tracker

This note explains (1) how the scraper was made reliable, (2) the
trade-offs I made and why, and (3) — honestly — what the AI coding tools
got wrong on the first attempt and how I corrected each mistake.

---

## 1. How reliability was achieved

The single most important file in this codebase is
`backend/src/scraper/scraper.js`. Every reliability decision is concentrated
there, with constants grouped at the top so they're easy to find and
explain in an interview.

### 1.1 Evidence-based choice of fetch vs. Playwright

Recon on the real site (see `INE_Project_Understanding.pdf`) confirmed:

- Catalog data is plain JSON at `/api/catalog` and `/api/product/:id`. →
  Search uses plain `fetch()`. No browser needed.
- Price/stock require solving a **proof-of-work challenge** (including a
  WebAssembly module), exchanging the PoW output + browser interaction
  telemetry for a **session token**, and **decrypting** the price payload
  using a key tied to that session. → A plain HTTP client cannot do this.
- The site additionally gates the "Reveal price" button behind
  **simulated human interaction** (`minMoves: 8`, `minDwellMs: 600`) —
  found by inspecting the site's React bundle.

**Decision:** use `fetch()` for search, Playwright (real Chromium) for
price/stock. This is **not** the "safe default" choice — it's the
evidence-based choice. Implementing the WASM PoW + decryption in plain
Node was explicitly ruled out as fragile and out of scope.

### 1.2 Outer retry with backoff

For each tracked product, the scraper makes up to **3 full attempts**.
Between attempts, it backs off (`0s`, `4s`, `10s` before attempts 1, 2, 3)
so we don't hammer a slow site. The exact values are constants at the top
of `scraper.js`, grouped with a comment explaining the rationale.

Each attempt is a full reset: fresh browser context (no stale cookies),
fresh navigation, fresh interaction simulation. A failure in one attempt
must NOT carry state into the next.

### 1.3 Generous fixed wait (not instant-read)

The site's price genuinely loads with a delay, AND the site's own JS does
up to **6 internal retries with exponential backoff** before showing a
terminal error. An instant DOM read would see "Loading current price…"
and incorrectly conclude the price is missing.

We wait up to **30 seconds** for either `.price-block.price-success` OR
`.price-block.price-error` to appear (whichever comes first), capped by
`PRICE_REVEAL_TIMEOUT_MS`. 30s is comfortably longer than the site's own
worst-case internal retry (~6 attempts × ~2-3s ≈ 18s) plus a margin for
network latency.

### 1.4 Validation BEFORE saving

`validateScrapedValues(price, stock)` is called **after** a successful
extraction but **before** declaring success. It checks:

- `price` is a finite number, `> 0`, and `< 1_000_000` (sanity upper bound).
- `stock` is a finite number, `>= 0`, and `< 1_000_000`.

If validation fails, the attempt is treated as failed — we do NOT save.
The previous run's price stays as the latest data point.

This is the last line of defence against storing wrong/empty data. Even
if the DOM extraction has a bug, validation catches nonsense values
before they land in the database.

### 1.5 Honest, complete logging

Every attempt — `success`, `retried`, or `failed` — produces exactly one
row in `scrape_logs` with:

- `attempted_at` — when this attempt happened
- `outcome` — `success` (succeeded on attempt 1) / `retried` (succeeded
  on attempt 2 or 3) / `failed` (all 3 attempts exhausted)
- `attempts_made` — how many outer attempts were used
- `failure_reason` — nullable, populated ONLY on `failed`
- `price_seen` / `stock_seen` — nullable, populated ONLY on success/retried

`price_history` rows are inserted ONLY on `success` or `retried` outcomes.
On `failed`, NOTHING is written to `price_history`. The last known good
price simply remains the most recent data point. **There is no code path
that writes null / 0 / blank to `price_history`.**

### 1.6 Overlap protection (scrape lock)

A single-row table `scrape_lock` (id=1) holds `is_running` and
`started_at`. Before each run:

- If `is_running = false` → take the lock.
- If `is_running = true` AND older than `stale_after_minutes` (default 15)
  → **forcibly take** (the previous run must have crashed without
  releasing).
- Otherwise → **skip cleanly** (return HTTP 409, log the skip).

The lock is always released in a `finally` block in the route handler,
so a crash mid-run still leaves the lock takeable on the next trigger.

### 1.7 Sequential scraping

The default `SCRAPER_CONCURRENCY=1` scrapes products one at a time. The
mock store is intentionally flaky under concurrent load; sequential is
slower but dramatically more reliable. This is the right trade-off for
the assignment (reliability > throughput).

### 1.8 Honeypot-aware extraction

The site renders a decoy `<span class="price-value" aria-hidden="true"
style="display:none">` containing a FAKE price to catch naive scrapers
that grab `.price-value` by class. The extraction logic in
`extractPriceAndStock()` explicitly filters out:

- `aria-hidden="true"` spans
- `display:none` / `visibility:hidden` spans (via `getComputedStyle`)
- `text-decoration: line-through` spans (these are MRP strikethroughs)

The first visible, non-strikethrough span containing a digit is the
"shown price" (the `p` field in the decrypted payload shape).

### 1.9 Headed mode

Setting `HEADLESS=false` (or passing `--headed` to the standalone CLI)
runs Playwright with a visible browser window — required for the demo
recording. This is an env var, not a separate codebase, so the same code
runs in production (headless) and in the demo (headed).

---

## 2. Trade-offs made

| Decision | Trade-off | Why this side |
| --- | --- | --- |
| Playwright over plain fetch for price | ~3-5s per product vs. ~50ms; 200MB Chromium binary on the backend | Required by the anti-bot challenge; no realistic alternative |
| Sequential (concurrency=1) | Slower: a 20-product run takes ~2-3 min | The mock store is intentionally flaky under concurrent load; reliability > throughput for this assignment |
| 3 outer attempts (not 5 or 10) | Fewer chances to recover vs. longer run time | 3 covers ~99% of real-world transient failures without making a single scrape run take 5+ minutes |
| 30s price-reveal timeout | Longer waits = slower failures | Generous enough to outlast the site's own ~18s internal retry; tight enough to keep the outer loop moving |
| Single-row scrape_lock (not Postgres advisory lock) | Less precise; relies on a stale-timeout to recover from crashes | Easier to debug, no Postgres-specific knowledge needed; the table is inspectable from Supabase's dashboard |
| Service role key (not anon + RLS) | Backend has full DB access | The backend is a trusted server with no per-user accounts; RLS would add complexity for no benefit |
| Catalog search: fetch 5 pages × 50 + filter client-side | 5x latency for distant matches; misses matches on page 6+ | No server-side search param exists; 250 products is plenty for the demo; push-down would require backend indexing |
| One shared browser per trigger run (not per product) | A crash in one product's page can theoretically affect the shared browser's state | Drastically reduces cold-start cost; we open a fresh **context** per product (cookie/session isolation) so state doesn't leak |

---

## 3. What AI tools got wrong on the first attempt — and how I fixed it

I am writing this section truthfully and specifically. These are real
mistakes that AI tooling made during this build, and the concrete
corrections I applied.

### 3.1 CLI flag logic: `!headedFlagIdx` was wrong for `-1`

**The mistake.** In `run-scrape.js`, the initial code read:

```js
const headless = !headedFlagIdx && process.env.HEADLESS !== 'false';
```

The intent was "headless unless `--headed` flag was passed OR env var
`HEADLESS=false`". But `headedFlagIdx` is `-1` when the flag is absent,
and `!(-1)` evaluates to `false` (because `-1` is truthy). The result:
the script launched **headed** by default on every run, which crashed in
the sandbox (no X server) and would have crashed in production (Render
has no display).

**The fix.**

```js
const wantsHeaded = headedFlagIdx >= 0 || process.env.HEADLESS === 'false';
const headless = !wantsHeaded;
```

**Lesson.** Always test the negative path of a CLI flag explicitly. I
caught this only because the first `npm run scrape` failed loudly with
"Missing X server or $DISPLAY" — a quieter failure mode (e.g., a
successful headed run on a developer's laptop that then failed in CI)
could have shipped.

### 3.2 Honeypot span: AI initially proposed `textContent` of `.price-value`

**The mistake.** The first draft of `extractPriceAndStock` did:

```js
const priceText = await page.locator('.price-value').innerText();
```

This is **exactly** the trap the mock store sets. The site renders a
honeypot `<span class="price-value" aria-hidden="true" style="display:none">`
containing a fake price (the `d.d1` value seen in the React bundle). A
naive `.price-value` selector grabs that honeypot, and the scraper would
have stored the wrong price on every single run — silently, because the
fake number is a plausible-looking integer.

I caught this by reading the React bundle: the markup template was

```jsx
<span className="price-value" aria-hidden="true" style="display:none">{d.d1}</span>
<span className={f?.mrp} style="text-decoration:line-through">{Fr(m.mrp, m.currency)}</span>
{m.triple && m.sale !== undefined && (<sale span>)}
```

The honeypot is the first `.price-value` AND it has both `aria-hidden` and
inline `display:none`. The REAL visible price is rendered in a separate
span (whose class name is dynamically composed, so I can't rely on it).

**The fix.** The extraction now iterates over all `<span>` children of
`.price-main` and explicitly filters out:

1. `aria-hidden === "true"` spans
2. `getComputedStyle(span).display === "none"` spans (belt + suspenders)
3. `text-decoration-line.includes("line-through")` spans (MRP strikethrough)
4. spans with no digit in their text

The first surviving span's text is parsed as the price. A fallback uses
`main.innerText` (which excludes `display:none` content per the HTML spec)
and parses the first currency-like number — also honeypot-safe.

**Lesson.** When the target site has obvious anti-scraping defences,
assume there are subtle ones too. Read the rendered HTML, not just the
visible UI.

### 3.3 Lock-release ordering: AI put `release()` AFTER the response was sent

**The mistake.** In an earlier draft of `scrapeTrigger.js`, the
`finally { await release(); }` block was placed inside the route handler
but AFTER `res.json(...)`. Express's `res.json()` is synchronous from the
caller's perspective but the response is flushed asynchronously — meaning
the `finally` block could run before the response actually hit the wire,
but more importantly, an exception thrown during `release()` would convert
a successful 200 into an unhandled error.

**The fix.** I moved the lock release to a `try / finally` block that
wraps the entire scrape loop (browser launch + product loop + response
building), and made `release()` swallow its own errors (it logs but does
not throw). The response is sent AFTER the lock is released. This way:

- The lock is always released, even on crash.
- A release failure doesn't poison a successful response.
- The HTTP status code reflects what actually happened during the scrape.

**Lesson.** Lock-release and error-handling logic must be reasoned about
end-to-end, not bolted on at the end. The "obvious" location for a
finally block isn't always the right one.

### 3.4 The site's "internal retry" misled the AI on outer retry count

**The mistake.** An early draft of the scraper used `MAX_OUTER_ATTEMPTS = 6`
because the AI had read "the site does up to 6 internal retries" and
concluded we should match it. This is wrong: the site's 6 internal
retries happen INSIDE a single Playwright page session — waiting for
`.price-block.price-success` already accounts for them. Layering 6 outer
retries on top of 6 internal retries gives up to 36 attempts per product,
which would make a single scrape-trigger run take 10+ minutes for a
modest product list.

**The fix.** `MAX_OUTER_ATTEMPTS = 3`. Each outer attempt already allows
the site's internal retry loop to complete. 3 outer attempts covers the
case where the site's internal retries fail (transient network blip,
Playwright context corruption), without ballooning the run time.

**Lesson.** Understand WHERE a retry happens in the stack. Internal
retries and outer retries are not interchangeable; layering them
multiplicatively is usually wrong.

### 3.5 First attempt: AI tried to validate the price BEFORE checking `price-success`

**The mistake.** An early draft read the DOM immediately after clicking
"Reveal price", then validated. This frequently saw "Loading current
price…" text, failed validation (correctly!), retried, and burned all 3
attempts before the site's own loading finished. The scraper reported
"failed" on healthy products because it was reading the loading state.

**The fix.** Two changes:

1. Wait for `.price-block.price-success` (or `.price-block.price-error`)
   to appear, with a 30s timeout, BEFORE attempting extraction.
2. Only validate after we've confirmed the success state is visible.

This is the difference between "wait for the content to load" and
"validate whatever is currently there".

**Lesson.** "Validate before save" does not mean "validate at the
earliest possible moment". You still need to wait for the operation to
actually complete before you can validate its result.

### 3.6 The Character-Split Carrier Bug: Why products initially parsed as ₹1

**The mistake / symptom.** In earlier test runs, all tracked products showed
prices like `₹1` (or `₹2` / `₹3`) on the dashboard, despite the store page
clearly displaying prices like `₹16,244`, `₹22,654`, or `₹1,09,900`.

**The root cause.** An inspection of the mock store's frontend bundle
(`index-B9UiQq4X.js`) revealed that the mock store employs dynamic carrier
obfuscation: `priceCarrier === "split"`. It slices the formatted price string
into individual single-character `<span>` elements separated by zero-width
spaces (`\u200b`):

```html
<div class="pv-k2" style="font-size: 2.4rem; ...">
  <span>₹​</span>
  <span>1​</span>
  <span>6​</span>
  <span>,​</span>
  <span>2​</span>
  <span>4​</span>
  <span>4</span>
</div>
```

The initial scraper traversed `main.querySelectorAll('span')` and selected
the first visible, non-strikethrough span that matched `/\d/`. With the split
carrier, the first matching span was literally `<span>1​</span>`. The parser
extracted `"1\u200b"`, stripped non-digits, and converted it to integer `1`.

Additionally, the mock store randomizes between 6 different number formatters:
1. `unicode`: Fullwidth Unicode characters (`１, ２, ３...`, Unicode range 65296+).
2. `euro`: European notation with dots and comma decimals (`16.244,00`).
3. `spaced`: Space-separated thousands (`16 244`).
4. `trailing`: Appends `/- (incl. of all taxes)`.
5. `nbsp`: Zero-width and non-breaking space delimiters.
6. `lakh`: `Rs. 16,244.00`.

**The fix.**
1. **Container targeting**: Rather than matching individual `span` tags, the
   scraper now identifies the primary price container (`style*="2.4rem"` or
   `pv-*` class) and reads its complete `textContent`, gathering all child
   spans together.
2. **Unicode NFKC normalization**: `rawText.normalize('NFKC')` normalizes
   fullwidth digits (`１２３` → `123`) and non-breaking spaces.
3. **Format stripping**: Zero-width spaces (`\u200b`), trailing tax text
   (`/- (incl. of all taxes)`), and trailing decimals (`,00` / `.00`) are
   stripped before digit extraction.
4. **Strict validation guard**: Reject any price `< 10`. Any accidental
   single-digit parse is immediately rejected, triggering outer retry.
5. **Database cleanup**: Any legacy `price_history` rows where `price < 10`
   are automatically purged, and `store.js` enforces a guard preventing
   storing prices `< 10`.

**Lesson.** Anti-scraping obfuscation doesn't just hide elements with CSS;
it actively fragments text across DOM trees. Always inspect the parent container's
full text content and normalize Unicode character encodings.

---

## 4. What I would do differently with more time

These are NOT implemented in the current submission:

1. **Snapshot tests for the scraper's extraction logic** — feed a saved
   HTML fixture (success / error / out-of-stock / honeypot variants)
   through `extractPriceAndStock` and assert the parsed values. This would
   have caught the honeypot bug in section 3.2 before the first run.
2. **A `/api/scrape-trigger/run-now` admin endpoint** — same as
   `/scrape-trigger` but requiring a different secret and intended for
   manual testing from the frontend, so you can demo a live scrape without
   waiting for the 2-hour cron.
3. **Back-in-stock + price-drop alerts** — the spec lists these as bonus
   features. They'd require tracking transitions in `price_history` and
   hooking into SendGrid.

---

## 5. Summary

The scraper's reliability rests on five concrete mechanisms, each of
which is visible in `scraper.js`:

1. **Outer retry with backoff** (3 attempts, 0s/4s/10s waits).
2. **Generous fixed wait** for late-loading content (30s for
   `.price-block.price-success`).
3. **Validation before save** (`price > 0`, `stock >= 0`, sanity bounds).
4. **Honeypot-aware extraction** (skip `aria-hidden`, `display:none`,
   and `line-through` spans).
5. **Overlap lock** with stale-lock takeover (15-minute timeout).

Failures are honestly logged in `scrape_logs` with their reason. The
`price_history` table is NEVER written to on failure — by construction.
