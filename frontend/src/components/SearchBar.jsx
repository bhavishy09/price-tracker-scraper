/**
 * SearchBar.jsx
 * --------------------------------------------------------------------------
 * Left box on dashboard: "Search the mock store".
 *
 * Hits INE's public catalog API directly (via backend /api/search?q=...).
 * No scraping happens here — it's pure catalog querying with live debouncing.
 * Each result displays a "Track" button to immediately add it to tracked products.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';

export default function SearchBar({ onTracked }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [trackingId, setTrackingId] = useState(null);

  // Debounce input to smoothly query without overwhelming backend
  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await api.searchProducts(q.trim());
        if (!cancelled) {
          setResults(res.items || []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const handleTrack = useCallback(async (product) => {
    setTrackingId(product.id);
    try {
      await api.trackProduct(product.id);
      // Remove from search result list to give instant feedback
      setResults((prev) => prev.filter((p) => p.id !== product.id));
      if (onTracked) onTracked();
    } catch (err) {
      alert(`Failed to track product: ${err.message}`);
    } finally {
      setTrackingId(null);
    }
  }, [onTracked]);

  return (
    <section className="card search-card">
      <div className="card-header-row">
        <div className="card-title-group">
          <h2>Search the mock store</h2>
          <p className="muted small">
            Type part of a product name (e.g. "charger" or "blender"). Hits INE's public catalog API live — no scraping here.
          </p>
        </div>
      </div>

      <div className="search-input-wrap">
        <span className="search-icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </span>
        <input
          type="search"
          className="search-input"
          placeholder="Search product name, brand, SKU (e.g. blender, ring, charger)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>

      {loading && <p className="muted small">Searching catalog live…</p>}
      {error && <p className="error-text small">Search error: {error}</p>}
      
      {!loading && !error && q.trim() && results.length === 0 && (
        <div className="empty-state">
          <p className="muted">No products found matching “{q}”.</p>
        </div>
      )}

      {results.length > 0 && (
        <ul className="search-results">
          {results.slice(0, 30).map((p) => (
            <li key={`${p.id}-${p.sku}`} className="search-result">
              <div className="search-result-info">
                <div className="search-result-name">{p.name}</div>
                <div className="search-result-meta">
                  {p.brand} · {p.category} {p.sku && `· ${p.sku}`}
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm"
                disabled={trackingId === p.id}
                onClick={() => handleTrack(p)}
                title="Track this product for automatic price & stock scraping"
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
