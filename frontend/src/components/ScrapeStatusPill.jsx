/**
 * ScrapeStatusPill.jsx
 * Small green/grey pill that shows whether a scrape is currently running.
 * Polls /api/scrape-trigger/status every 30s. Cheap because the endpoint
 * is a single DB row read.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function ScrapeStatusPill() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const s = await api.getScrapeStatus();
        if (!cancelled) { setStatus(s); setError(false); }
      } catch {
        if (!cancelled) setError(true);
      }
    }
    poll();
    const t = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (error) {
    return (
      <span className="pill pill-error" title="Backend / DB unreachable">
        <span className="pill-dot" /> scrape: offline
      </span>
    );
  }
  if (!status) {
    return (
      <span className="pill pill-idle">
        <span className="pill-dot" /> scrape: …
      </span>
    );
  }
  if (status.is_running) {
    return (
      <span className="pill pill-running" title={`started ${status.started_at}`}>
        <span className="pill-dot" /> scrape: running
      </span>
    );
  }
  return (
    <span className="pill pill-idle">
      <span className="pill-dot" /> scrape: idle
    </span>
  );
}
