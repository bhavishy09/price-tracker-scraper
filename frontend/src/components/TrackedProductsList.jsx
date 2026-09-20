/**
 * TrackedProductsList.jsx
 * --------------------------------------------------------------------------
 * Right box on dashboard: "Tracked products".
 *
 * Shows every tracked product with:
 *   - Name (clickable link to /product/:id)
 *   - Brand / Category
 *   - Latest known price & stock (or "—" / "never scraped")
 *   - Scrape status ("scrape: idle" or "scrape: running" or last scraped)
 *   - On-demand "Scrape" button
 *   - "✕" untrack button
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatPrice, formatStock, relativeTime } from '../lib/format.js';

export default function TrackedProductsList({ refreshKey }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [busyUntrackId, setBusyUntrackId] = useState(null);
  const [scrapingId, setScrapingId] = useState(null);
  const [updatingIntervalId, setUpdatingIntervalId] = useState(null);
  const [globalStatus, setGlobalStatus] = useState({ is_running: false });

  const loadData = useCallback(async () => {
    try {
      const [listRes, statusRes] = await Promise.all([
        api.listTracked(),
        api.getScrapeStatus().catch(() => ({ is_running: false })),
      ]);
      setItems(listRes.items || []);
      setGlobalStatus(statusRes);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData, refreshKey]);

  const handleUntrack = useCallback(async (id) => {
    setBusyUntrackId(id);
    try {
      await api.untrackProduct(id);
      setItems((prev) => (prev || []).filter((p) => (p.tracked_product_id || p.id) !== id));
    } catch (err) {
      alert(`Failed to untrack: ${err.message}`);
    } finally {
      setBusyUntrackId(null);
    }
  }, []);

  const handleScrapeNow = useCallback(async (id) => {
    setScrapingId(id);
    try {
      await api.scrapeProductNow(id);
      await loadData();
    } catch (err) {
      alert(`Scrape attempt failed: ${err.message}`);
    } finally {
      setScrapingId(null);
    }
  }, [loadData]);

  const handleIntervalChange = useCallback(async (id, minutes) => {
    setUpdatingIntervalId(id);
    try {
      await api.updateTracked(id, { scrape_interval_minutes: minutes });
      setItems((prev) =>
        (prev || []).map((p) =>
          (p.tracked_product_id || p.id) === id
            ? { ...p, scrape_interval_minutes: minutes }
            : p
        )
      );
    } catch (err) {
      alert(`Failed to update interval: ${err.message}`);
    } finally {
      setUpdatingIntervalId(null);
    }
  }, []);

  if (error) {
    return (
      <section className="card tracked-card">
        <h2>Tracked products</h2>
        <p className="error-text">Failed to load tracked products: {error}</p>
      </section>
    );
  }

  if (items === null) {
    return (
      <section className="card tracked-card">
        <h2>Tracked products</h2>
        <p className="muted small">Loading tracked products…</p>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="card tracked-card">
        <div className="card-header-row">
          <div className="card-title-group">
            <h2>Tracked products <span className="count">(0)</span></h2>
            <p className="muted small">Nothing tracked yet. Search on the left and click "Track".</p>
          </div>
        </div>
        <div className="empty-state">
          <p className="muted">Your tracked product list is currently empty.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="card tracked-card">
      <div className="card-header-row">
        <div className="card-title-group">
          <h2>Tracked products <span className="count">({items.length})</span></h2>
          <p className="muted small">
            Click any product to view its historical price chart and full scrape logs.
          </p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={loadData}
          title="Refresh tracked list"
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

          const price = p.latest_price ?? p.price;
          const stock = p.latest_stock ?? p.stock_quantity;
          const scrapedAt = p.latest_scraped_at ?? p.scraped_at;
          const outcome = p.latest_outcome;
          const lastAttempt = p.last_attempt_at;
          const failureReason = p.failure_reason;

          const isRowScraping = scrapingId === id || (globalStatus.is_running && !scrapedAt);

          // Format price & stock or "never scraped"
          const hasPrice = price !== null && price !== undefined && Number(price) > 0;
          const priceDisplay = hasPrice ? formatPrice(price) : '—';
          
          let stockDisplay = 'never scraped';
          let isOutOfStock = false;

          if (stock !== null && stock !== undefined) {
            stockDisplay = formatStock(stock);
            if (Number(stock) === 0) isOutOfStock = true;
          } else if (outcome === 'failed') {
            stockDisplay = 'never scraped';
          }

          // Format status indicator
          let statusText = 'scrape: idle';
          let statusClass = 'muted';

          if (isRowScraping) {
            statusText = 'scrape: running';
            statusClass = 'pill-running';
          } else if (outcome === 'failed') {
            statusText = 'scrape: failed';
            statusClass = 'error-text';
          } else if (scrapedAt) {
            statusText = relativeTime(scrapedAt);
            statusClass = 'muted';
          }

          return (
            <li key={id} className="tracked-row">
              <div className="tracked-row-main">
                <div className="tracked-info">
                  <Link to={`/product/${id}`} className="tracked-name" title={`View ${name} details`}>
                    {name}
                  </Link>
                  <div className="tracked-meta">
                    {brand}{brand && category ? ' · ' : ''}{category}
                  </div>
                  {(p.is_price_drop || p.is_back_in_stock) && (
                    <div className="alert-badges-row">
                      {p.is_price_drop && (
                        <span
                          className="alert-badge alert-badge-drop"
                          title={p.price_change ? `Price dropped by ${formatPrice(Math.abs(p.price_change))}` : 'Price dropped!'}
                        >
                          ▼ Price drop {p.price_change ? `(-${formatPrice(Math.abs(p.price_change))})` : ''}
                        </span>
                      )}
                      {p.is_back_in_stock && (
                        <span className="alert-badge alert-badge-stock" title="Product is back in stock!">
                          ● Back in stock
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="tracked-price">
                  <div className="price-big">{priceDisplay}</div>
                  <div className={`stock-small ${isOutOfStock ? 'stock-out' : ''}`}>
                    {stockDisplay}
                  </div>
                </div>
              </div>

              <div className="tracked-row-footer">
                <div className={`tracked-status ${statusClass}`} title={scrapedAt || lastAttempt || failureReason || ''}>
                  {statusText}
                </div>

                <div className="tracked-actions">
                  <select
                    className="interval-select"
                    value={p.scrape_interval_minutes || 120}
                    disabled={updatingIntervalId === id || isRowScraping}
                    onChange={(e) => handleIntervalChange(id, Number(e.target.value))}
                    title="Configurable scrape frequency"
                    aria-label={`Scrape frequency for ${name}`}
                  >
                    <option value={30}>Every 30m</option>
                    <option value={60}>Every 1h</option>
                    <option value={120}>Every 2h</option>
                    <option value={360}>Every 6h</option>
                  </select>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={isRowScraping || busyUntrackId === id}
                    onClick={() => handleScrapeNow(id)}
                    title="Run live Playwright scraper for this product now"
                  >
                    {isRowScraping ? 'Scraping…' : 'Scrape'}
                  </button>
                  <Link
                    to={`/product/${id}`}
                    className="btn btn-secondary btn-sm"
                    title={`View full scrape logs and price history for ${name}`}
                  >
                    See logs
                  </Link>
                  <button
                    className="btn-untrack"
                    disabled={busyUntrackId === id || isRowScraping}
                    onClick={() => handleUntrack(id)}
                    title="Untrack this product"
                    aria-label={`Untrack ${name}`}
                  >
                    {busyUntrackId === id ? '…' : '✕'}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
