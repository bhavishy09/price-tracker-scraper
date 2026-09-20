/**
 * supabase.js
 * Thin singleton wrapper around the Supabase client. Using the
 * SERVICE ROLE key (not the anon key) because the backend is a trusted
 * server — there are no per-user accounts to enforce RLS on.
 *
 * All DB access in this project goes through this client so we have one
 * place to add logging / retries / metrics later if needed.
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

let client = null;

function getSupabase() {
  if (client) return client;
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error(
      'Supabase env vars missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
      'in your .env file (see .env.example).'
    );
  }
  client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

module.exports = { getSupabase };
