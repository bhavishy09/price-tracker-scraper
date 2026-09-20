/**
 * trackedProducts.js
 * --------------------------------------------------------------------------
 * Express endpoints for tracked products, price history, and scrape logs:
 *
 *   POST   /api/tracked-products              Track a new product
 *   GET    /api/tracked-products              List all tracked products + latest price
 *   GET    /api/tracked-products/:id          Get one product + latest price
 *   DELETE /api/tracked-products/:id          Untrack a product
 *   POST   /api/tracked-products/:id/scrape   Trigger on-demand scrape for this product
 *   GET    /api/tracked-products/:id/history  Get price history for charts
 *   GET    /api/tracked-products/:id/logs     Get scrape attempt logs
 */

const express = require('express');
const db = require('../db/store');
const { fetchProductDetail } = require('../services/catalog');
const { scrapeProduct } = require('../scraper/scraper');
const config = require('../config');

const router = express.Router();

// Helper to run scrape in background for a product
async function triggerBackgroundScrape(product) {
  try {
    const sourceId = product.source_product_id || product.id;
    console.log(`[scraper] Auto-scraping initial price for product ${sourceId} (${product.name})...`);
    const result = await scrapeProduct(sourceId, { headless: config.scraperHeadless });
    await db.insertScrapeLog(product.id, result);
    if (result.outcome === 'success' || result.outcome === 'retried') {
      await db.insertPriceHistory(product.id, result.price, result.stock);
    }
    console.log(`[scraper] Auto-scrape finished for ${sourceId}: ${result.outcome}`);
  } catch (err) {
    console.error(`[scraper] Auto-scrape failed for ${product.id}:`, err.message);
    await db.insertScrapeLog(product.id, {
      outcome: 'failed',
      attempts: 1,
      failureReason: err.message,
    });
  }
}

// Track a product
router.post('/', async (req, res) => {
  const { sourceProductId } = req.body || {};
  const id = Number(sourceProductId);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Valid numeric sourceProductId required' });
  }

  try {
    const existing = await db.findTrackedBySourceId(id);
    if (existing) {
      return res.status(200).json({ tracked: existing, alreadyTracked: true });
    }

    const detail = await fetchProductDetail(id).catch(() => ({ id }));
    const tracked = await db.addTrackedProduct(detail);

    // Asynchronously trigger initial scrape so price/stock populates right away
    triggerBackgroundScrape(tracked).catch(() => {});

    res.status(201).json({ tracked, alreadyTracked: false });
  } catch (err) {
    console.error('[tracked-products POST] Error:', err.message);
    res.status(500).json({ error: 'Failed to track product', detail: err.message });
  }
});

// List all tracked products
router.get('/', async (_req, res) => {
  try {
    const items = await db.listTrackedProducts();
    res.json({ items: items || [] });
  } catch (err) {
    console.error('[tracked-products GET] Error:', err.message);
    res.status(500).json({ error: 'Failed to list tracked products', detail: err.message });
  }
});

// Get a single tracked product
router.get('/:id', async (req, res) => {
  try {
    const tracked = await db.getTrackedProduct(req.params.id);
    if (!tracked) {
      return res.status(404).json({ error: 'Product not tracked' });
    }
    const history = await db.getPriceHistory(req.params.id, 1);
    const logs = await db.getScrapeLogs(req.params.id, 1);

    res.json({
      tracked,
      latest: history[0] || null,
      latestLog: logs[0] || null,
    });
  } catch (err) {
    console.error('[tracked-products GET :id] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tracked product', detail: err.message });
  }
});

// Untrack a product
router.delete('/:id', async (req, res) => {
  try {
    await db.deleteTrackedProduct(req.params.id);
    res.json({ deleted: req.params.id });
  } catch (err) {
    console.error('[tracked-products DELETE] Error:', err.message);
    res.status(500).json({ error: 'Failed to untrack product', detail: err.message });
  }
});

// Trigger on-demand scrape for this product
router.post('/:id/scrape', async (req, res) => {
  try {
    const product = await db.getTrackedProduct(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not tracked' });
    }

    const sourceId = product.source_product_id || product.id;
    console.log(`[scrape-on-demand] Scraping product ${sourceId} (${product.name})...`);

    let result;
    try {
      result = await scrapeProduct(sourceId, { headless: config.scraperHeadless });
    } catch (scrapeErr) {
      result = {
        outcome: 'failed',
        attempts: 1,
        failureReason: scrapeErr.message,
      };
    }

    // Always log the scrape attempt
    await db.insertScrapeLog(product.id, result);

    // If successful or retried, insert price history
    if (result.outcome === 'success' || result.outcome === 'retried') {
      await db.insertPriceHistory(product.id, result.price, result.stock);
    }

    res.json({
      success: true,
      productId: product.id,
      outcome: result.outcome,
      price: result.price ?? null,
      stock: result.stock ?? null,
      failureReason: result.failureReason ?? null,
    });
  } catch (err) {
    console.error('[tracked-products :id/scrape] Error:', err.message);
    res.status(500).json({ error: 'Scrape execution failed', detail: err.message });
  }
});

// Get price history for chart rendering
router.get('/:id/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
    const items = await db.getPriceHistory(req.params.id, limit);
    res.json({ items });
  } catch (err) {
    console.error('[history GET] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch price history', detail: err.message });
  }
});

// Get scrape logs
router.get('/:id/logs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
    const items = await db.getScrapeLogs(req.params.id, limit);
    res.json({ items });
  } catch (err) {
    console.error('[logs GET] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch scrape logs', detail: err.message });
  }
});

module.exports = router;
