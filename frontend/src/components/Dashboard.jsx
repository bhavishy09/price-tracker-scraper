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
    <div className="dashboard">
      <div className="dashboard-col">
        <SearchBar onTracked={() => setRefreshKey((k) => k + 1)} />
      </div>
      <div className="dashboard-col">
        <TrackedProductsList refreshKey={refreshKey} />
      </div>
    </div>
  );
}
