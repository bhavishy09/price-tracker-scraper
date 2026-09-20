/**
 * TrackedProductsList.jsx
 * The right column of the dashboard. Lists every tracked product with
 * its latest known price + stock, and a link to the per-product detail
 * page (chart + scrape logs).
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatPrice, formatStock, relativeTime } from '../lib/format.js';

export default function TrackedProductsList({ refreshKey }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await api.listTracked();
      setItems(r.items || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const untrack = useCallback(async (id) => {
    setBusy(id);
    try {
      await api.untrackProduct(id);
      setItems((prev) => (prev || []).filter((p) => p.tracked_product_id !== id && p.id !== id));
    } catch (err) {
      alert(`Failed to untrack: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }, []);

  if (error) return <p className="error-text">Failed to load tracked products: {error}</p>;
  if (items === null) return <p className="muted">Loading tracked products…</p>;
  if (items.length === 0) {
    return (
      <section className="card">
        <h2>Tracked products</h2>
        <p className="muted">Nothing tracked yet. Search above and click “Track”.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Tracked products <span className="count">({items.length})</span></h2>
      <ul className="tracked-list">
        {items.map((p) => {
          // The latest_price_per_product view exposes fields with these names;
          // the plain tracked_products row falls back to id/name.
          const id = p.tracked_product_id || p.id;
          const name = p.name;
          const brand = p.brand;
          const category = p.category;
          const latestPrice = p.latest_price;
          const latestStock = p.latest_stock;
          const latestAt = p.latest_scraped_at;
          return (
            <li key={id} className="tracked-row">
              <div className="tracked-info">
                <Link to={`/product/${id}`} className="tracked-name">{name}</Link>
                <div className="tracked-meta">
                  {brand}{brand && category ? ' · ' : ''}{category}
                </div>
              </div>
              <div className="tracked-price">
                <div className="price-big">{formatPrice(latestPrice)}</div>
                <div className="stock-small">{formatStock(latestStock)}</div>
              </div>
              <div className="tracked-time" title={latestAt || ''}>
                {latestAt ? relativeTime(latestAt) : 'never scraped'}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy === id}
                onClick={() => untrack(id)}
                title="Stop tracking this product"
              >
                {busy === id ? '…' : '✕'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
