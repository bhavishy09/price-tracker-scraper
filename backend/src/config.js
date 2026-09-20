/**
 * config.js
 * Loads environment variables and exposes them as typed constants.
 * One file = the whole configuration surface, so reviewers can see every
 * knob the app depends on in one place.
 */

require('dotenv').config();

function required(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    // We don't crash at import time — many commands (e.g. `npm run scrape`)
    // don't need DB credentials. Routes that DO need them will throw a
    // clear error if invoked without the env var.
  }
  return v;
}

module.exports = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Supabase — needed for everything except the standalone scraper CLI.
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  // The mock store's base URL. Defaults to the official target.
  ineStoreBaseUrl: required('INE_STORE_BASE_URL', 'https://demo.inelabteamdev.com'),

  // The secret required by POST /api/scrape-trigger. cron-job.org must
  // send this exact value in the X-Cron-Secret header (or ?secret= query).
  cronSecret: required('CRON_SECRET'),

  // Per-product navigation timeout, used by routes that fall back to
  // the catalog endpoint. Generous because the mock store is slow.
  ineFetchTimeoutMs: parseInt(process.env.INE_FETCH_TIMEOUT_MS || '15000', 10),

  // Browser launch mode for the scraper. Defaults to headless=true for
  // unattended runs; set HEADLESS=false in env for the demo recording.
  scraperHeadless: process.env.HEADLESS !== 'false',

  // How many tracked products to scrape in parallel. We keep this small
  // (default 1 = sequential) because each opens a real browser context
  // and the mock store is intentionally flaky under concurrent load.
  // Tunable via env so it can be raised after observing real load.
  scraperConcurrency: parseInt(process.env.SCRAPER_CONCURRENCY || '1', 10),

  // CORS — the React frontend origin. Comma-separated list are allowed.
  // '*' is acceptable for the assignment since there's no auth.
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),

  // Stale-lock safety net. If is_running has been true for more than
  // this many minutes, the next trigger forcibly takes the lock.
  scrapeStaleAfterMinutes: parseInt(process.env.SCRAPE_STALE_AFTER_MINUTES || '15', 10),
};
