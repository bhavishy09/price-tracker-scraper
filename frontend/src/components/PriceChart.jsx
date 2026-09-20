/**
 * PriceChart.jsx
 * Renders a price + stock-over-time chart using Recharts (a thin React
 * wrapper around D3). Falls back to a table when there's <2 data points
 * (a chart with 1 point is useless).
 *
 * The chart shows BOTH price (line) and stock (line on a second axis)
 * because the assignment asks for "price and stock over time".
 */

import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { formatPrice, formatDateTime } from '../lib/format.js';

export default function PriceChart({ history }) {
  if (!history || history.length === 0) {
    return <p className="muted">No price history yet. Scrape runs every 2 hours.</p>;
  }
  if (history.length === 1) {
    const row = history[0];
    return (
      <p className="muted">
        Only one scrape so far: <strong>{formatPrice(row.price)}</strong> ·
        stock {row.stock_quantity}. The chart fills in as more scrapes land.
      </p>
    );
  }

  // Map DB rows to chart points. Use the ISO string as the X axis label
  // but render a short formatted version in the tooltip.
  const data = history.map((r) => ({
    ts: new Date(r.scraped_at).getTime(),
    label: formatDateTime(r.scraped_at),
    price: Number(r.price),
    stock: Number(r.stock_quantity),
  }));

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="ts"
            scale="time"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(t) => formatDateTime(new Date(t).toISOString()).split(',')[0]}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            yAxisId="price"
            tickFormatter={(v) => `₹${(v / 1000).toFixed(1)}k`}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            yAxisId="stock"
            orientation="right"
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            formatter={(value, name) => {
              if (name === 'price') return [formatPrice(value), 'Price'];
              if (name === 'stock') return [`${value} units`, 'Stock'];
              return [value, name];
            }}
            labelFormatter={(label) => formatDateTime(new Date(label).toISOString())}
          />
          <Legend formatter={(name) => (name === 'price' ? 'Price (INR)' : 'Stock qty')} />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="price"
            stroke="#2b6cb0"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
          <Line
            yAxisId="stock"
            type="monotone"
            dataKey="stock"
            stroke="#38a169"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
