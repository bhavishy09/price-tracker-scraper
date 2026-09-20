/**
 * PriceChart.jsx
 * --------------------------------------------------------------------------
 * Renders a price & stock-over-time chart or tabular view.
 * Every successful scrape is one point on the timeline.
 */

import React, { useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { formatPrice, formatStock, formatDateTime } from '../lib/format.js';

export default function PriceChart({ history }) {
  const [viewMode, setViewMode] = useState('chart'); // 'chart' | 'table'

  if (!history || history.length === 0) {
    return (
      <div className="empty-state">
        <p className="muted">No price history recorded yet. Scrapes run automatically every 2 hours via cron, or click "Scrape now" above.</p>
      </div>
    );
  }

  if (history.length === 1 && viewMode === 'chart') {
    const row = history[0];
    return (
      <div>
        <p className="muted">
          First scrape point recorded: <strong>{formatPrice(row.price)}</strong> · {formatStock(row.stock_quantity)} ({formatDateTime(row.scraped_at)}). The line chart will connect points as subsequent scrapes land.
        </p>
        <div style={{ marginTop: '12px' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setViewMode('table')}
          >
            View history table
          </button>
        </div>
      </div>
    );
  }

  // Format data points for recharts
  const data = history.map((r) => ({
    ts: new Date(r.scraped_at).getTime(),
    label: formatDateTime(r.scraped_at),
    price: Number(r.price),
    stock: Number(r.stock_quantity),
  }));

  return (
    <div>
      <div className="section-header-row" style={{ marginTop: 0 }}>
        <span className="muted small">
          {history.length} successful price point{history.length > 1 ? 's' : ''} recorded over time
        </span>
        <div className="tab-group">
          <button
            className={`tab-btn ${viewMode === 'chart' ? 'active' : ''}`}
            onClick={() => setViewMode('chart')}
          >
            Chart
          </button>
          <button
            className={`tab-btn ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
          >
            Table
          </button>
        </div>
      </div>

      {viewMode === 'chart' ? (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: 10 }}>
              <CartesianGrid strokeDasharray="2 2" stroke="#e4e4e7" vertical={false} />
              <XAxis
                dataKey="ts"
                scale="time"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(t) => {
                  const d = new Date(t);
                  return `${d.getDate()} ${d.toLocaleString('en-IN', { month: 'short' })} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
                }}
                tick={{ fontSize: 11, fill: '#71717a' }}
                stroke="#d4d4d8"
              />
              <YAxis
                yAxisId="price"
                tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 11, fill: '#09090b' }}
                stroke="#d4d4d8"
                domain={['auto', 'auto']}
              />
              <YAxis
                yAxisId="stock"
                orientation="right"
                tick={{ fontSize: 11, fill: '#71717a' }}
                stroke="#d4d4d8"
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #18181b',
                  borderRadius: '6px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  fontSize: '12px',
                  fontFamily: 'Inter, sans-serif',
                }}
                formatter={(value, name) => {
                  if (name === 'price') return [formatPrice(value), 'Price'];
                  if (name === 'stock') return [`${value} units`, 'Stock'];
                  return [value, name];
                }}
                labelFormatter={(ts) => formatDateTime(new Date(ts).toISOString())}
              />
              <Legend
                wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                formatter={(name) => (name === 'price' ? 'Price (INR)' : 'Stock quantity')}
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="price"
                stroke="#09090b"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#09090b', strokeWidth: 0 }}
                activeDot={{ r: 6, fill: '#09090b' }}
                isAnimationActive={false}
              />
              <Line
                yAxisId="stock"
                type="monotone"
                dataKey="stock"
                stroke="#71717a"
                strokeWidth={1.8}
                strokeDasharray="4 4"
                dot={{ r: 3, fill: '#71717a', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#71717a' }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="logs-table">
            <thead>
              <tr>
                <th>Scraped at</th>
                <th>Price (INR)</th>
                <th>Stock quantity</th>
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((h) => (
                <tr key={h.id || h.scraped_at}>
                  <td>{formatDateTime(h.scraped_at)}</td>
                  <td style={{ fontWeight: 600 }}>{formatPrice(h.price)}</td>
                  <td>{formatStock(h.stock_quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
