/**
 * scrapeTrigger.js
 * --------------------------------------------------------------------------
 * POST /api/scrape-trigger   — called by cron-job.org every 2 hours.
 *   - MUST include the secret (X-Cron-Secret header OR ?secret= query).
 *   - Checks the overlap lock. If a run is already in progress, skips
 *     cleanly (logs to console + the response), does NOT queue.
 *   - Otherwise: launches a shared Playwright browser, scrapes every
 *     tracked product SEQUENTIALLY (concurrency=1 default — the mock
 *     store is intentionally flaky under concurrent load), and for each:
 *       * Runs the scraper's 3-try outer retry with backoff.
 *       * On success/retried → inserts a price_history row.
 *       * On every attempt → inserts a scrape_logs row with the outcome.
 *   - Returns a structured summary so the caller (and our own logs) can
 *     see exactly what happened in this run.
 *
 * GET /api/scrape-trigger/status  — debug endpoint, no secret needed.
 *   Returns whether a run is in progress (read from scrape_lock).
 *
 * Security: the secret is checked BEFORE any work is done, so randoms
 * on the internet cannot run up our bill by spamming this endpoint.
 */

const express = require('express');
const { chromium } = require('playwright');

const config = require('../config');
const { getSupabase } = require('../db/supabase');
const { tryAcquire, release, getStatus } = require('../services/lock');
const { scrapeProduct } = require('../scraper/scraper');

const router = express.Router();

// -------------------------------------------------------------------------
// Secret check middleware. Rejects 401 if the secret is missing or wrong.
// Accepts either X-Cron-Secret header or ?secret= query (header preferred).
// -------------------------------------------------------------------------
function requireCronSecret(req, res, next) {
  const provided = req.get('X-Cron-Secret') || req.query.secret;
  if (!config.cronSecret) {
    // Misconfiguration — fail closed, never run scrapes without a secret.
    return res.status(500).json({ error: 'server missing CRON_SECRET env var' });
  }
  if (provided !== config.cronSecret) {
    return res.status(401).json({ error: 'unauthorized: missing or incorrect cron secret' });
  }
  next();
}

// -------------------------------------------------------------------------
// GET /api/scrape-trigger/status  — lightweight, no secret required.
// Lets the frontend / a human see if a scrape is currently running.
// -------------------------------------------------------------------------
router.get('/status', async (_req, res) => {
  try {
    const status = await getStatus();
    res.json({ ...status, stale_after_minutes: config.scrapeStaleAfterMinutes });
  } catch (err) {
    console.error('[scrape-trigger status] failed:', err.message);
    res.status(500).json({ error: 'failed to read scrape lock', detail: err.message });
  }
});

// -------------------------------------------------------------------------
// POST /api/scrape-trigger  — the actual trigger.
// -------------------------------------------------------------------------
router.post('/', requireCronSecret, async (_req, res) => {
  const startedAt = new Date();
  const runId = `run_${startedAt.getTime()}`;
  console.log(`[scrape-trigger] ${runId} — received trigger`);

  // 1) Overlap protection.
  let lockInfo;
  try {
    lockInfo = await tryAcquire();
  } catch (err) {
    console.error(`[scrape-trigger] ${runId} — lock check failed:`, err.message);
    return res.status(500).json({ error: 'lock check failed', detail: err.message });
  }

  if (!lockInfo.acquired) {
    console.log(`[scrape-trigger] ${runId} — SKIPPED: ${lockInfo.reason}`);
    return res.status(409).json({
      skipped: true,
      reason: lockInfo.reason,
      runId,
    });
  }
  console.log(`[scrape-trigger] ${runId} — lock acquired: ${lockInfo.reason}`);

  // 2) Load all tracked products.
  let products = [];
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('tracked_products')
      .select('id, source_product_id, name')
      .order('added_at', { ascending: true });
    if (error) throw new Error(`failed to load tracked products: ${error.message}`);
    products = data || [];
  } catch (err) {
    console.error(`[scrape-trigger] ${runId} — failed to load products:`, err.message);
    await release().catch(() => {});
    return res.status(500).json({ error: 'failed to load tracked products', detail: err.message });
  }

  if (products.length === 0) {
    console.log(`[scrape-trigger] ${runId} — nothing tracked; releasing lock and exiting`);
    await release().catch(() => {});
    return res.json({
      runId,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      total: 0,
      summary: { success: 0, retried: 0, failed: 0 },
      products: [],
    });
  }

  // 3) Launch ONE shared browser across all products in this run.
  //    Closing+reopening a browser per product would multiply cold-start
  //    cost and slow the run noticeably for any non-trivial N.
  const browser = await chromium.launch({ headless: config.scraperHeadless });
  const perProduct = [];

  try {
    for (const product of products) {
      const t0 = Date.now();
      console.log(`[scrape-trigger] ${runId} — scraping product ${product.source_product_id} (${product.name})`);
      const result = await scrapeProduct(product.source_product_id, {
        headless: config.scraperHeadless,
        browser,
      });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[scrape-trigger] ${runId} — product ${product.source_product_id} done in ${dt}s → ${result.outcome}`);

      // Persist: ALWAYS one scrape_logs row. price_history ONLY on success/retried.
      await persistScrapeResult(product.id, result);

      perProduct.push({
        trackedProductId: product.id,
        sourceProductId: product.source_product_id,
        name: product.name,
        outcome: result.outcome,
        attempts: result.attempts,
        price: result.price ?? null,
        stock: result.stock ?? null,
        failureReason: result.failureReason ?? null,
        durationSeconds: parseFloat(dt),
      });
    }
  } finally {
    // ALWAYS release the lock + close the browser, even on crash.
    try { await browser.close(); } catch { /* ignore */ }
    await release().catch(() => {});
    console.log(`[scrape-trigger] ${runId} — lock released`);
  }

  const summary = {
    success: perProduct.filter((p) => p.outcome === 'success').length,
    retried: perProduct.filter((p) => p.outcome === 'retried').length,
    failed: perProduct.filter((p) => p.outcome === 'failed').length,
  };

  const finishedAt = new Date();
  console.log(`[scrape-trigger] ${runId} — DONE. summary=`, summary);

  res.json({
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    total: perProduct.length,
    summary,
    products: perProduct,
  });
});

// -------------------------------------------------------------------------
// Persist a scrape result to the database.
//   - ALWAYS inserts one row into scrape_logs (honest history).
//   - Inserts into price_history ONLY when outcome is success/retried.
//     NEVER on failure — that would write null/zero/fake data.
// -------------------------------------------------------------------------
async function persistScrapeResult(trackedProductId, result) {
  const sb = getSupabase();

  // 1) Always log the attempt.
  const logRow = {
    tracked_product_id: trackedProductId,
    outcome: result.outcome,
    attempts_made: result.attempts,
    failure_reason: result.failureReason ?? null,
    price_seen: result.price ?? null,
    stock_seen: result.stock ?? null,
  };
  const { error: logErr } = await sb.from('scrape_logs').insert(logRow);
  if (logErr) {
    // Logging is critical for "honest history". If it fails, surface it loudly.
    console.error(`[persist] scrape_logs insert failed for product ${trackedProductId}:`, logErr.message);
  }

  // 2) On success/retried, also insert into price_history.
  if (result.outcome === 'success' || result.outcome === 'retried') {
    const histRow = {
      tracked_product_id: trackedProductId,
      price: result.price,
      stock_quantity: result.stock,
    };
    const { error: histErr } = await sb.from('price_history').insert(histRow);
    if (histErr) {
      console.error(`[persist] price_history insert failed for product ${trackedProductId}:`, histErr.message);
    }
  }
  // On failure: do NOT insert anything into price_history. The last known
  // good price remains the latest data point. This is the explicit contract.
}

module.exports = router;
