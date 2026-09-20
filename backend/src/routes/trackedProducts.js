/**
 * trackedProducts.js
 * --------------------------------------------------------------------------
 * CRUD for tracked_products + nested history and logs.
 *
 *   POST   /api/tracked-products            add a product by source id
 *   GET    /api/tracked-products            list all tracked products
 *   GET    /api/tracked-products/:id        get one (with latest price)
 *   DELETE /api/tracked-products/:id        untrack
 *   GET    /api/tracked-products/:id/history  price_history rows
 *   GET    /api/tracked-products/:id/logs     scrape_logs rows
 *
 * We don't try to be clever — each route is a thin wrapper around a
 * Supabase query, with clear error responses so the frontend can show
 * what went wrong.
 */

const express = require('express');
const { getSupabase } = require('../db/supabase');
const { fetchProductDetail } = require('../services/catalog');

const router = express.Router();

// -------------------------------------------------------------------------
// POST /api/tracked-products
//   body: { sourceProductId: 921 }
//   We fetch the product detail from INE so we can store name/brand/etc
//   at track-time. This makes the tracked list fast to render later
//   (no need to re-query INE on every dashboard load).
// -------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const { sourceProductId } = req.body || {};
  const id = Number(sourceProductId);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'body must include numeric sourceProductId > 0' });
  }

  try {
    // Check if already tracked — idempotent track.
    const sb = getSupabase();
    const { data: existing } = await sb
      .from('tracked_products')
      .select('*')
      .eq('source_product_id', id)
      .maybeSingle();
    if (existing) {
      return res.status(200).json({ tracked: existing, alreadyTracked: true });
    }

    // Fetch detail from the mock store so we can store rich metadata.
    const detail = await fetchProductDetail(id).catch((err) => {
      throw new Error(`could not fetch product detail from INE: ${err.message}`);
    });

    const insert = {
      source_product_id: id,
      slug: detail.slug || null,
      name: detail.name || `Product ${id}`,
      brand: detail.brand || null,
      category: detail.category || null,
      sku: detail.sku || null,
    };
    const { data: inserted, error } = await sb
      .from('tracked_products')
      .insert(insert)
      .select()
      .single();
    if (error) {
      // Race-condition guard: another request may have inserted in parallel.
      if (error.code === '23505') {
        const { data: race } = await sb
          .from('tracked_products')
          .select('*')
          .eq('source_product_id', id)
          .maybeSingle();
        return res.status(200).json({ tracked: race, alreadyTracked: true });
      }
      throw new Error(`insert failed: ${error.message}`);
    }
    res.status(201).json({ tracked: inserted, alreadyTracked: false });
  } catch (err) {
    console.error('[tracked-products POST] failed:', err.message);
    res.status(502).json({ error: 'failed to track product', detail: err.message });
  }
});

// -------------------------------------------------------------------------
// GET /api/tracked-products
//   Returns all tracked products, joined with their latest price/stock.
//   We use the `latest_price_per_product` view defined in schema.sql so
//   the frontend can render the dashboard with ONE round-trip.
// -------------------------------------------------------------------------
router.get('/', async (_req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('latest_price_per_product')
      .select('*')
      .order('added_at', { referencedTable: 'tracked_products', ascending: false });
    // (The view doesn't have added_at; fall back to fetching the table.)
    let rows = data;
    if (error || !rows) {
      const { data: fallback, error: e2 } = await sb
        .from('tracked_products')
        .select('*')
        .order('added_at', { ascending: false });
      if (e2) throw new Error(`list failed: ${e2.message}`);
      rows = fallback;
    }
    res.json({ items: rows || [] });
  } catch (err) {
    console.error('[tracked-products GET] failed:', err.message);
    res.status(500).json({ error: 'failed to list tracked products', detail: err.message });
  }
});

// -------------------------------------------------------------------------
// GET /api/tracked-products/:id  (one tracked product + latest price)
// -------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('tracked_products')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`fetch failed: ${error.message}`);
    if (!data) return res.status(404).json({ error: 'not tracked' });

    // Latest known price (one extra query, kept simple).
    const { data: latest } = await sb
      .from('price_history')
      .select('price, stock_quantity, scraped_at')
      .eq('tracked_product_id', id)
      .order('scraped_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    res.json({ tracked: data, latest: latest || null });
  } catch (err) {
    console.error('[tracked-products GET :id] failed:', err.message);
    res.status(500).json({ error: 'failed to fetch tracked product', detail: err.message });
  }
});

// -------------------------------------------------------------------------
// DELETE /api/tracked-products/:id  (untrack — cascades to history/logs)
// -------------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const sb = getSupabase();
    const { error } = await sb.from('tracked_products').delete().eq('id', id);
    if (error) throw new Error(`delete failed: ${error.message}`);
    res.json({ deleted: id });
  } catch (err) {
    console.error('[tracked-products DELETE :id] failed:', err.message);
    res.status(500).json({ error: 'failed to untrack product', detail: err.message });
  }
});

// -------------------------------------------------------------------------
// GET /api/tracked-products/:id/history  (price_history rows for charts)
// -------------------------------------------------------------------------
router.get('/:id/history', async (req, res) => {
  const id = req.params.id;
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('price_history')
      .select('id, price, stock_quantity, scraped_at')
      .eq('tracked_product_id', id)
      .order('scraped_at', { ascending: true })
      .limit(limit);
    if (error) throw new Error(`history fetch failed: ${error.message}`);
    res.json({ items: data || [] });
  } catch (err) {
    console.error('[history] failed:', err.message);
    res.status(500).json({ error: 'failed to fetch price history', detail: err.message });
  }
});

// -------------------------------------------------------------------------
// GET /api/tracked-products/:id/logs  (scrape_logs rows — failures shown)
// -------------------------------------------------------------------------
router.get('/:id/logs', async (req, res) => {
  const id = req.params.id;
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('scrape_logs')
      .select('id, attempted_at, outcome, attempts_made, failure_reason, price_seen, stock_seen')
      .eq('tracked_product_id', id)
      .order('attempted_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`logs fetch failed: ${error.message}`);
    res.json({ items: data || [] });
  } catch (err) {
    console.error('[logs] failed:', err.message);
    res.status(500).json({ error: 'failed to fetch scrape logs', detail: err.message });
  }
});

module.exports = router;
