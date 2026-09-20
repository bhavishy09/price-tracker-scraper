/**
 * api.js
 * --------------------------------------------------------------------------
 * Fetch wrapper for frontend API calls.
 */

const BASE_URL = import.meta.env.VITE_BACKEND_URL || '';

async function httpGet(path) {
  const res = await fetch(BASE_URL + path, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function httpPost(path, payload) {
  const res = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function httpPatch(path, payload) {
  const res = await fetch(BASE_URL + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function httpDelete(path) {
  const res = await fetch(BASE_URL + path, { method: 'DELETE' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const api = {
  // Search INE's mock store catalog
  searchProducts: (q) => httpGet(`/api/search?q=${encodeURIComponent(q)}`),

  // Tracked product CRUD
  listTracked: () => httpGet('/api/tracked-products'),
  trackProduct: (sourceProductId) =>
    httpPost('/api/tracked-products', { sourceProductId }),
  updateTracked: (id, updates) => httpPatch(`/api/tracked-products/${id}`, updates),
  untrackProduct: (id) => httpDelete(`/api/tracked-products/${id}`),
  getTracked: (id) => httpGet(`/api/tracked-products/${id}`),

  // Immediate on-demand scrape for a product
  scrapeProductNow: (id) => httpPost(`/api/tracked-products/${id}/scrape`),

  // Per-product history + logs
  getHistory: (id) => httpGet(`/api/tracked-products/${id}/history`),
  getLogs: (id) => httpGet(`/api/tracked-products/${id}/logs`),

  // Scrape lock status
  getScrapeStatus: () => httpGet('/api/scrape-trigger/status'),
};
