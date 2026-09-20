/**
 * server.js
 * --------------------------------------------------------------------------
 * Express entry point. Wires up CORS, JSON body parsing, request logging,
 * and the four route groups:
 *   /api/search
 *   /api/tracked-products
 *   /api/scrape-trigger
 *   /api/health  (lightweight liveness check)
 *
 * Run locally:
 *   node src/server.js          (uses .env)
 *   PORT=4000 node src/server.js
 *
 * On Render: `npm start` runs this file. Render handles the port via
 * the PORT env var it injects.
 */

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const config = require('./config');

const searchRouter = require('./routes/search');
const trackedProductsRouter = require('./routes/trackedProducts');
const scrapeTriggerRouter = require('./routes/scrapeTrigger');
const notificationsRouter = require('./routes/notifications');

const app = express();

// Pretty-print JSON in dev so it's easier to eyeball in the browser.
if (config.nodeEnv !== 'production') {
  app.set('json spaces', 2);
}

// CORS — origins come from config (default '*'). For the assignment the
// frontend has no auth so '*' is acceptable; in production with auth we
// would lock this down to the exact Vercel origin.
app.use(cors({ origin: config.corsOrigins }));

// Body parser for POST /api/tracked-products JSON bodies.
app.use(express.json({ limit: '256kb' }));

// Request logging — concise Apache-style, includes status + latency.
app.use(morgan(config.nodeEnv === 'production' ? 'tiny' : 'dev'));

// -------------------------------------------------------------------------
// Routes
// -------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    env: config.nodeEnv,
    // Expose whether the scraper will run headed or headless on this host.
    scraperHeadless: config.scraperHeadless,
  });
});

app.use('/api/search', searchRouter);
app.use('/api/tracked-products', trackedProductsRouter);
app.use('/api/scrape-trigger', scrapeTriggerRouter);
app.use('/api/notifications', notificationsRouter);

// 404 for unknown /api/* routes.
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'not found', path: req.originalUrl });
});

// Root — a tiny human-readable landing so a bare curl of the backend works.
app.get('/', (_req, res) => {
  res.type('text/plain').send(
    'INE Product Price Tracker — backend is up.\n' +
    'See /api/health for status, /api/search?q=... to search the mock store.\n'
  );
});

// -------------------------------------------------------------------------
// Global error handler — anything thrown by a route lands here.
// Keeps the response shape consistent so the frontend can rely on it.
// -------------------------------------------------------------------------
app.use((err, req, res, _next) => {
  console.error('[unhandled]', err.stack || err.message || err);
  res.status(500).json({
    error: 'internal server error',
    detail: err.message || String(err),
  });
});

// -------------------------------------------------------------------------
// Start.
// -------------------------------------------------------------------------
const server = app.listen(config.port, () => {
  console.log(`[server] INE Price Tracker backend listening on :${config.port} (env=${config.nodeEnv})`);
  console.log(`[server] scraper headless=${config.scraperHeadless}, concurrency=${config.scraperConcurrency}`);
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    console.warn('[server] WARNING: Supabase env vars not set — DB routes will fail until configured.');
  }
  if (!config.cronSecret) {
    console.warn('[server] WARNING: CRON_SECRET not set — /api/scrape-trigger will reject all calls.');
  }
});

// Graceful shutdown so Render's redeploy cycle doesn't truncate in-flight requests.
function shutdown(signal) {
  console.log(`[server] ${signal} received, closing HTTP server...`);
  server.close(() => {
    console.log('[server] HTTP server closed. Bye.');
    process.exit(0);
  });
  // Hard stop after 10s if something hangs.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server };
