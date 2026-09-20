/**
 * format.js
 * Small formatting helpers so components stay readable.
 */

export function formatPrice(price) {
  if (price === null || price === undefined) return '—';
  const n = Number(price);
  if (!Number.isFinite(n)) return '—';
  // Indian-style grouping (lakhs) — appropriate for an INR mock store.
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatStock(stock) {
  if (stock === null || stock === undefined) return '—';
  const n = Number(stock);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return 'Out of stock';
  return `${n} in stock`;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    }).format(d);
  } catch {
    return String(iso);
  }
}

export function relativeTime(iso) {
  if (!iso) return 'never';
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.round((d - now) / 1000); // seconds
  const abs = Math.abs(diff);
  if (abs < 60) return diff >= 0 ? 'in a few seconds' : 'a few seconds ago';
  if (abs < 3600) return diff >= 0 ? `in ${Math.round(abs / 60)} min` : `${Math.round(abs / 60)} min ago`;
  if (abs < 86400) return diff >= 0 ? `in ${Math.round(abs / 3600)} h` : `${Math.round(abs / 3600)} h ago`;
  return formatDateTime(iso);
}
