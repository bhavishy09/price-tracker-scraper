/**
 * lock.js
 * --------------------------------------------------------------------------
 * Overlap protection for the scrape-trigger endpoint.
 *
 * Why: the mock store is slow. A scrape across N products can easily
 * take longer than 2 hours in pathological cases. If cron-job.org fires
 * the next trigger while the previous run is still going, we'd end up
 * with two browsers hammering the same site and potentially writing
 * duplicate price_history rows. A simple DB-backed lock prevents this.
 *
 * Lock semantics:
 *   - Single row in `scrape_lock` (id=1, seeded by schema.sql).
 *   - tryAcquire(): flip is_running false→true, set started_at=now().
 *     If already true AND not stale → return false (skip this trigger).
 *     If already true AND stale (> stale_after_minutes) → forcibly take.
 *   - release(): flip is_running true→false, started_at=null.
 *
 * We never DELETE the row — only UPDATE it. That way there is always
 * exactly one row to inspect, no race to seed it.
 *
 * The lock is released in a `finally` block in the trigger route, so a
 * crash mid-run still leaves the lock stale-but-takeable on the next run.
 */

const { getSupabase } = require('../db/supabase');
const config = require('../config');

const TABLE = 'scrape_lock';
const PK = 1;

/**
 * Try to acquire the scrape lock.
 * @returns {Promise<{acquired: boolean, reason: string}>}
 */
async function tryAcquire() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(TABLE)
    .select('is_running, started_at, stale_after_minutes')
    .eq('id', PK)
    .maybeSingle();

  if (error) throw new Error(`lock read failed: ${error.message}`);
  if (!data) throw new Error('scrape_lock row missing — did you run db/schema.sql?');

  if (!data.is_running) {
    // Free — take it.
    const { error: upErr } = await sb
      .from(TABLE)
      .update({ is_running: true, started_at: new Date().toISOString() })
      .eq('id', PK);
    if (upErr) throw new Error(`lock acquire failed: ${upErr.message}`);
    return { acquired: true, reason: 'lock was free' };
  }

  // Already running — is it stale?
  const staleAfterMin = data.stale_after_minutes ?? config.scrapeStaleAfterMinutes;
  const startedAt = data.started_at ? new Date(data.started_at).getTime() : 0;
  const ageMin = (Date.now() - startedAt) / 60_000;

  if (ageMin >= staleAfterMin) {
    // Stale — previous run crashed without releasing. Forcibly take.
    const { error: upErr } = await sb
      .from(TABLE)
      .update({ is_running: true, started_at: new Date().toISOString() })
      .eq('id', PK);
    if (upErr) throw new Error(`stale-lock takeover failed: ${upErr.message}`);
    return {
      acquired: true,
      reason: `stale lock taken (previous run was ${ageMin.toFixed(1)}min old, threshold ${staleAfterMin}min)`,
    };
  }

  // Genuinely still running — skip cleanly.
  return {
    acquired: false,
    reason: `another scrape is already running (started ${ageMin.toFixed(1)}min ago)`,
  };
}

/**
 * Release the scrape lock. Always called in a `finally` block.
 */
async function release() {
  const sb = getSupabase();
  const { error } = await sb
    .from(TABLE)
    .update({ is_running: false, started_at: null })
    .eq('id', PK);
  if (error) {
    // Don't throw on release — we don't want to mask the real error
    // that may have caused the run to fail. Just log it.
    console.error('[lock] release failed:', error.message);
  }
}

/**
 * Read-only inspection — used by the GET /api/scrape-trigger/status
 * debug endpoint so we can see whether a run is in progress.
 */
async function getStatus() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(TABLE)
    .select('is_running, started_at, stale_after_minutes')
    .eq('id', PK)
    .maybeSingle();
  if (error) throw new Error(`lock status read failed: ${error.message}`);
  return data;
}

module.exports = { tryAcquire, release, getStatus };
