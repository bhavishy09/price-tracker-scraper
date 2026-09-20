/**
 * trackedProducts.js
 * --------------------------------------------------------------------------
 * Express endpoints for tracked products, price history, and scrape logs:
 *
 *   POST   /api/tracked-products              Track a new product by source ID
 *   GET    /api/tracked-products              List all tracked products + latest price
 *   GET    /api/tracked-products/:id          Get one product + latest price
 *   DELETE /api/tracked-products/:id          Untrack a product
 *   GET    /api/tracked-products/:id/history  Get price history for charts
 *   GET    /api/tracked-products/:id/logs     Get scrape attempt logs
 */

const express = require('express');
const db = require('../db/store');
const { fetchProductDetail } = require('../services/catalog');

const router = express.Router();

// Track a product
router.post('/', async (req, res) => {
  const { sourceProductId } = req.body || {};
  const id = Number(sourceProductId);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Valid numeric sourceProductId required' });
  }

  try {
    // Check if already tracked
    const existing = await db.findTrackedBySourceId(id);
    if (existing) {
      return res.status(200).json({ tracked: existing, alreadyTracked: true });
    }

    // Fetch rich metadata from INE catalog API
    const detail = await fetchProductDetail(id).catch(() => ({ id }));
    const tracked = await db.addTrackedProduct(detail);

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
    res.json({ tracked, latest: history[0] || null });
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

// Get scrape logs for auditing failures/successes
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
