/**
 * SearchBar.jsx
 * A controlled search input with a results list. Calls /api/search?q=...
 * with a small debounce so we don't hammer the backend on every keystroke.
 *
 * Each result has a "Track" button. Clicking it POSTs to
 * /api/tracked-products and removes the item from the visible search
 * results (it'll show up in the tracked list below).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';

export default function SearchBar({ onTracked }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [trackingId, setTrackingId] = useState(null);

  // Debounce the search by 350ms so typing "domus" makes 1 request, not 5.
  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.searchProducts(q.trim());
        if (!cancelled) { setResults(r.items || []); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const track = useCallback(async (product) => {
    setTrackingId(product.id);
    try {
      await api.trackProduct(product.id);
      // Hide from search results so the user sees immediate feedback.
      setResults((prev) => prev.filter((p) => p.id !== product.id));
      onTracked && onTracked();
    } catch (err) {
      alert(`Failed to track: ${err.message}`);
    } finally {
      setTrackingId(null);
    }
  }, [onTracked]);

  return (
    <section className="card search-card">
      <h2>Search the mock store</h2>
      <p className="muted">
        Type a product name, brand, category or SKU. Search hits INE's
        public catalog API directly — no scraping here.
      </p>
      <input
        type="search"
        className="search-input"
        placeholder="e.g. domus, webcam, AUR-10036…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />

      {loading && <p className="muted">Searching…</p>}
      {error && <p className="error-text">Search failed: {error}</p>}
      {!loading && !error && q.trim() && results.length === 0 && (
        <p className="muted">No matches.</p>
      )}

      {results.length > 0 && (
        <ul className="search-results">
          {results.slice(0, 30).map((p) => (
            <li key={`${p.id}-${p.sku}`} className="search-result">
              <div className="search-result-info">
                <div className="search-result-name">{p.name}</div>
                <div className="search-result-meta">
                  {p.brand} · {p.category} · {p.sku}
                </div>
              </div>
              <button
                className="btn btn-primary"
                disabled={trackingId === p.id}
                onClick={() => track(p)}
              >
                {trackingId === p.id ? 'Tracking…' : 'Track'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
