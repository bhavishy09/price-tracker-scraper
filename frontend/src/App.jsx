/**
 * App.jsx
 * --------------------------------------------------------------------------
 * Top-level application shell with modern black & white navigation bar,
 * live scrape status indicator, and routing to Dashboard and ProductDetail.
 */

import React from 'react';
import { Routes, Route, NavLink, Link } from 'react-router-dom';
import Dashboard from './components/Dashboard.jsx';
import ProductDetail from './components/ProductDetail.jsx';
import ScrapeStatusPill from './components/ScrapeStatusPill.jsx';
import NotificationsBell from './components/NotificationsBell.jsx';

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="brand">
            <span className="brand-dot" aria-hidden="true">₹</span>
            <span className="brand-name">INE Price Tracker</span>
          </Link>
          <nav className="app-nav">
            <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
              Dashboard
            </NavLink>
            <a href="https://demo.inelabteamdev.com/" target="_blank" rel="noreferrer" className="nav-external">
              Mock store <span>↗</span>
            </a>
          </nav>
          <div className="header-right-actions">
            <ScrapeStatusPill />
            <NotificationsBell />
          </div>
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/product/:id" element={<ProductDetail />} />
        </Routes>
      </main>

      <footer className="app-footer">
        <div className="app-footer-inner">
          <span>INE Software Engineer Assignment — Product Price Tracker</span>
          <span className="muted">Live Anti-Bot Playwright Automation &amp; Price History</span>
        </div>
      </footer>
    </div>
  );
}
