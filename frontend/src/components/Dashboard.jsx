/**
 * Dashboard.jsx
 * --------------------------------------------------------------------------
 * Home page: Two boxes side by side:
 *   Left box:  "Search the mock store" (live INE catalog querying)
 *   Right box: "Tracked products" (current prices, stocks, scrape status)
 *
 * Plus an automated background cron workflow banner.
 */

import React, { useState } from 'react';
import SearchBar from './SearchBar.jsx';
import TrackedProductsList from './TrackedProductsList.jsx';

export default function Dashboard() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div>
      <div className="dashboard">
        <div className="dashboard-col">
          <SearchBar onTracked={() => setRefreshKey((k) => k + 1)} />
        </div>
        <div className="dashboard-col">
          <TrackedProductsList refreshKey={refreshKey} />
        </div>
      </div>

      <div className="automation-banner">
        <div className="automation-icon">⏱</div>
        <div className="automation-text">
          <h4>Automated background scraping workflow</h4>
          <p>
            Every 2 hours, cron-job.org pings the backend trigger endpoint. The backend acquires a mutual-exclusion lock, iterates through each tracked product in a real headless Chromium browser, simulates the human interaction dance to reveal prices, and decrypts the quotes. On success, a new price point is persisted and badged as <strong>✅ success</strong> or <strong>🔁 retried</strong>. If all 3 attempts fail, it safely skips saving bad data and logs <strong>❌ failed</strong> with the exact reason before releasing the lock.
          </p>
        </div>
      </div>
    </div>
  );
}
