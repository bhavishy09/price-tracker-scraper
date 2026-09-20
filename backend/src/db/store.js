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
  notifications: [],
  lock: {
    is_running: false,
    started_at: null,
    stale_after_minutes: config.scrapeStaleAfterMinutes || 15,
  },
  nextProductId: 1,
  nextHistoryId: 1,
  nextLogId: 1,
  nextNotificationId: 1,
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
            scrape_interval_minutes: prod.scrape_interval_minutes || 120,
            next_scrape_due_at: prod.next_scrape_due_at || null,
            is_price_drop: Boolean(prod.latest_is_price_drop),
            is_back_in_stock: Boolean(prod.latest_is_back_in_stock),
            price_change: prod.latest_price_change || 0,
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
    const sortedHistory = memDb.priceHistory
      .filter((h) => String(h.tracked_product_id) === String(prod.id))
      .sort((a, b) => new Date(b.scraped_at) - new Date(a.scraped_at));

    const history = sortedHistory[0];
    const latestDrop = sortedHistory.find((h) => h.is_price_drop);
    const isPriceDrop = Boolean(history?.is_price_drop || (latestDrop && history?.price <= latestDrop.price));
    const priceChange = history?.is_price_drop ? history.price_change : (latestDrop?.price_change || 0);

    const latestStockAlert = sortedHistory.find((h) => h.is_back_in_stock);
    const isBackInStock = Boolean(history?.is_back_in_stock || (latestStockAlert && history?.stock_quantity > 0));

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
      scrape_interval_minutes: prod.scrape_interval_minutes || 120,
      next_scrape_due_at: prod.next_scrape_due_at || null,
      is_price_drop: isPriceDrop,
      is_back_in_stock: isBackInStock,
      price_change: priceChange,
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
  return memDb.products.find((p) => String(p.id) === String(id) || String(p.source_product_id) === String(id)) || null;
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
    scrape_interval_minutes: Number(detail.scrape_interval_minutes || 120),
    next_scrape_due_at: detail.next_scrape_due_at || new Date().toISOString(),
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
 * Update tracked product settings (e.g. scrape_interval_minutes).
 */
async function updateTrackedProduct(id, updates = {}) {
  const allowed = {};
  if (updates.scrape_interval_minutes !== undefined) {
    const mins = Number(updates.scrape_interval_minutes);
    if ([30, 60, 120, 360].includes(mins)) {
      allowed.scrape_interval_minutes = mins;
      allowed.next_scrape_due_at = new Date(Date.now() + mins * 60 * 1000).toISOString();
    }
  }

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('tracked_products')
        .update(allowed)
        .eq('id', id)
        .select()
        .single();
      if (!error && data) return data;
    } catch (err) {
      console.warn('[db] Supabase updateTrackedProduct failed:', err.message);
    }
  }

  const p = memDb.products.find((prod) => String(prod.id) === String(id));
  if (p) {
    Object.assign(p, allowed);
    return p;
  }
  return null;
}

/**
 * Update next_scrape_due_at after an attempt.
 */
async function updateNextScrapeDue(trackedProductId, intervalMinutes = 120) {
  const mins = Number(intervalMinutes) || 120;
  const nextDue = new Date(Date.now() + mins * 60 * 1000).toISOString();

  if (supabase) {
    try {
      await supabase
        .from('tracked_products')
        .update({ next_scrape_due_at: nextDue })
        .eq('id', trackedProductId);
    } catch (err) {}
  }

  const p = memDb.products.find((prod) => String(prod.id) === String(trackedProductId));
  if (p) {
    p.next_scrape_due_at = nextDue;
  }
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
        .select('id, price, stock_quantity, is_price_drop, is_back_in_stock, price_change, scraped_at')
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
 * Insert a successful price history entry and detect alerts (price-drop / back-in-stock).
 */
async function insertPriceHistory(trackedProductId, price, stockQuantity) {
  const numPrice = Number(price);
  const numStock = Number(stockQuantity);

  // Reject invalid / partial prices from being saved
  if (!Number.isFinite(numPrice) || numPrice < 10) {
    console.warn(`[db] Refusing to insert invalid/suspicious price ₹${price} for product ${trackedProductId}`);
    return { ok: false, reason: 'price < 10' };
  }

  // Look up the most recent previous price_history entry to detect price drops & back-in-stock
  let prevRow = null;
  if (supabase) {
    try {
      const { data } = await supabase
        .from('price_history')
        .select('price, stock_quantity')
        .eq('tracked_product_id', trackedProductId)
        .order('scraped_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) prevRow = data;
    } catch (err) {}
  }
  if (!prevRow) {
    const memRows = memDb.priceHistory
      .filter((h) => String(h.tracked_product_id) === String(trackedProductId))
      .sort((a, b) => new Date(b.scraped_at) - new Date(a.scraped_at) || Number(b.id) - Number(a.id));
    if (memRows.length > 0) prevRow = memRows[0];
  }

  const prevPrice = prevRow ? Number(prevRow.price) : null;
  const prevStock = prevRow ? Number(prevRow.stock_quantity) : null;

  let isPriceDrop = false;
  let isPriceIncrease = false;
  let priceChange = 0;
  let isBackInStock = false;

  // Requirement 5: Only trigger on 2nd and later scrapes (when prevPrice exists)
  // Requirement 3: No price change at all generates NO notification
  if (prevPrice !== null && Number.isFinite(prevPrice)) {
    if (numPrice < prevPrice) {
      isPriceDrop = true;
      priceChange = Number((prevPrice - numPrice).toFixed(2));
      const prod = await getTrackedProduct(trackedProductId);
      const prodName = prod ? prod.name : `Product #${trackedProductId}`;
      await createNotification({
        tracked_product_id: trackedProductId,
        type: 'price_drop',
        message: `Price dropped for ${prodName} from ₹${prevPrice} to ₹${numPrice}!`,
        previous_price: prevPrice,
        new_price: numPrice,
      }).catch(() => {});
    } else if (numPrice > prevPrice) {
      isPriceIncrease = true;
      priceChange = Number((numPrice - prevPrice).toFixed(2));
      const prod = await getTrackedProduct(trackedProductId);
      const prodName = prod ? prod.name : `Product #${trackedProductId}`;
      await createNotification({
        tracked_product_id: trackedProductId,
        type: 'price_increase',
        message: `Price increased for ${prodName} from ₹${prevPrice} to ₹${numPrice}!`,
        previous_price: prevPrice,
        new_price: numPrice,
      }).catch(() => {});
    }
  }

  // Requirement 6: Back-in-stock alert coexists cleanly without interference
  if (prevStock !== null && prevStock === 0 && numStock > 0) {
    isBackInStock = true;
    const prod = await getTrackedProduct(trackedProductId);
    const prodName = prod ? prod.name : `Product #${trackedProductId}`;
    await createNotification({
      tracked_product_id: trackedProductId,
      type: 'back_in_stock',
      message: `${prodName} is back in stock with ${numStock} units!`,
      previous_price: prevPrice,
      new_price: numPrice,
    }).catch(() => {});
  }

  const row = {
    tracked_product_id: trackedProductId,
    price: numPrice,
    stock_quantity: numStock,
    is_price_drop: isPriceDrop,
    is_back_in_stock: isBackInStock,
    price_change: priceChange,
  };

  if (supabase) {
    try {
      await supabase.from('price_history').insert(row);
    } catch (err) {
      console.warn('[db] Supabase insertPriceHistory failed:', err.message);
    }
  }

  memDb.priceHistory.push({
    id: String(memDb.nextHistoryId++),
    ...row,
    scraped_at: new Date().toISOString(),
  });

  return {
    ok: true,
    alert: {
      isPriceDrop,
      isPriceIncrease,
      isBackInStock,
      priceChange,
      prevPrice,
      newPrice: numPrice,
      prevStock,
      newStock: numStock,
    },
  };
}

/**
 * Purge invalid or artifact price history entries (e.g. price < 10).
 */
async function purgeInvalidPriceHistory() {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('price_history')
        .delete()
        .lt('price', 10)
        .select();
      if (!error && data?.length) {
        console.log(`[db] Purged ${data.length} invalid price_history rows from Supabase`);
      }
    } catch (err) {
      console.warn('[db] Supabase purge failed:', err.message);
    }
  }

  const beforeCount = memDb.priceHistory.length;
  memDb.priceHistory = memDb.priceHistory.filter((h) => h.price >= 10);
  const purged = beforeCount - memDb.priceHistory.length;
  if (purged > 0) {
    console.log(`[db] Purged ${purged} invalid price_history rows from memory store`);
  }
}

// Automatically purge invalid entries on init
purgeInvalidPriceHistory().catch(() => {});

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

/**
 * Notification management helpers
 */
async function createNotification({ tracked_product_id, type, message, previous_price, new_price }) {
  const item = {
    tracked_product_id: tracked_product_id ? String(tracked_product_id) : null,
    type,
    message,
    previous_price: previous_price != null ? Number(previous_price) : null,
    new_price: new_price != null ? Number(new_price) : null,
    is_dismissed: false,
  };

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .insert(item)
        .select()
        .single();
      if (!error && data) return data;
    } catch (err) {
      console.warn('[db] Supabase createNotification failed:', err.message);
    }
  }

  const newNotif = {
    id: String(memDb.nextNotificationId++),
    ...item,
    created_at: new Date().toISOString(),
  };
  memDb.notifications.unshift(newNotif);
  return newNotif;
}

async function listNotifications(limit = 50) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('is_dismissed', false)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (!error && data) return data;
    } catch (err) {
      console.warn('[db] Supabase listNotifications failed:', err.message);
    }
  }

  return memDb.notifications
    .filter((n) => !n.is_dismissed)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

async function dismissNotification(id) {
  if (supabase) {
    try {
      await supabase
        .from('notifications')
        .update({ is_dismissed: true })
        .eq('id', id);
    } catch (err) {
      console.warn('[db] Supabase dismissNotification failed:', err.message);
    }
  }

  const item = memDb.notifications.find((n) => String(n.id) === String(id));
  if (item) {
    item.is_dismissed = true;
    return true;
  }
  return false;
}

async function dismissAllNotifications() {
  if (supabase) {
    try {
      await supabase
        .from('notifications')
        .update({ is_dismissed: true })
        .eq('is_dismissed', false);
    } catch (err) {
      console.warn('[db] Supabase dismissAllNotifications failed:', err.message);
    }
  }

  memDb.notifications.forEach((n) => {
    n.is_dismissed = true;
  });
  return true;
}

module.exports = {
  listTrackedProducts,
  findTrackedBySourceId,
  getTrackedProduct,
  addTrackedProduct,
  updateTrackedProduct,
  updateNextScrapeDue,
  deleteTrackedProduct,
  getPriceHistory,
  insertPriceHistory,
  getScrapeLogs,
  insertScrapeLog,
  getLockStatus,
  tryAcquireLock,
  releaseLock,
  purgeInvalidPriceHistory,
  createNotification,
  listNotifications,
  dismissNotification,
  dismissAllNotifications,
};
