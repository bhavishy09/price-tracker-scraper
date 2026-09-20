/**
 * scrapeTrigger.js
 * --------------------------------------------------------------------------
 * POST /api/scrape-trigger  — Triggered by external cron (cron-job.org) every 2h.
 * GET  /api/scrape-trigger/status — Debug endpoint returning lock state.
 */

const express = require('express');
const { chromium } = require('playwright');

const config = require('../config');
const db = require('../db/store');
const { scrapeProduct } = require('../scraper/scraper');

const router = express.Router();

// Middleware checking secret header or query param
function requireCronSecret(req, res, next) {
  const provided = req.get('X-Cron-Secret') || req.query.secret;
  if (!config.cronSecret) {
    return res.status(500).json({ error: 'Server missing CRON_SECRET configuration' });
  }
  if (provided !== config.cronSecret) {
    return res.status(401).json({ error: 'Unauthorized: invalid cron secret' });
  }
  next();
}

// Read lock status
router.get('/status', async (_req, res) => {
  try {
    const status = await db.getLockStatus();
    res.json({ ...status, stale_after_minutes: config.scrapeStaleAfterMinutes });
  } catch (err) {
    console.error('[scrape-trigger status] Error:', err.message);
    res.status(500).json({ error: 'Failed to read scrape lock status', detail: err.message });
  }
});

// Trigger scraping across all tracked products
router.post('/', requireCronSecret, async (_req, res) => {
  const startedAt = new Date();
  const runId = `run_${startedAt.getTime()}`;
  console.log(`[scrape-trigger] ${runId} — Received trigger`);

  // Acquire lock to prevent overlap
  const lockInfo = await db.tryAcquireLock();
  if (!lockInfo.acquired) {
    console.log(`[scrape-trigger] ${runId} — Skipped: ${lockInfo.reason}`);
    return res.status(409).json({ skipped: true, reason: lockInfo.reason, runId });
  }

  let products = [];
  try {
    products = await db.listTrackedProducts();
  } catch (err) {
    console.error(`[scrape-trigger] ${runId} — Product list fetch failed:`, err.message);
    await db.releaseLock();
    return res.status(500).json({ error: 'Failed to list tracked products', detail: err.message });
  }

  if (products.length === 0) {
    console.log(`[scrape-trigger] ${runId} — No products tracked; releasing lock.`);
    await db.releaseLock();
    return res.json({
      runId,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      total: 0,
      summary: { success: 0, retried: 0, failed: 0 },
      products: [],
    });
  }

  // Launch shared Chromium browser
  let browser = null;
  const perProduct = [];

  try {
    browser = await chromium.launch({ headless: config.scraperHeadless });

    for (const product of products) {
      const t0 = Date.now();
      const sourceId = product.source_product_id || product.id;
      console.log(`[scrape-trigger] ${runId} — Scraping product ${sourceId} (${product.name})`);

      const result = await scrapeProduct(sourceId, {
        headless: config.scraperHeadless,
        browser,
      });

      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[scrape-trigger] ${runId} — Product ${sourceId} outcome: ${result.outcome} (${dt}s)`);

      // Record scrape attempt (Always write scrape_logs; price_history only on success/retried)
      await db.insertScrapeLog(product.id, result);
      if (result.outcome === 'success' || result.outcome === 'retried') {
        await db.insertPriceHistory(product.id, result.price, result.stock);
      }

      perProduct.push({
        trackedProductId: product.id,
        sourceProductId: sourceId,
        name: product.name,
        outcome: result.outcome,
        attempts: result.attempts,
        price: result.price ?? null,
        stock: result.stock ?? null,
        failureReason: result.failureReason ?? null,
        durationSeconds: parseFloat(dt),
      });
    }
  } catch (err) {
    console.error(`[scrape-trigger] ${runId} — Run execution error:`, err.message);
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    await db.releaseLock();
    console.log(`[scrape-trigger] ${runId} — Released lock`);
  }

  const summary = {
    success: perProduct.filter((p) => p.outcome === 'success').length,
    retried: perProduct.filter((p) => p.outcome === 'retried').length,
    failed: perProduct.filter((p) => p.outcome === 'failed').length,
  };

  res.json({
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    total: perProduct.length,
    summary,
    products: perProduct,
  });
});

module.exports = router;
