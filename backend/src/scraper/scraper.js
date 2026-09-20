/**
 * scraper.js
 * --------------------------------------------------------------------------
 * The single most important file in this project. Scrapes the current
 * price + stock of ONE product from INE's mock store using Playwright.
 *
 * Why Playwright (not plain fetch)?
 *   Recon on the real site (see project docs) showed that the price/stock
 *   are deliberately NOT in any plain JSON endpoint. The site requires:
 *     1. solving a proof-of-work challenge (with a WASM module),
 *     2. exchanging the PoW solution + interaction telemetry for a session
 *        token,
 *     3. fetching an ENCRYPTED price payload that only the site's own JS
 *        can decrypt (key derived from the session),
 *     4. PLUS the user must hover the price area with >=8 mouse moves and
 *        >=600ms dwell time before the "Reveal price" button even enables.
 *   We do NOT try to reverse the WASM PoW or the decryption in Node — that
 *   is fragile and out of scope. Instead we let the site's own JS do all
 *   of that inside a real Chromium, and just read the final rendered DOM.
 *
 * Reliability contract (from the assignment):
 *   - 3 outer attempts per product, with increasing backoff between them.
 *   - Fixed, generous wait for the price to appear (not instant-read),
 *     because the price genuinely loads with a delay.
 *   - Validate price > 0 and stock >= 0 BEFORE writing anything.
 *   - On failure: write NOTHING to price_history, log honestly.
 *   - Every attempt — success, retried, or failed — is logged exactly once.
 *
 * Headed mode:
 *   Set HEADLESS=false in env (or pass --headed) to run with a visible
 *   browser window — required for the demo recording.
 *
 * This module exports one function: scrapeProduct(productId, opts).
 * It returns a structured result so callers (CLI, Express route, tests)
 * can decide how to persist/log without coupling to Playwright internals.
 * --------------------------------------------------------------------------
 */

const { chromium } = require('playwright');

// -------------------------------------------------------------------------
// Tunable constants — grouped here so they're easy to find and explain
// in an interview. Values are deliberately generous because the mock store
// is intentionally slow.
// -------------------------------------------------------------------------

// Outer retry: how many full attempts we make before giving up on a product.
const MAX_OUTER_ATTEMPTS = 3;

// Backoff between outer attempts, in milliseconds. Index 0 is unused
// (the first attempt has no preceding wait), index 1 is the wait BEFORE
// attempt 2, index 2 is the wait BEFORE attempt 3. We grow the wait so
// we are not hammering a slow site that is already struggling.
const BACKOFF_BETWEEN_ATTEMPTS_MS = [0, 4_000, 10_000];

// Generous fixed wait for the price reveal to complete. We do NOT do an
// instant read because the price genuinely loads after a delay (the site
// itself does up to 6 internal retries with exponential backoff before
// showing a terminal error). 30s is comfortably longer than the site's
// own worst-case internal retry (~6 attempts × ~2-3s = ~18s) plus a margin.
const PRICE_REVEAL_TIMEOUT_MS = 30_000;

// How long to spend simulating the human-like hover/mouse-move interaction
// that the site requires before enabling the "Reveal price" button.
// (Site requires >=8 mouse moves AND >=600ms dwell. We do 12 moves spread
// over ~900ms to comfortably exceed both thresholds.)
const INTERACTION_MOVE_COUNT = 12;
const INTERACTION_STEP_MS = 80;       // ~80ms between moves → ~960ms total
const POST_INTERACTION_DWELL_MS = 200; // extra dwell beyond the moves

// Navigation timeout — site can be slow on first load.
const NAV_TIMEOUT_MS = 45_000;

// Where the mock store lives. Kept here (not in env) because it's the only
// hardcoded URL the scraper needs; everything else comes from the caller.
const STORE_BASE_URL = 'https://demo.inelabteamdev.com';

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

/**
 * Scrape a single product's price and stock.
 *
 * @param {number} productId - INE catalog product id (e.g. 921)
 * @param {object} opts
 * @param {boolean} [opts.headless=true] - run Playwright headless or headed
 * @param {number} [opts.maxAttempts=3] - outer retry count (override for tests)
 * @param {import('playwright').Browser} [opts.browser] - reuse an existing
 *        browser across products to avoid the cost of launching per-product.
 * @param {object} [opts.logger] - console-like logger; defaults to console.
 * @returns {Promise<{outcome: 'success'|'retried'|'failed',
 *                     attempts: number,
 *                     price?: number, stock?: number,
 *                     failureReason?: string}>}
 */
async function scrapeProduct(productId, opts = {}) {
  const headless = opts.headless !== false;
  const maxAttempts = opts.maxAttempts ?? MAX_OUTER_ATTEMPTS;
  const logger = opts.logger ?? console;

  if (!productId) {
    return {
      outcome: 'failed',
      attempts: 0,
      failureReason: 'no productId supplied',
    };
  }

  // We launch ONE browser per scrapeProduct call when none is passed in.
  // The Express layer passes a shared browser so we don't relaunch for
  // every product in a single scrape-trigger run.
  const ownBrowser = !opts.browser;
  const browser = opts.browser ?? await chromium.launch({ headless });

  let lastFailureReason = 'unknown failure';

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Backoff BEFORE attempts 2..N. Attempt 1 has no preceding wait.
      if (attempt > 1) {
        const wait = BACKOFF_BETWEEN_ATTEMPTS_MS[attempt - 1] ?? 8_000;
        logger.log(`[scraper] product ${productId} — backing off ${(wait / 1000)}s before attempt ${attempt}/${maxAttempts}`);
        await sleep(wait);
      }

      logger.log(`[scraper] product ${productId} — attempt ${attempt}/${maxAttempts}`);
      const context = await browser.newContext({
        // A realistic desktop viewport. Some sites gate on tiny viewports.
        viewport: { width: 1280, height: 900 },
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        locale: 'en-IN',
      });
      const page = await context.newPage();

      try {
        const result = await runOneAttempt(page, productId, logger);
        await context.close();

        if (result.ok) {
          // Validate the values BEFORE declaring success. If they fail
          // validation, this attempt counts as failed — do not save.
          const validation = validateScrapedValues(result.price, result.stock);
          if (!validation.ok) {
            lastFailureReason = validation.reason;
            logger.warn(`[scraper] product ${productId} — attempt ${attempt} scraped but validation failed: ${validation.reason}`);
            continue; // try again
          }

          const outcome = attempt === 1 ? 'success' : 'retried';
          logger.log(`[scraper] product ${productId} — ${outcome} on attempt ${attempt} (price=${result.price}, stock=${result.stock})`);
          return {
            outcome,
            attempts: attempt,
            price: result.price,
            stock: result.stock,
          };
        }

        // Not ok — remember why, and try the next attempt.
        lastFailureReason = result.reason;
        logger.warn(`[scraper] product ${productId} — attempt ${attempt} failed: ${result.reason}`);
      } catch (err) {
        // Any unexpected exception in one attempt must NOT crash the loop.
        lastFailureReason = `unexpected error: ${err?.message ?? String(err)}`;
        logger.warn(`[scraper] product ${productId} — attempt ${attempt} threw: ${lastFailureReason}`);
      } finally {
        // Make sure the page/context is closed even on error, so we don't
        // leak browsers across attempts. (Browser itself stays open.)
        try { await context.close(); } catch { /* already closed */ }
      }
    }

    // All attempts exhausted.
    return {
      outcome: 'failed',
      attempts: maxAttempts,
      failureReason: lastFailureReason,
    };
  } finally {
    if (ownBrowser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

// -------------------------------------------------------------------------
// One full attempt: navigate, interact, wait for reveal, extract, validate.
// Returns { ok: true, price, stock } or { ok: false, reason }.
// Never throws — catches its own errors and returns them as a reason,
// so the outer retry loop can use a consistent control flow.
// -------------------------------------------------------------------------

async function runOneAttempt(page, productId, logger) {
  const url = `${STORE_BASE_URL}/product/${productId}`;
  try {
    await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
  } catch (err) {
    return { ok: false, reason: `navigation failed: ${err?.message ?? err}` };
  }

  // The page is a React SPA. The product detail card loads shortly after
  // domcontentloaded. We wait for the price-block (in any state) to appear
  // so we know the React app has mounted and rendered product UI.
  try {
    await page.locator('.price-block').first().waitFor({ state: 'visible', timeout: 20_000 });
  } catch (err) {
    return { ok: false, reason: 'price-block never rendered (SPA mount failed?)' };
  }

  // Simulate the human-like interaction the site requires before it will
  // enable the "Reveal price" button. See constants above for thresholds.
  try {
    await simulateHumanHover(page);
  } catch (err) {
    return { ok: false, reason: `interaction simulation failed: ${err?.message ?? err}` };
  }

  // Click "Reveal price" if the button exists and is enabled. If the site
  // auto-triggers the reveal on hover completion (some builds do), the
  // button may already be gone — that's fine, we proceed to wait.
  try {
    const revealBtn = page.locator('button[aria-label="Reveal price"]');
    // Wait briefly for the button to become enabled after our interaction.
    await revealBtn.waitFor({ state: 'visible', timeout: 3_000 });
    // If disabled, give it a tiny nudge — sometimes the React state update
    // for `missing() === null` lands a tick after our last mousemove.
    const enabled = await revealBtn.isEnabled().catch(() => false);
    if (enabled) {
      await revealBtn.click({ timeout: 5_000 });
    } else {
      // Button present but still disabled — interaction didn't satisfy
      // the site. Try one more hover burst, then click if it enables.
      await simulateHumanHover(page);
      const enabled2 = await revealBtn.isEnabled().catch(() => false);
      if (enabled2) await revealBtn.click({ timeout: 5_000 });
    }
  } catch (err) {
    // Button may have disappeared because reveal auto-fired. Fall through
    // to the success-state wait; if that times out we'll get a real reason.
    logger.log(`[scraper] product ${productId} — reveal-button click skipped: ${err?.message ?? err}`);
  }

  // Fixed generous wait for the price to actually render. The site itself
  // does up to 6 internal retries with exponential backoff; we just wait
  // for the final success state OR a terminal error state, whichever
  // comes first, capped at PRICE_REVEAL_TIMEOUT_MS.
  try {
    await Promise.race([
      page.locator('.price-block.price-success').first().waitFor({ state: 'visible', timeout: PRICE_REVEAL_TIMEOUT_MS }),
      page.locator('.price-block.price-error').first().waitFor({ state: 'visible', timeout: PRICE_REVEAL_TIMEOUT_MS }),
    ]);
  } catch (err) {
    return { ok: false, reason: `timed out waiting for price reveal after ${PRICE_REVEAL_TIMEOUT_MS / 1000}s` };
  }

  // Check which state we ended up in.
  const isError = await page.locator('.price-block.price-error').first().isVisible().catch(() => false);
  if (isError) {
    // The site itself gave up after its 6 internal retries.
    const errText = await page.locator('.price-block.price-error .price-status').first().innerText().catch(() => '') ?? '';
    return { ok: false, reason: `site showed terminal price-error state (${errText.trim() || 'unknown'})` };
  }

  // Success state visible — extract price and stock from the rendered DOM.
  return await extractPriceAndStock(page);
}

// -------------------------------------------------------------------------
// Simulate the human-like hover/mouse-move interaction the site requires.
// Site gates the "Reveal price" button on: >=8 mousemove events on the
// price area AND >=600ms dwell time. We do 12 moves spread over ~960ms to
// comfortably exceed both thresholds, so a single timing hiccup won't
// cause a false negative.
// -------------------------------------------------------------------------
async function simulateHumanHover(page) {
  const block = page.locator('.price-block').first();
  const box = await block.boundingBox();
  if (!box) throw new Error('price-block has no bounding box (not visible?)');

  // Start near the top-left of the block.
  const startX = box.x + box.width * 0.25;
  const startY = box.y + box.height * 0.5;

  await page.mouse.move(startX, startY);
  // Slight pause so the site registers "mouseenter" before "mousemove".
  await sleep(60);

  // Walk the mouse across the block in small steps. Each mousemove is a
  // separate event in the browser, satisfying the minMoves=8 requirement.
  for (let i = 0; i < INTERACTION_MOVE_COUNT; i++) {
    const t = (i + 1) / INTERACTION_MOVE_COUNT;
    const x = box.x + box.width * (0.2 + 0.6 * t);
    // Tiny vertical jitter — looks more human than a perfectly flat line.
    const y = box.y + box.height * (0.45 + 0.1 * Math.sin(t * Math.PI));
    await page.mouse.move(x, y, { steps: 1 });
    await sleep(INTERACTION_STEP_MS);
  }

  // Extra dwell so we comfortably clear minDwellMs=600 even if some moves
  // happened too fast for the site's throttle (it dedupes moves within ~50ms).
  await sleep(POST_INTERACTION_DWELL_MS);
}

// -------------------------------------------------------------------------
// Extract price + stock from the rendered DOM.
//
// IMPORTANT: there is a HONEYPOT in the markup. The site renders a
// `<span class="price-value" aria-hidden="true" style="display:none">` with
// a FAKE price to confuse naive scrapers that grab `.price-value` by class.
// We must exclude that element.
//
// Strategy:
//   - For the price: find visible spans inside `.price-main` whose computed
//     style is NOT display:none / aria-hidden / line-through. The first one
//     with a digit is the prominent "shown price" (p in the decrypted
//     payload shape). Strikethrough spans are MRP and excluded.
//   - For the stock: read `.stock-badge`. If it has class `out-stock` → 0.
//     Otherwise the badge text is the integer stock count.
//   - Returns { ok: true, price, stock } or { ok: false, reason }.
// -------------------------------------------------------------------------
async function extractPriceAndStock(page) {
  const extracted = await page.evaluate(() => {
    const main = document.querySelector('.price-main');
    if (!main) return { ok: false, reason: '.price-main not found in DOM' };

    // --- PRICE ---
    // Find the first visible, non-strikethrough, non-aria-hidden span that
    // contains a digit. That's the prominent "shown price".
    const spans = Array.from(main.querySelectorAll('span'));
    let priceText = null;
    for (const span of spans) {
      if (span.getAttribute('aria-hidden') === 'true') continue;
      const cs = window.getComputedStyle(span);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (cs.textDecorationLine && cs.textDecorationLine.includes('line-through')) continue;
      const txt = (span.textContent || '').trim();
      if (!txt) continue;
      if (!/\d/.test(txt)) continue;
      priceText = txt;
      break;
    }

    // Fallback: if no qualifying span, take innerText of .price-main and
    // pick the first currency-like number. (innerText excludes display:none,
    // so the honeypot is already excluded here.)
    if (!priceText) {
      const all = main.innerText || '';
      const m = all.match(/[\d,]+(?:\.\d+)?/);
      if (m) priceText = m[0];
    }
    if (!priceText) return { ok: false, reason: 'no visible price text found in .price-main' };

    // Parse: keep digits and dot, drop currency symbols / thousands separators.
    const cleaned = priceText.replace(/[^\d.]/g, '');
    const price = parseFloat(cleaned);
    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, reason: `parsed price invalid: "${priceText}" → ${price}` };
    }

    // --- STOCK ---
    const badge = document.querySelector('.stock-badge');
    if (!badge) return { ok: false, reason: '.stock-badge not found in DOM' };

    let stock;
    if (badge.classList.contains('out-stock')) {
      stock = 0;
    } else {
      const txt = (badge.textContent || '').trim();
      const m = txt.match(/\d+/);
      stock = m ? parseInt(m[0], 10) : NaN;
    }
    if (!Number.isFinite(stock) || stock < 0) {
      return { ok: false, reason: `parsed stock invalid: "${badge.textContent}" → ${stock}` };
    }

    return { ok: true, price, stock, priceText };
  });

  return extracted;
}

// -------------------------------------------------------------------------
// Validate the scraped values one more time before the caller persists them.
// This is the LAST line of defence against storing wrong/empty data.
// -------------------------------------------------------------------------
function validateScrapedValues(price, stock) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: `price failed validation (got ${price})` };
  }
  if (typeof stock !== 'number' || !Number.isFinite(stock) || stock < 0) {
    return { ok: false, reason: `stock failed validation (got ${stock})` };
  }
  // Sanity upper bound — the mock store's prices are well under 1M INR.
  // This catches absurd parse mistakes (e.g., concatenated numbers).
  if (price > 1_000_000) {
    return { ok: false, reason: `price implausibly large: ${price}` };
  }
  if (stock > 1_000_000) {
    return { ok: false, reason: `stock implausibly large: ${stock}` };
  }
  return { ok: true };
}

// -------------------------------------------------------------------------
// Tiny promise-based sleep helper.
// -------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  scrapeProduct,
  // Exported for unit testing / direct inspection:
  validateScrapedValues,
  extractPriceAndStock,
  // Exported constants so callers (CLI, tests) can override if needed:
  MAX_OUTER_ATTEMPTS,
  BACKOFF_BETWEEN_ATTEMPTS_MS,
  PRICE_REVEAL_TIMEOUT_MS,
  STORE_BASE_URL,
};
