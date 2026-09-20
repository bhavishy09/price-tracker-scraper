/**
 * ScrapeLogTable.jsx
 * --------------------------------------------------------------------------
 * Renders every scrape attempt for a product, newest first.
 *
 * Outcomes are explicitly badged with honest status icons:
 *   ✅ success
 *   🔁 retried
 *   ❌ failed (with verbatim failure reason shown)
 *
 * This is the "honesty" part — nothing gets swept under the rug.
 */

import React from 'react';
import { formatDateTime, formatPrice, formatStock } from '../lib/format.js';

export default function ScrapeLogTable({ logs }) {
  if (!logs || logs.length === 0) {
    return <p className="muted small">No scrape attempts logged yet for this product.</p>;
  }

  const renderBadge = (outcome) => {
    switch (outcome) {
      case 'success':
        return <span className="badge badge-success">✅ success</span>;
      case 'retried':
        return <span className="badge badge-retried">🔁 retried</span>;
      case 'failed':
        return <span className="badge badge-failed">❌ failed</span>;
      default:
        return <span className="badge">{outcome}</span>;
    }
  };

  return (
    <div className="table-responsive">
      <table className="logs-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Outcome</th>
            <th>Attempts</th>
            <th>Price seen</th>
            <th>Stock seen</th>
            <th>Reason / Diagnostics</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id || l.attempted_at} className={`log-row log-${l.outcome}`}>
              <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(l.attempted_at)}</td>
              <td>{renderBadge(l.outcome)}</td>
              <td style={{ textAlign: 'center' }}>{l.attempts_made ?? 1}</td>
              <td>{l.price_seen !== null && l.price_seen !== undefined ? formatPrice(l.price_seen) : '—'}</td>
              <td>{l.stock_seen !== null && l.stock_seen !== undefined ? formatStock(l.stock_seen) : '—'}</td>
              <td className="reason-cell">
                {l.failure_reason ? (
                  <span>{l.failure_reason}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
