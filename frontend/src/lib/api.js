/**
 * api.js
 * --------------------------------------------------------------------------
 * Thin fetch wrapper used by every component. Keeps the API surface in one
 * file so reviewers can see exactly what backend calls the frontend makes.
 *
 * BASE_URL resolution:
 *   - If VITE_BACKEND_URL is set (production), use it directly.
 *   - Otherwise use '' (relative path) so Vite's dev-server proxy kicks in.
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
  // Search INE's mock store catalog.
  searchProducts: (q) => httpGet(`/api/search?q=${encodeURIComponent(q)}`),

  // Tracked product CRUD.
  listTracked: () => httpGet('/api/tracked-products'),
  trackProduct: (sourceProductId) =>
    httpPost('/api/tracked-products', { sourceProductId }),
  untrackProduct: (id) => httpDelete(`/api/tracked-products/${id}`),
  getTracked: (id) => httpGet(`/api/tracked-products/${id}`),

  // Per-product history + logs.
  getHistory: (id) => httpGet(`/api/tracked-products/${id}/history`),
  getLogs: (id) => httpGet(`/api/tracked-products/${id}/logs`),

  // Scrape-trigger status (debug — no secret needed).
  getScrapeStatus: () => httpGet('/api/scrape-trigger/status'),
};
