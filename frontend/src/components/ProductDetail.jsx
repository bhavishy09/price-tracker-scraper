/**
 * ProductDetail.jsx
 * --------------------------------------------------------------------------
 * Per-product detail view:
 *   - Metadata (name, brand, category, SKU)
 *   - Latest price + stock + on-demand scrape button
 *   - Price + stock-over-time chart
 *   - Honest scrape log table (failures included, never hidden)
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
    const t = setInterval(loadAll, 15000);
    return () => clearInterval(t);
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

  if (error) return <div className="card"><p className="error-text">{error}</p></div>;
  if (!tracked) return <div className="card"><p className="muted">Loading…</p></div>;

  const latestHist = history && history.length > 0 ? history[history.length - 1] : null;
  const latestLog = logs && logs.length > 0 ? logs[0] : null;

  // Determine stock text and status
  let stockText = 'no scrape yet';
  let statusSubtext = '';

  if (latestHist) {
    stockText = formatStock(latestHist.stock_quantity);
    statusSubtext = `last scraped ${relativeTime(latestHist.scraped_at)}`;
  } else if (latestLog && latestLog.outcome === 'failed') {
    stockText = `Failed: ${latestLog.failure_reason || 'attempt failed'}`;
    statusSubtext = `attempted ${relativeTime(latestLog.attempted_at)}`;
  }

  return (
    <div className="product-detail">
      <div className="back-link">
        <Link to="/">← back to dashboard</Link>
      </div>

      <section className="card product-head-card">
        <div>
          <h1 className="product-title">{tracked.name}</h1>
          <div className="product-meta">
            {tracked.brand} · {tracked.category} · {tracked.sku}
          </div>
          <div className="product-meta-fine">
            INE source id #{tracked.source_product_id} · tracked since {formatDateTime(tracked.added_at)}
          </div>
        </div>

        <div className="product-head-price">
          <div className="price-big">
            {latestHist ? formatPrice(latestHist.price) : '—'}
          </div>
          <div className={`stock-small ${latestLog && latestLog.outcome === 'failed' && !latestHist ? 'error-text' : ''}`}>
            {stockText}
          </div>
          {statusSubtext && (
            <div className="muted small">
              {statusSubtext}
            </div>
          )}
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginTop: '8px' }}
            disabled={scraping}
            onClick={handleScrapeNow}
          >
            {scraping ? 'Scraping live…' : 'Scrape now'}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Price &amp; stock history</h2>
        <PriceChart history={history} />
      </section>

      <section className="card">
        <h2>Scrape log</h2>
        <p className="muted small">
          Every scrape attempt is logged here — success, retried, or failed.
          Failures are never hidden; the failure reason is shown verbatim.
        </p>
        <ScrapeLogTable logs={logs} />
      </section>
    </div>
  );
}
