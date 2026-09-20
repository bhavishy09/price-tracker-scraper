-- =========================================================================
-- INE Product Price Tracker — Supabase / Postgres schema
-- Run this in the Supabase SQL editor (or psql) once.
-- All names are snake_case plain English so the scraper code is easy to read.
-- =========================================================================

-- -------------------------------------------------------------------------
-- tracked_products
--   One row per product the user wants to track.
--   source_product_id is the id used by INE's mock store (their catalog id).
-- -------------------------------------------------------------------------
create table if not exists tracked_products (
    id                uuid primary key default gen_random_uuid(),
    source_product_id integer not null unique,   -- INE catalog id, e.g. 921
    slug              text,
    name              text not null,
    brand             text,
    category          text,
    sku               text,
    image_url         text,
    added_at          timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- price_history
--   One row per SUCCESSFUL scrape (success or retried outcome).
--   NEVER written on a failed scrape — the last known good price simply
--   remains the most recent row. This guarantees no null/zero/fake data.
-- -------------------------------------------------------------------------
create table if not exists price_history (
    id               bigserial primary key,
    tracked_product_id uuid not null references tracked_products(id) on delete cascade,
    price            numeric(12,2) not null check (price > 0),  -- never 0/null/blank
    stock_quantity   integer not null check (stock_quantity >= 0),
    scraped_at       timestamptz not null default now()
);
create index if not exists idx_price_history_product_time
    on price_history (tracked_product_id, scraped_at desc);

-- -------------------------------------------------------------------------
-- scrape_logs
--   One row per ATTEMPT — success / retried / failed.
--   Every scrape run produces exactly one row here, including failures,
--   so nothing is ever silently hidden.
-- -------------------------------------------------------------------------
do $$ begin
    create type scrape_outcome as enum ('success', 'retried', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists scrape_logs (
    id                bigserial primary key,
    tracked_product_id uuid not null references tracked_products(id) on delete cascade,
    attempted_at      timestamptz not null default now(),
    outcome           scrape_outcome not null,
    attempts_made     integer not null check (attempts_made >= 1),
    failure_reason   text,                       -- nullable; populated only on 'failed'
    price_seen       numeric(12,2),               -- nullable; only on success/retried
    stock_seen       integer                       -- nullable; only on success/retried
);
create index if not exists idx_scrape_logs_product_time
    on scrape_logs (tracked_product_id, attempted_at desc);

-- -------------------------------------------------------------------------
-- scrape_lock
--   Single-row table that prevents two scrape runs from overlapping.
--   We never DELETE the row — we just flip is_running and refresh started_at.
-- -------------------------------------------------------------------------
create table if not exists scrape_lock (
    id           integer primary key default 1 check (id = 1),  -- always row id=1
    is_running   boolean not null default false,
    started_at   timestamptz,
    -- A safety net: if is_running has been true for more than this many
    -- minutes, the next run is allowed to forcibly take the lock.
    -- Tunable via env on the backend; default 15 min covers any sane run.
    stale_after_minutes integer not null default 15
);

-- Seed the single lock row if it doesn't exist yet.
insert into scrape_lock (id, is_running, started_at)
values (1, false, null)
on conflict (id) do nothing;

-- -------------------------------------------------------------------------
-- Helpful view: latest price + latest outcome per tracked product.
-- Used by the frontend dashboard to avoid N+1 queries.
-- -------------------------------------------------------------------------
create or replace view latest_price_per_product as
select distinct on (tp.id)
       tp.id as tracked_product_id,
       tp.source_product_id,
       tp.name,
       tp.brand,
       tp.category,
       tp.sku,
       ph.price as latest_price,
       ph.stock_quantity as latest_stock,
       ph.scraped_at as latest_scraped_at
from tracked_products tp
left join price_history ph on ph.tracked_product_id = tp.id
order by tp.id, ph.scraped_at desc nulls last;
