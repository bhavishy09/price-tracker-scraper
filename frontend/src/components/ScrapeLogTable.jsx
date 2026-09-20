/**
 * ScrapeLogTable.jsx
 * Renders every scrape attempt for a product, newest first.
 *
 * Outcomes are color-coded so failures are IMPOSSIBLE to miss:
 *   success = green badge
 *   retried = amber badge
 *   failed  = red badge (with the honest failure reason shown)
 *
 * This is the "honest history" column — it must never hide a failure.
 */

import React from 'react';
import { formatDateTime, formatPrice, formatStock } from '../lib/format.js';

export default function ScrapeLogTable({ logs }) {
  if (!logs || logs.length === 0) {
    return <p className="muted">No scrape attempts logged yet.</p>;
  }
  return (
    <table className="logs-table">
      <thead>
        <tr>
          <th>When</th>
          <th>Outcome</th>
          <th>Attempts</th>
          <th>Price seen</th>
          <th>Stock seen</th>
          <th>Failure reason</th>
        </tr>
      </thead>
      <tbody>
        {logs.map((l) => (
          <tr key={l.id} className={`log-row log-${l.outcome}`}>
            <td>{formatDateTime(l.attempted_at)}</td>
            <td><span className={`badge badge-${l.outcome}`}>{l.outcome}</span></td>
            <td>{l.attempts_made}</td>
            <td>{l.price_seen !== null && l.price_seen !== undefined ? formatPrice(l.price_seen) : '—'}</td>
            <td>{l.stock_seen !== null && l.stock_seen !== undefined ? formatStock(l.stock_seen) : '—'}</td>
            <td className="reason-cell">{l.failure_reason || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
