/**
 * TrackedProductsList.jsx
 * --------------------------------------------------------------------------
 * Lists tracked products on the dashboard with their latest price, stock,
 * scrape outcome, and on-demand scrape triggers.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatPrice, formatStock, relativeTime } from '../lib/format.js';

export default function TrackedProductsList({ refreshKey }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [scrapingId, setScrapingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await api.listTracked();
      setItems(r.items || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    // Refresh periodically so live scrapes reflect automatically
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load, refreshKey]);

  const untrack = useCallback(async (id) => {
    setBusy(id);
    try {
      await api.untrackProduct(id);
      setItems((prev) => (prev || []).filter((p) => (p.tracked_product_id || p.id) !== id));
    } catch (err) {
      alert(`Failed to untrack: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const scrapeNow = useCallback(async (id) => {
    setScrapingId(id);
    try {
      await api.scrapeProductNow(id);
      await load();
    } catch (err) {
      alert(`Scrape failed: ${err.message}`);
    } finally {
      setScrapingId(null);
    }
  }, [load]);

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Tracked products <span className="count">({items.length})</span></h2>
        <button
          className="btn btn-ghost btn-sm"
          onClick={load}
          title="Refresh list"
        >
          ↻ Refresh
        </button>
      </div>

      <ul className="tracked-list">
        {items.map((p) => {
          const id = p.tracked_product_id || p.id;
          const name = p.name;
          const brand = p.brand;
          const category = p.category;

          // Support both naming conventions from view and store
          const price = p.latest_price ?? p.price;
          const stock = p.latest_stock ?? p.stock_quantity;
          const scrapedAt = p.latest_scraped_at ?? p.scraped_at;
          const outcome = p.latest_outcome;
          const lastAttempt = p.last_attempt_at;
          const failureReason = p.failure_reason;

          const isScraping = scrapingId === id;

          // Compute status display text
          let statusText = 'never scraped';
          let statusClass = 'muted';

          if (isScraping) {
            statusText = 'scraping now…';
            statusClass = 'pill-running';
          } else if (outcome === 'failed') {
            statusText = failureReason ? `failed: ${failureReason}` : 'scrape failed';
            if (lastAttempt) statusText += ` (${relativeTime(lastAttempt)})`;
            statusClass = 'error-text';
          } else if (scrapedAt) {
            statusText = relativeTime(scrapedAt);
            statusClass = '';
          }

          return (
            <li key={id} className="tracked-row">
              <div className="tracked-info">
                <Link to={`/product/${id}`} className="tracked-name">{name}</Link>
                <div className="tracked-meta">
                  {brand}{brand && category ? ' · ' : ''}{category}
                </div>
              </div>

              <div className="tracked-price">
                <div className="price-big">{formatPrice(price)}</div>
                <div className="stock-small">{formatStock(stock)}</div>
              </div>

              <div className={`tracked-time ${statusClass}`} title={scrapedAt || lastAttempt || ''}>
                {statusText}
              </div>

              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={isScraping || busy === id}
                  onClick={() => scrapeNow(id)}
                  title="Run scraper now for this product"
                >
                  {isScraping ? 'Scraping…' : 'Scrape'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy === id || isScraping}
                  onClick={() => untrack(id)}
                  title="Stop tracking this product"
                >
                  {busy === id ? '…' : '✕'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
