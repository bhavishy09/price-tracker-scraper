/**
 * scraper.js
 * --------------------------------------------------------------------------
 * Scrapes current price + stock of ONE product from INE's mock store using Playwright.
 *
 * Anti-Bot & Obfuscation Bypasses:
 *   1. Cookie Overlay Handling: Dismisses cookie banner to avoid pointer interception.
 *   2. Interaction Gate: Simulates >=8 mouse moves across price block and >=600ms dwell.
 *   3. Solves PoW + WASM challenge natively inside real Chromium.
 *   4. Honeypot Avoidance: Excludes hidden .price-value and .amount elements.
 *   5. Carrier De-obfuscation: Handles character-split carrier (zero-width spaces \u200b
 *      and fullwidth Unicode digits like １, ２, ３) by reading full container textContent
 *      and applying NFKC normalization.
 *   6. Currency Format Handlers: Handles all 6 mock store variations:
 *      - default: ₹16,244
 *      - spaced: ₹16 244
 *      - euro: ₹16.244,00
 *      - trailing: ₹16,244/- (incl. of all taxes)
 *      - unicode: ₹１６,２４４
 *      - lakh: Rs. 16,244.00
 *   7. Settling Timing: Waits for "Updating..." indicator to clear before reading DOM.
 *   8. Strict Validation Guard: Rejects prices < 10 (such as single-digit honeypot or
 *      partial character reads) to guarantee honest, accurate pricing.
 */

const { chromium } = require('playwright');

// Constants & Retry Policy
const MAX_OUTER_ATTEMPTS = 3;
const BACKOFF_BETWEEN_ATTEMPTS_MS = [0, 4_000, 10_000];
const PRICE_REVEAL_TIMEOUT_MS = 30_000;
const INTERACTION_MOVE_COUNT = 14;
const INTERACTION_STEP_MS = 75;
const POST_INTERACTION_DWELL_MS = 300;
const NAV_TIMEOUT_MS = 45_000;
const STORE_BASE_URL = 'https://demo.inelabteamdev.com';

/**
 * Scrape a single product's price and stock.
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

  const ownBrowser = !opts.browser;
  const browser = opts.browser ?? (await chromium.launch({ headless }));
  let lastFailureReason = 'unknown failure';

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        const wait = BACKOFF_BETWEEN_ATTEMPTS_MS[attempt - 1] ?? 8_000;
        logger.log(`[scraper] product ${productId} — backing off ${(wait / 1000)}s before attempt ${attempt}/${maxAttempts}`);
        await sleep(wait);
      }

      logger.log(`[scraper] product ${productId} — attempt ${attempt}/${maxAttempts}`);
      const context = await browser.newContext({
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
          const validation = validateScrapedValues(result.price, result.stock, logger);
          if (!validation.ok) {
            lastFailureReason = validation.reason;
            logger.warn(`[scraper] product ${productId} — attempt ${attempt} parsed but failed validation: ${validation.reason}`);
            continue;
          }

          const outcome = attempt === 1 ? 'success' : 'retried';
          logger.log(`[scraper] product ${productId} — ${outcome} on attempt ${attempt} (price=₹${result.price}, stock=${result.stock})`);
          return {
            outcome,
            attempts: attempt,
            price: result.price,
            stock: result.stock,
          };
        }

        lastFailureReason = result.reason;
        logger.warn(`[scraper] product ${productId} — attempt ${attempt} failed: ${result.reason}`);
      } catch (err) {
        lastFailureReason = `unexpected error: ${err?.message ?? String(err)}`;
        logger.warn(`[scraper] product ${productId} — attempt ${attempt} threw: ${lastFailureReason}`);
      } finally {
        try { await context.close(); } catch {}
      }
    }

    return {
      outcome: 'failed',
      attempts: maxAttempts,
      failureReason: lastFailureReason,
    };
  } finally {
    if (ownBrowser) {
      try { await browser.close(); } catch {}
    }
  }
}

/**
 * Execute one scrape attempt.
 */
async function runOneAttempt(page, productId, logger) {
  const url = `${STORE_BASE_URL}/product/${productId}`;
  try {
    await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
  } catch (err) {
    return { ok: false, reason: `navigation failed: ${err?.message ?? err}` };
  }

  // Dismiss cookie consent banner if present
  try {
    const cookieBtn = page.locator('button:has-text("Accept"), button:has-text("Accept cookies")').first();
    if (await cookieBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await cookieBtn.click({ timeout: 2000 }).catch(() => {});
      await sleep(150);
    }
  } catch {}

  try {
    await page.locator('.price-block').first().waitFor({ state: 'visible', timeout: 20_000 });
  } catch (err) {
    return { ok: false, reason: 'price-block never rendered' };
  }

  // Simulate human hover interaction
  try {
    await simulateHumanHover(page);
  } catch (err) {
    return { ok: false, reason: `hover simulation failed: ${err?.message ?? err}` };
  }

  // Click "Reveal price"
  try {
    const revealBtn = page.locator('button[aria-label="Reveal price"]');
    await revealBtn.waitFor({ state: 'visible', timeout: 3_000 });
    const enabled = await revealBtn.isEnabled().catch(() => false);
    if (enabled) {
      await revealBtn.click({ timeout: 5_000 });
    } else {
      await simulateHumanHover(page);
      const enabled2 = await revealBtn.isEnabled().catch(() => false);
      if (enabled2) await revealBtn.click({ timeout: 5_000 });
    }
  } catch (err) {
    logger.log(`[scraper] product ${productId} — reveal button click skipped: ${err?.message ?? err}`);
  }

  // Wait for price-success or price-error state
  try {
    await Promise.race([
      page.locator('.price-block.price-success').first().waitFor({ state: 'visible', timeout: PRICE_REVEAL_TIMEOUT_MS }),
      page.locator('.price-block.price-error').first().waitFor({ state: 'visible', timeout: PRICE_REVEAL_TIMEOUT_MS }),
    ]);
  } catch (err) {
    return { ok: false, reason: `timed out waiting for price reveal after ${PRICE_REVEAL_TIMEOUT_MS / 1000}s` };
  }

  // Check for terminal error
  const isError = await page.locator('.price-block.price-error').first().isVisible().catch(() => false);
  if (isError) {
    const errText = (await page.locator('.price-block.price-error .price-status').first().innerText().catch(() => '')) || '';
    return { ok: false, reason: `site showed terminal price-error state: ${errText.trim() || 'unknown'}` };
  }

  // Timing wait: wait specifically for price to populate with valid currency & numbers
  try {
    await page.waitForFunction(() => {
      const main = document.querySelector('.price-main');
      if (!main) return false;
      const text = (main.textContent || '').normalize('NFKC');
      return /[₹\u20B9]|Rs\./i.test(text) && /\d{2,}/.test(text.replace(/[^\d]/g, ''));
    }, { timeout: 10_000 });
  } catch {}

  // If "Updating..." indicator is visible, wait briefly to see if it clears
  try {
    await page.waitForFunction(() => {
      const main = document.querySelector('.price-main');
      return main && !main.textContent.includes('Updating');
    }, { timeout: 1500 });
  } catch {
    // "Updating…" can be a persistent attribute of some quotes (s.g === 1)
  }

  // Allow layout opacity to settle
  await sleep(150);

  // Extract price and stock
  return await extractPriceAndStock(page, logger);
}

/**
 * Simulate human hover to meet minMoves=8 and minDwellMs=600.
 */
async function simulateHumanHover(page) {
  const block = page.locator('.price-block').first();
  const box = await block.boundingBox();
  if (!box) throw new Error('price-block not visible');

  const startX = box.x + box.width * 0.25;
  const startY = box.y + box.height * 0.5;

  await page.mouse.move(startX, startY);
  await sleep(60);

  for (let i = 0; i < INTERACTION_MOVE_COUNT; i++) {
    const t = (i + 1) / INTERACTION_MOVE_COUNT;
    const x = box.x + box.width * (0.2 + 0.6 * t);
    const y = box.y + box.height * (0.45 + 0.1 * Math.sin(t * Math.PI));
    await page.mouse.move(x, y, { steps: 1 });
    await sleep(INTERACTION_STEP_MS);
  }

  await sleep(POST_INTERACTION_DWELL_MS);
}

/**
 * Extract price and stock with robust de-obfuscation and validation.
 */
async function extractPriceAndStock(page, logger = console) {
  const extracted = await page.evaluate(() => {
    const main = document.querySelector('.price-main');
    if (!main) return { ok: false, reason: '.price-main not found in DOM' };

    // 1) Filter out honeypots, strikethrough MRP, deal price, and badges
    const children = Array.from(main.children);
    const candidateElements = children.filter((el) => {
      if (el.getAttribute('aria-hidden') === 'true') return false;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cs.textDecorationLine && cs.textDecorationLine.includes('line-through')) return false;

      const txt = (el.textContent || '').trim();
      if (!txt) return false;
      if (txt.includes('Deal price') || txt.includes('% off') || txt.includes('Updating')) return false;
      return true;
    });

    // 2) Find the true price element (has 2.4rem font size or pv-* class)
    const priceEl = candidateElements.find((el) => {
      const style = el.getAttribute('style') || '';
      const cs = window.getComputedStyle(el);
      return style.includes('2.4rem') || cs.fontSize === '38.4px' || el.className.includes('pv-');
    }) || candidateElements[0];

    if (!priceEl) {
      return { ok: false, reason: 'price container element not found in .price-main' };
    }

    const rawPriceText = priceEl.textContent || '';

    // 3) Parse price across all 6 mock store formatting variations:
    //    - Unicode fullwidth digits (１２３) -> 123
    //    - Remove zero-width spaces (\u200B) and non-breaking spaces (\u00A0)
    //    - Remove trailing notes like "/- (incl. of all taxes)"
    //    - Remove trailing cents like ",00" or ".00"
    //    - Extract integer rupees
    let s = rawPriceText.normalize('NFKC');
    s = s.replace(/[\u200B\u200C\u200D\uFEFF\u00A0]/g, '');
    s = s.replace(/\/-.*$/, '');
    s = s.replace(/[,.]00\b.*$/, '');
    const digits = s.replace(/[^\d]/g, '');

    const price = parseInt(digits, 10);
    if (!Number.isFinite(price) || price <= 0) {
      return {
        ok: false,
        reason: `parsed price invalid from "${rawPriceText}" (digits: "${digits}")`,
        rawPriceText,
      };
    }

    // 4) Extract Stock
    const badge = document.querySelector('.stock-badge');
    if (!badge) return { ok: false, reason: '.stock-badge not found in DOM' };

    let stock;
    if (badge.classList.contains('out-stock') || badge.textContent.toLowerCase().includes('out of stock')) {
      stock = 0;
    } else {
      const m = badge.textContent.match(/\d+/);
      stock = m ? parseInt(m[0], 10) : NaN;
    }

    if (!Number.isFinite(stock) || stock < 0) {
      return { ok: false, reason: `parsed stock invalid from "${badge.textContent}"` };
    }

    return {
      ok: true,
      price,
      stock,
      rawPriceText,
      cleanedDigits: digits,
      badgeText: badge.textContent.trim(),
    };
  });

  if (logger && extracted) {
    logger.log(`[scraper] DOM extraction details:`, {
      rawPriceText: extracted.rawPriceText,
      cleanedDigits: extracted.cleanedDigits,
      price: extracted.price,
      stock: extracted.stock,
      badgeText: extracted.badgeText,
    });
  }

  return extracted;
}

/**
 * Validation guard against bad or placeholder data.
 */
function validateScrapedValues(price, stock, logger) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: `price failed validation (got ${price})` };
  }

  // Strict guard: In this store all real products cost > ₹100.
  // A price < 10 (e.g. ₹1) is always a single-digit character split artifact!
  if (price < 10) {
    return { ok: false, reason: `price suspiciously low (${price} < 10), rejecting partial/honeypot artifact` };
  }

  if (price > 1_000_000) {
    return { ok: false, reason: `price implausibly large (${price} > 1,000,000)` };
  }

  if (typeof stock !== 'number' || !Number.isFinite(stock) || stock < 0) {
    return { ok: false, reason: `stock failed validation (got ${stock})` };
  }

  if (stock > 1_000_000) {
    return { ok: false, reason: `stock implausibly large (${stock})` };
  }

  return { ok: true };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  scrapeProduct,
  validateScrapedValues,
  extractPriceAndStock,
  MAX_OUTER_ATTEMPTS,
  BACKOFF_BETWEEN_ATTEMPTS_MS,
  PRICE_REVEAL_TIMEOUT_MS,
  STORE_BASE_URL,
};
