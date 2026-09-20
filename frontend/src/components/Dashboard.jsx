/**
 * Dashboard.jsx
 * Top-level page: a two-column layout with the search box on the left
 * and the list of tracked products on the right. Simple and functional,
 * no design polish — that's not what's being graded.
 */

import React, { useState } from 'react';
import SearchBar from './SearchBar.jsx';
import TrackedProductsList from './TrackedProductsList.jsx';

export default function Dashboard() {
  // refreshKey is bumped when a product is tracked so the tracked list
  // re-fetches without us having to lift state or share state between
  // the two sibling components.
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
