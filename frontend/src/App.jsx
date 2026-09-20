/**
 * App.jsx
 * --------------------------------------------------------------------------
 * Top-level layout. Renders a small header and routes to:
 *   /                  — search + tracked products list (the dashboard)
 *   /product/:id       — per-product detail (price chart + scrape logs)
 *
 * Components are intentionally small and single-purpose so a human can
 * read and safely edit them under interview time pressure.
 */

import React from 'react';
import { Routes, Route, NavLink, Link } from 'react-router-dom';
import Dashboard from './components/Dashboard.jsx';
import ProductDetail from './components/ProductDetail.jsx';
import ScrapeStatusPill from './components/ScrapeStatusPill.jsx';

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
            <a href="https://demo.inelabteamdev.com/" target="_blank" rel="noreferrer">
              Mock store ↗
            </a>
          </nav>
          <ScrapeStatusPill />
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/product/:id" element={<ProductDetail />} />
        </Routes>
      </main>

      <footer className="app-footer">
        <span>INE Software Engineer Intern Assignment — Product Price Tracker</span>
      </footer>
    </div>
  );
}
