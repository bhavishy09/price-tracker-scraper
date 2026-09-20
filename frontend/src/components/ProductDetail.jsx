/**
 * ProductDetail.jsx
 * Per-product page. Shows:
 *   - the tracked product's metadata (name, brand, category, sku)
 *   - latest known price + stock
 *   - a price + stock-over-time chart
 *   - the full scrape log table (failures included, never hidden)
 *
 * Polls its own data every 30s so a viewer can watch the latest scrape
 * come in (and watch failures show up honestly) without manual refresh.
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
    // Poll every 30s — cheap and lets a viewer see new scrapes land live.
    const t = setInterval(loadAll, 30_000);
    return () => clearInterval(t);
  }, [loadAll]);

  if (error) return <div className="card"><p className="error-text">{error}</p></div>;
  if (!tracked) return <div className="card"><p className="muted">Loading…</p></div>;

  const latestHist = history && history.length > 0 ? history[history.length - 1] : null;

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
          <div className="stock-small">
            {latestHist ? formatStock(latestHist.stock_quantity) : 'no scrape yet'}
          </div>
          <div className="muted small">
            {latestHist ? `last scraped ${relativeTime(latestHist.scraped_at)}` : ''}
          </div>
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
