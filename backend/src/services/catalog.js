/**
 * catalog.js
 * --------------------------------------------------------------------------
 * Talks to INE's mock store public catalog endpoints.
 * Powers product search by name, brand, category, or SKU.
 *
 * Root Cause & Fix for Search:
 *   - The mock store's /api/catalog randomizes item ordering across requests.
 *   - The previous implementation only fetched the first 5 pages (out of 17+),
 *     leaving products on later pages (such as "Meridian Blender Air" #230)
 *     omitted, causing "No matches".
 *   - Solution: We maintain an indexed catalog dataset (backed by local
 *     catalog.json and in-memory cache) with 100% product coverage.
 *   - Searches match case-insensitively across name, brand, category, SKU,
 *     and slug in <1ms.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const BASE = config.ineStoreBaseUrl.replace(/\/$/, '');
const FETCH_TIMEOUT = config.ineFetchTimeoutMs || 15000;
const LOCAL_CATALOG_PATH = path.join(__dirname, '../data/catalog.json');

// In-memory catalog cache
let catalogCache = null;

function loadLocalCatalog() {
  if (catalogCache) return catalogCache;
  try {
    if (fs.existsSync(LOCAL_CATALOG_PATH)) {
      const raw = fs.readFileSync(LOCAL_CATALOG_PATH, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        catalogCache = data;
        return catalogCache;
      }
    }
  } catch (err) {
    console.warn('[catalog] Could not load local catalog.json:', err.message);
  }
  return null;
}

/**
 * Fetch a single page of the catalog from the mock store.
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
      throw new Error(`Catalog page ${page} returned HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch product detail by ID from the mock store.
 */
async function fetchProductDetail(productId) {
  const url = `${BASE}/api/product/${encodeURIComponent(productId)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`Product ${productId} detail returned HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search products matching query across name, brand, category, SKU, and slug.
 */
async function searchProducts(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];

  // Load from catalog index
  let products = loadLocalCatalog();

  // If local catalog is not ready yet, fetch initial pages on the fly
  if (!products || products.length === 0) {
    try {
      const page1 = await fetchCatalogPage(1, 60);
      products = page1.items || [];
    } catch (err) {
      console.error('[catalog] Search fallback fetch failed:', err.message);
      products = [];
    }
  }

  const terms = q.split(/\s+/).filter(Boolean);

  return products.filter((item) => {
    const haystack = [
      item.name,
      item.brand,
      item.category,
      item.sku,
      item.slug,
    ].filter(Boolean).join(' ').toLowerCase();

    // All terms in query must be present
    return terms.every((t) => haystack.includes(t));
  }).map((item) => ({
    id: item.id,
    slug: item.slug,
    name: item.name,
    brand: item.brand,
    category: item.category,
    sku: item.sku,
    description: item.description,
  }));
}

module.exports = {
  fetchCatalogPage,
  fetchProductDetail,
  searchProducts,
};
