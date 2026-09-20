/**
 * ProductDetail.jsx
 * --------------------------------------------------------------------------
 * Product Detail View:
 *   - Metadata (name, brand, category, SKU)
 *   - Current latest price & stock + on-demand live scrape button
 *   - Price & stock history timeline (chart + table view)
 *   - Full scrape attempt log with honest outcomes (✅, 🔁, ❌)
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatPrice, formatStock, formatDateTime, relativeTime } from '../lib/format.js';
import PriceChart from './PriceChart.jsx';
import ScrapeLogTable from './ScrapeLogTable.jsx';

export default function ProductDetail() {
  const { id } = useParams();
  const [tracked, setTracked] = useState(null);
  const [history, setHistory] = useState(null);
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState(null);
  const [scraping, setScraping] = useState(false);
  const [updatingInterval, setUpdatingInterval] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [t, h, l] = await Promise.all([
        api.getTracked(id),
        api.getHistory(id),
        api.getLogs(id),
      ]);
      setTracked(t.tracked);
      setHistory(h.items || []);
      setLogs(l.items || []);
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 12000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const handleScrapeNow = async () => {
    setScraping(true);
    try {
      await api.scrapeProductNow(id);
      await loadAll();
    } catch (err) {
      alert(`Scrape failed: ${err.message}`);
    } finally {
      setScraping(false);
    }
  };

  const handleIntervalChange = async (minutes) => {
    setUpdatingInterval(true);
    try {
      await api.updateTracked(id, { scrape_interval_minutes: minutes });
      setTracked((prev) => ({ ...prev, scrape_interval_minutes: minutes }));
    } catch (err) {
      alert(`Failed to update interval: ${err.message}`);
    } finally {
      setUpdatingInterval(false);
    }
  };

  if (error) {
    return (
      <div className="product-detail">
        <div className="back-link">
          <Link to="/">← Back to dashboard</Link>
        </div>
        <div className="card">
          <p className="error-text">Failed to load product details: {error}</p>
        </div>
      </div>
    );
  }

  if (!tracked) {
    return (
      <div className="product-detail">
        <div className="back-link">
          <Link to="/">← Back to dashboard</Link>
        </div>
        <div className="card">
          <p className="muted">Loading product details…</p>
        </div>
      </div>
    );
  }

  const latestHist = history && history.length > 0 ? history[history.length - 1] : null;
  const latestLog = logs && logs.length > 0 ? logs[0] : null;

  let stockText = 'never scraped';
  let isOutOfStock = false;
  let statusSubtext = '';

  const latestDrop = (history || []).slice().reverse().find((h) => h.is_price_drop);
  const isPriceDropActive = Boolean(latestHist?.is_price_drop || (latestDrop && latestHist && Number(latestHist.price) <= Number(latestDrop.price)));
  const activeDropChange = latestHist?.is_price_drop ? latestHist.price_change : (latestDrop?.price_change || 0);

  const latestStockAlert = (history || []).slice().reverse().find((h) => h.is_back_in_stock);
  const isBackInStockActive = Boolean(latestHist?.is_back_in_stock || (latestStockAlert && latestHist && Number(latestHist.stock_quantity) > 0));

  if (latestHist) {
    stockText = formatStock(latestHist.stock_quantity);
    if (Number(latestHist.stock_quantity) === 0) isOutOfStock = true;
    statusSubtext = `Last scraped ${relativeTime(latestHist.scraped_at)}`;
  } else if (latestLog && latestLog.outcome === 'failed') {
    stockText = 'never scraped';
    statusSubtext = `Last attempt failed: ${latestLog.failure_reason || 'unknown'}`;
  }

  return (
    <div className="product-detail">
      <div className="back-link">
        <Link to="/">← Back to dashboard</Link>
      </div>

      <section className="card product-head-card">
        <div>
          <h1 className="product-title">{tracked.name}</h1>
          <div className="product-meta">
            {tracked.brand} · {tracked.category} {tracked.sku && `· SKU: ${tracked.sku}`}
          </div>
          <div className="product-meta-fine">
            INE catalog source #{tracked.source_product_id} · Tracked since {formatDateTime(tracked.added_at)}
          </div>
          
          {(isPriceDropActive || isBackInStockActive) && (
            <div className="alert-badges-row" style={{ marginTop: '8px' }}>
              {isPriceDropActive && (
                <span
                  className="alert-badge alert-badge-drop"
                  title={activeDropChange ? `Price dropped by ${formatPrice(Math.abs(activeDropChange))}` : 'Price dropped!'}
                >
                  ▼ Price drop {activeDropChange ? `(-${formatPrice(Math.abs(activeDropChange))})` : ''}
                </span>
              )}
              {isBackInStockActive && (
                <span className="alert-badge alert-badge-stock" title="Product is back in stock!">
                  ● Back in stock
                </span>
              )}
            </div>
          )}

          <div className="detail-interval-wrap">
            <span>Scrape frequency:</span>
            <select
              className="interval-select"
              value={tracked.scrape_interval_minutes || 120}
              disabled={updatingInterval}
              onChange={(e) => handleIntervalChange(Number(e.target.value))}
              title="Configure automated scrape schedule for this product"
            >
              <option value={30}>Every 30 minutes</option>
              <option value={60}>Every 1 hour</option>
              <option value={120}>Every 2 hours (default)</option>
              <option value={360}>Every 6 hours</option>
            </select>
            {updatingInterval && <span className="muted small">Saving…</span>}
          </div>
        </div>

        <div className="product-head-price">
          <div className="price-big">
            {latestHist ? formatPrice(latestHist.price) : '—'}
          </div>
          <div className={`stock-small ${isOutOfStock ? 'stock-out' : ''}`}>
            {stockText}
          </div>
          {statusSubtext && (
            <div className="muted small" style={{ marginTop: '2px' }}>
              {statusSubtext}
            </div>
          )}
          <button
            className="btn btn-primary btn-sm"
            style={{ marginTop: '10px' }}
            disabled={scraping}
            onClick={handleScrapeNow}
            title="Trigger headless Playwright scraper live for this product"
          >
            {scraping ? 'Scraping live…' : 'Scrape now'}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-title-group" style={{ marginBottom: '14px' }}>
          <h2>Price &amp; stock history</h2>
          <p className="muted small">
            Every successful scrape becomes one point on the timeline, charting price and inventory movements over hours and days.
          </p>
        </div>
        <PriceChart history={history} />
      </section>

      <section className="card">
        <div className="card-title-group" style={{ marginBottom: '14px' }}>
          <h2>Scrape log (Honest transparency)</h2>
          <p className="muted small">
            Every attempt ever made against this product is recorded here. Nothing is hidden or swept under the rug — failures, timeouts, and bot-challenge retries are logged with their full reason.
          </p>
        </div>
        <ScrapeLogTable logs={logs} />
      </section>
    </div>
  );
}
