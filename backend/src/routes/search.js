/**
 * search.js
 * GET /api/search?q=...
 *   Calls INE's mock store catalog API, filters by name/brand/category,
 *   returns matching products. NO scraping here — this is the cheap path.
 */

const express = require('express');
const { searchProducts } = require('../services/catalog');

const router = express.Router();

router.get('/', async (req, res) => {
  const q = (req.query.q || '').toString();
  if (!q.trim()) {
    return res.status(400).json({ error: 'missing required query param: q' });
  }

  try {
    const results = await searchProducts(q);
    res.json({ query: q, count: results.length, items: results });
  } catch (err) {
    console.error('[search] failed:', err.message);
    res.status(502).json({
      error: 'failed to search the mock store',
      detail: err.message,
    });
  }
});

module.exports = router;
