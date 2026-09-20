/**
 * store.js
 * --------------------------------------------------------------------------
 * Database abstraction layer for the INE Product Price Tracker.
 * Supports Supabase (Postgres) and an In-Memory fallback for local dev.
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const isRealSupabase = Boolean(
  config.supabaseUrl &&
  config.supabaseServiceKey &&
  !config.supabaseUrl.includes('dummy') &&
  !config.supabaseServiceKey.includes('dummy')
);

let supabase = null;
if (isRealSupabase) {
  try {
    supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log('[db] Connected to Supabase client');
  } catch (err) {
    console.warn('[db] Supabase init failed, using local store:', err.message);
  }
} else {
  console.log('[db] Running with local in-memory store (Supabase unconfigured)');
}

// Memory fallback store
const memDb = {
  products: [],
  priceHistory: [],
  scrapeLogs: [],
  lock: {
    is_running: false,
    started_at: null,
    stale_after_minutes: config.scrapeStaleAfterMinutes || 15,
  },
  nextProductId: 1,
  nextHistoryId: 1,
  nextLogId: 1,
};

/**
 * List all tracked products merged with latest price, stock, and scrape status.
 */
async function listTrackedProducts() {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('latest_price_per_product')
        .select('*');

      if (!error && data) {
        const { data: logs } = await supabase
          .from('scrape_logs')
          .select('tracked_product_id, outcome, failure_reason, attempted_at')
          .order('attempted_at', { ascending: false });

        return data.map((prod) => {
          const log = (logs || []).find(
            (l) => String(l.tracked_product_id) === String(prod.tracked_product_id || prod.id)
          );
          const price = prod.latest_price ?? null;
          const stock = prod.latest_stock ?? null;
          const at = prod.latest_scraped_at ?? null;

          return {
            ...prod,
            id: String(prod.tracked_product_id || prod.id),
            tracked_product_id: String(prod.tracked_product_id || prod.id),
            latest_price: price,
            latest_stock: stock,
            latest_scraped_at: at,
            price,
            stock_quantity: stock,
            scraped_at: at,
            latest_outcome: log ? log.outcome : null,
            last_attempt_at: log ? log.attempted_at : null,
            failure_reason: log ? log.failure_reason : null,
          };
        });
      }
    } catch (err) {
      console.warn('[db] Supabase list failed, using local store:', err.message);
    }
  }

  // Memory fallback
  return memDb.products.map((prod) => {
    const history = memDb.priceHistory
      .filter((h) => String(h.tracked_product_id) === String(prod.id))
      .sort((a, b) => new Date(b.scraped_at) - new Date(a.scraped_at))[0];

    const latestLog = memDb.scrapeLogs
      .filter((l) => String(l.tracked_product_id) === String(prod.id))
      .sort((a, b) => new Date(b.attempted_at) - new Date(a.attempted_at))[0];

    const price = history ? history.price : null;
    const stock = history ? history.stock_quantity : null;
    const at = history ? history.scraped_at : null;

    return {
      ...prod,
      id: String(prod.id),
      tracked_product_id: String(prod.id),
      latest_price: price,
      latest_stock: stock,
      latest_scraped_at: at,
      price,
      stock_quantity: stock,
      scraped_at: at,
      latest_outcome: latestLog ? latestLog.outcome : null,
      last_attempt_at: latestLog ? latestLog.attempted_at : null,
      failure_reason: latestLog ? latestLog.failure_reason : null,
      attempts_made: latestLog ? latestLog.attempts_made : null,
    };
  });
}

/**
 * Find tracked product by source_product_id.
 */
async function findTrackedBySourceId(sourceProductId) {
  const sourceIdNum = Number(sourceProductId);
  if (supabase) {
    try {
      const { data } = await supabase
        .from('tracked_products')
        .select('*')
        .eq('source_product_id', sourceIdNum)
        .maybeSingle();
      if (data) return data;
    } catch (err) {}
  }
  return memDb.products.find((p) => Number(p.source_product_id) === sourceIdNum) || null;
}

/**
 * Get a single tracked product by ID with latest price and logs.
 */
async function getTrackedProduct(id) {
  if (supabase) {
    try {
      const { data } = await supabase
        .from('tracked_products')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (data) return data;
    } catch (err) {}
  }
  return memDb.products.find((p) => String(p.id) === String(id)) || null;
}

/**
 * Add a new product to tracked_products.
 */
async function addTrackedProduct(detail) {
  const insertObj = {
    source_product_id: Number(detail.id),
    slug: detail.slug || null,
    name: detail.name || `Product ${detail.id}`,
    brand: detail.brand || null,
    category: detail.category || null,
    sku: detail.sku || null,
  };

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('tracked_products')
        .insert(insertObj)
        .select()
        .single();
      if (!error && data) return data;
    } catch (err) {
      console.warn('[db] Supabase insert failed, using local store:', err.message);
    }
  }

  // Memory fallback
  const newProduct = {
    id: String(memDb.nextProductId++),
    ...insertObj,
    added_at: new Date().toISOString(),
  };
  memDb.products.unshift(newProduct);
  return newProduct;
}

/**
 * Delete product from tracked_products.
 */
async function deleteTrackedProduct(id) {
  if (supabase) {
    try {
      await supabase.from('tracked_products').delete().eq('id', id);
    } catch (err) {}
  }
  memDb.products = memDb.products.filter((p) => String(p.id) !== String(id));
  memDb.priceHistory = memDb.priceHistory.filter((h) => String(h.tracked_product_id) !== String(id));
  memDb.scrapeLogs = memDb.scrapeLogs.filter((l) => String(l.tracked_product_id) !== String(id));
  return true;
}

/**
 * Fetch price history rows for a product.
 */
async function getPriceHistory(trackedProductId, limit = 200) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('price_history')
        .select('id, price, stock_quantity, scraped_at')
        .eq('tracked_product_id', trackedProductId)
        .order('scraped_at', { ascending: true })
        .limit(limit);
      if (!error && data) return data;
    } catch (err) {}
  }

  return memDb.priceHistory
    .filter((h) => String(h.tracked_product_id) === String(trackedProductId))
    .sort((a, b) => new Date(a.scraped_at) - new Date(b.scraped_at))
    .slice(0, limit);
}

/**
 * Insert a successful price history entry.
 */
async function insertPriceHistory(trackedProductId, price, stockQuantity) {
  const row = {
    tracked_product_id: trackedProductId,
    price: Number(price),
    stock_quantity: Number(stockQuantity),
  };

  if (supabase) {
    try {
      await supabase.from('price_history').insert(row);
    } catch (err) {}
  }

  memDb.priceHistory.push({
    id: String(memDb.nextHistoryId++),
    ...row,
    scraped_at: new Date().toISOString(),
  });
  return true;
}

/**
 * Fetch scrape logs for a product.
 */
async function getScrapeLogs(trackedProductId, limit = 200) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('scrape_logs')
        .select('id, attempted_at, outcome, attempts_made, failure_reason, price_seen, stock_seen')
        .eq('tracked_product_id', trackedProductId)
        .order('attempted_at', { ascending: false })
        .limit(limit);
      if (!error && data) return data;
    } catch (err) {}
  }

  return memDb.scrapeLogs
    .filter((l) => String(l.tracked_product_id) === String(trackedProductId))
    .sort((a, b) => new Date(b.attempted_at) - new Date(a.attempted_at))
    .slice(0, limit);
}

/**
 * Insert a scrape log row.
 */
async function insertScrapeLog(trackedProductId, logData) {
  const row = {
    tracked_product_id: trackedProductId,
    outcome: logData.outcome,
    attempts_made: logData.attempts || 1,
    failure_reason: logData.failureReason || null,
    price_seen: logData.price ?? null,
    stock_seen: logData.stock ?? null,
  };

  if (supabase) {
    try {
      await supabase.from('scrape_logs').insert(row);
    } catch (err) {}
  }

  memDb.scrapeLogs.push({
    id: String(memDb.nextLogId++),
    ...row,
    attempted_at: new Date().toISOString(),
  });
  return true;
}

/**
 * Scrape lock management.
 */
async function getLockStatus() {
  if (supabase) {
    try {
      const { data } = await supabase
        .from('scrape_lock')
        .select('is_running, started_at, stale_after_minutes')
        .eq('id', 1)
        .maybeSingle();
      if (data) return data;
    } catch (err) {}
  }

  return {
    is_running: memDb.lock.is_running,
    started_at: memDb.lock.started_at,
    stale_after_minutes: memDb.lock.stale_after_minutes,
  };
}

async function tryAcquireLock() {
  const status = await getLockStatus();
  const now = new Date();

  if (!status.is_running) {
    if (supabase) {
      try {
        await supabase
          .from('scrape_lock')
          .update({ is_running: true, started_at: now.toISOString() })
          .eq('id', 1);
      } catch (err) {}
    }
    memDb.lock.is_running = true;
    memDb.lock.started_at = now.toISOString();
    return { acquired: true, reason: 'lock was free' };
  }

  const startedAt = status.started_at ? new Date(status.started_at).getTime() : 0;
  const ageMin = (Date.now() - startedAt) / 60000;
  const staleLimit = status.stale_after_minutes || 15;

  if (ageMin >= staleLimit) {
    if (supabase) {
      try {
        await supabase
          .from('scrape_lock')
          .update({ is_running: true, started_at: now.toISOString() })
          .eq('id', 1);
      } catch (err) {}
    }
    memDb.lock.is_running = true;
    memDb.lock.started_at = now.toISOString();
    return {
      acquired: true,
      reason: `stale lock taken (previous run was ${ageMin.toFixed(1)}min old)`,
    };
  }

  return {
    acquired: false,
    reason: `another scrape is already running (started ${ageMin.toFixed(1)}min ago)`,
  };
}

async function releaseLock() {
  if (supabase) {
    try {
      await supabase
        .from('scrape_lock')
        .update({ is_running: false, started_at: null })
        .eq('id', 1);
    } catch (err) {}
  }
  memDb.lock.is_running = false;
  memDb.lock.started_at = null;
}

module.exports = {
  listTrackedProducts,
  findTrackedBySourceId,
  getTrackedProduct,
  addTrackedProduct,
  deleteTrackedProduct,
  getPriceHistory,
  insertPriceHistory,
  getScrapeLogs,
  insertScrapeLog,
  getLockStatus,
  tryAcquireLock,
  releaseLock,
};
