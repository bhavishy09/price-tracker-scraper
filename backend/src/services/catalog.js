/**
 * catalog.js
 * --------------------------------------------------------------------------
 * Talks to INE's mock store's PUBLIC catalog endpoints (plain JSON, no
 * anti-bot challenge). These power the "search by name" feature — the
 * scraper is NOT involved in search, only in price/stock retrieval.
 *
 * Recon confirmed endpoints:
 *   GET /api/catalog?page=N&pageSize=M   → { items: [{id, slug, name, brand, category, sku, description}], total, pages }
 *   GET /api/product/:id                 → full detail incl. specs + reviews
 *
 * There's no dedicated search param, so we fetch a few pages and filter
 * client-side by name/brand/category. The mock store has 1000 products
 * across 200 pages of 5 — we cap at ~5 pages of 50 to keep search snappy,
 * which is more than enough for the demo.
 */

const config = require('../config');

const BASE = config.ineStoreBaseUrl.replace(/\/$/, '');
const FETCH_TIMEOUT = config.ineFetchTimeoutMs;

/**
 * Fetch a single page of the catalog.
 * Returns { items, total, pages } or throws on network/HTTP error.
 */
async function fetchCatalogPage(page, pageSize = 50) {
  const url = `${BASE}/api/catalog?page=${page}&pageSize=${pageSize}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`catalog page ${page} returned HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch product detail (specs, reviews, etc.). Used when adding to
 * tracked_products so we can store brand/category/sku at track-time.
 */
async function fetchProductDetail(productId) {
  const url = `${BASE}/api/product/${encodeURIComponent(productId)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`product ${productId} detail returned HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search the mock store for products whose name/brand/category/sku
 * contains the query string (case-insensitive). Returns an array of
 * compact product objects the React frontend can show.
 *
 * Implementation note: there is no server-side search param, so we
 * fetch up to `maxPages` pages of the catalog and filter client-side.
 * This is fine for 1000 products; for larger catalogs we'd push the
 * filter down to a backend index.
 */
async function searchProducts(query, maxPages = 5, pageSize = 50) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];

  const matches = [];
  for (let p = 1; p <= maxPages; p++) {
    let page;
    try {
      page = await fetchCatalogPage(p, pageSize);
    } catch (err) {
      // Surface a clean error to the API caller rather than crashing.
      throw new Error(`failed to fetch catalog page ${p}: ${err.message}`);
    }
    if (!page || !Array.isArray(page.items)) break;

    for (const item of page.items) {
      const haystack = [
        item.name,
        item.brand,
        item.category,
        item.sku,
        item.slug,
      ].filter(Boolean).join(' ').toLowerCase();

      if (haystack.includes(q)) {
        matches.push({
          id: item.id,
          slug: item.slug,
          name: item.name,
          brand: item.brand,
          category: item.category,
          sku: item.sku,
          description: item.description,
        });
      }
    }
    // Stop early if we've walked every page the store reports.
    if (p >= (page.pages || 1)) break;
  }
  return matches;
}

module.exports = { fetchCatalogPage, fetchProductDetail, searchProducts };
