-- ============================================================================
-- LUXEDGE V2 — 0004: LIVE DATABASE RECONCILE PACKAGE (Dashboard SQL Editor)
--
-- SINGLE ordered script that brings the LIVE project
-- (eidujmfbcfrjjleitaqp — partial/older 13-table schema) in line with the
-- V2 migrations (0001 + 0002 + 0003) WITHOUT destroying anything.
--
-- WHY THIS FILE EXISTS
--   The postgres connection string for this project rejects its password, so
--   `supabase db push` / psql are not available. Paste this ENTIRE file into
--   Supabase → Dashboard → SQL Editor and run it. It is fully idempotent:
--   running it twice is harmless.
--
-- SAFETY RULES HONORED
--   * Additive only: existing tables/columns/data are preserved.
--   * No DROP TABLE / TRUNCATE anywhere.
--   * Existing columns keep their names; V2 columns are ADDED alongside.
--   * Policy/trigger/index creation is guarded (drop-if-exists + create) so
--     re-runs and name collisions with the old schema are safe.
--   * Status columns are widened from legacy enums to text with the V2 check
--     constraints (all live tables are EMPTY, so no data conversion risk).
--   * Legacy-only tables (profiles, admin_email_allowlist, supplier_mappings,
--     price_history, processed_webhook_events) are left untouched.
--
-- After running: 30 V2 tables + 5 legacy tables exist, grants restored, RLS
-- enforced. Then populate the catalog via the admin UI or SQL INSERTs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extensions & helpers
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. RECONCILE EXISTING TABLES (add V2 columns; widen status enums to text)
-- ---------------------------------------------------------------------------

-- categories ── add V2 parent_id
alter table public.categories add column if not exists parent_id uuid references public.categories(id) on delete set null;

-- products ── add all V2 columns alongside the legacy ones
alter table public.products add column if not exists name text;
alter table public.products add column if not exists premium_title text;
alter table public.products add column if not exists long_description text;
alter table public.products add column if not exists features jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists benefits jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists specifications jsonb not null default '{}'::jsonb;
alter table public.products add column if not exists brand text;
alter table public.products add column if not exists agent_score numeric(5,2);
alter table public.products add column if not exists score_explanation text;
alter table public.products add column if not exists price numeric(10,2);
alter table public.products add column if not exists compare_at_price numeric(10,2);
alter table public.products add column if not exists cost_price numeric(10,2);
alter table public.products add column if not exists landed_cost numeric(10,2);
alter table public.products add column if not exists gross_margin numeric(10,2);
alter table public.products add column if not exists sku text;
alter table public.products add column if not exists inventory_qty integer not null default 0;
alter table public.products add column if not exists shipping_cost numeric(10,2);
alter table public.products add column if not exists est_us_delivery_days integer;
alter table public.products add column if not exists seo_keywords jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists structured_data jsonb;
alter table public.products add column if not exists product_source_evidence jsonb;
alter table public.products add column if not exists published_at timestamptz;

-- products.status: catalog_status enum → text with V2 check
alter table public.products alter column status drop default;
alter table public.products alter column status type text using status::text;
alter table public.products alter column status set default 'draft';
alter table public.products drop constraint if exists products_status_check;
alter table public.products add constraint products_status_check check (
  status in ('candidate','researching','qualified','creative_generation','listing_draft','qa','approved','published','rejected','failed','paused','archived')
);

-- product_variants ── add V2 columns
alter table public.product_variants add column if not exists attributes jsonb not null default '{}'::jsonb;
alter table public.product_variants add column if not exists price numeric(10,2);
alter table public.product_variants add column if not exists compare_at_price numeric(10,2);
alter table public.product_variants add column if not exists cost_price numeric(10,2);
alter table public.product_variants add column if not exists inventory_qty integer not null default 0;
alter table public.product_variants add column if not exists low_stock_threshold integer not null default 0;

-- product_variants.status: catalog_status enum → text (V2 default 'active')
alter table public.product_variants alter column status drop default;
alter table public.product_variants alter column status type text using status::text;
alter table public.product_variants alter column status set default 'active';

-- product_images ── add V2 columns
alter table public.product_images add column if not exists url text;
alter table public.product_images add column if not exists kind text not null default 'product';
alter table public.product_images add column if not exists is_primary boolean not null default false;

-- orders ── add V2 columns (legacy Stripe/Shippo columns preserved)
alter table public.orders add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.orders add column if not exists subtotal numeric(10,2) not null default 0;
alter table public.orders add column if not exists shipping numeric(10,2) not null default 0;
alter table public.orders add column if not exists tax numeric(10,2) not null default 0;
alter table public.orders add column if not exists total numeric(10,2) not null default 0;
alter table public.orders add column if not exists payment_method text;

-- orders.status: order_status enum → text with V2 check
alter table public.orders alter column status drop default;
alter table public.orders alter column status type text using status::text;
alter table public.orders alter column status set default 'pending';
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (
  status in ('pending','processing','shipped','delivered','cancelled','refunded','failed')
);

-- orders.payment_status: payment_status enum → text (V2 default 'unpaid')
alter table public.orders alter column payment_status drop default;
alter table public.orders alter column payment_status type text using payment_status::text;
alter table public.orders alter column payment_status set default 'unpaid';

-- order_items ── add V2 columns
alter table public.order_items add column if not exists product_name text;
alter table public.order_items add column if not exists unit_price numeric(10,2);
alter table public.order_items add column if not exists total numeric(10,2);

-- addresses ── add V2 columns (legacy user_id columns preserved)
alter table public.addresses add column if not exists customer_id uuid references public.customers(id) on delete cascade;
alter table public.addresses add column if not exists address_line1 text;
alter table public.addresses add column if not exists address_line2 text;
alter table public.addresses add column if not exists is_default boolean not null default false;

-- inventory ── add V2 columns (legacy available/reserved preserved)
alter table public.inventory add column if not exists id uuid;
alter table public.inventory add column if not exists product_id uuid references public.products(id) on delete cascade;
alter table public.inventory add column if not exists quantity integer not null default 0;
alter table public.inventory add column if not exists warehouse text;

-- ---------------------------------------------------------------------------
-- 3. CREATE MISSING V2 TABLES (all `create table if not exists`)
-- ---------------------------------------------------------------------------
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_products (
  collection_id uuid not null references public.collections(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (collection_id, product_id)
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  base_url text,
  api_configured boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  supplier_sku text,
  title text not null,
  url text,
  images jsonb not null default '[]'::jsonb,
  raw_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, supplier_sku)
);

create table if not exists public.supplier_variants (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references public.supplier_products(id) on delete cascade,
  attributes jsonb not null default '{}'::jsonb,
  supplier_price numeric(10,2),
  currency text not null default 'USD',
  available_qty integer,
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_shipping (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  destination_country text not null default 'US',
  method text not null,
  cost numeric(10,2),
  estimated_days_min integer,
  estimated_days_max integer,
  us_warehouse boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.pricing_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  price numeric(10,2) not null,
  compare_at_price numeric(10,2),
  source text,
  changed_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  phone text,
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_customers_auth_user on public.customers(auth_user_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null,
  provider_ref text,
  amount numeric(10,2) not null,
  currency text not null default 'USD',
  status text not null default 'pending',
  raw jsonb, -- provider response metadata only: never store card numbers/CVC (PCI)
  created_at timestamptz not null default now()
);

create table if not exists public.fulfillment (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  carrier text,
  tracking_number text,
  status text not null default 'unfulfilled',
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  title text,
  comment text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  verified_purchase boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  provider text unique not null,
  is_enabled boolean not null default true,
  is_default boolean not null default false,
  default_model text,
  config jsonb, -- metadata ONLY: never store API keys here
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null
    check (type in ('PRODUCT_RESEARCH','PRODUCT_SCORE','LISTING_GENERATE','CREATIVE_GENERATE','PRODUCT_QA','PRODUCT_PUBLISH','INVENTORY_CHECK','PRICE_CHECK','SHIPPING_CHECK','AD_PERFORMANCE_CHECK')),
  status text not null default 'queued'
    check (status in ('queued','running','completed','failed','cancelled')),
  input jsonb,
  output jsonb,
  error text,
  provider text,
  model text,
  token_cost jsonb,
  retries integer not null default 0,
  max_retries integer not null default 3,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.agent_jobs(id) on delete set null,
  agent text not null,
  status text not null default 'running',
  summary text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.agent_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.agent_jobs(id) on delete cascade,
  level text not null default 'info',
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.product_candidates (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid references public.supplier_products(id) on delete set null,
  title text not null,
  source text not null,
  source_url text,
  images jsonb not null default '[]'::jsonb,
  evidence jsonb,
  status text not null default 'researching'
    check (status in ('researching','qualified','rejected','approved','failed')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_scores (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.product_candidates(id) on delete cascade,
  overall numeric(5,2) not null,
  explanation text,
  weights jsonb not null default '{}'::jsonb,
  breakdown jsonb not null default '{}'::jsonb,
  scored_at timestamptz not null default now()
);

create table if not exists public.creative_assets (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  kind text not null
    check (kind in ('studio','lifestyle','benefit_ad','social','video_vertical','ugc')),
  provider text,
  status text not null default 'queued'
    check (status in ('queued','running','completed','failed','paused')),
  asset_url text,
  prompt text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creative_jobs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  kind text not null,
  status text not null default 'queued',
  input jsonb,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform text not null check (platform in ('meta','instagram','tiktok','google')),
  status text not null default 'draft'
    check (status in ('draft','active','paused','archived','error')),
  max_daily_account_spend numeric(10,2),
  max_daily_campaign_spend numeric(10,2),
  max_product_test_budget numeric(10,2),
  max_single_action_budget numeric(10,2),
  emergency_pause boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ad_creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  hook text,
  primary_text text,
  media_url text,
  platform text,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists public.ad_performance (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete cascade,
  ad_creative_id uuid references public.ad_creatives(id) on delete cascade,
  date date not null,
  impressions integer not null default 0,
  clicks integer not null default 0,
  spend numeric(10,2) not null default 0,
  conversions integer not null default 0,
  revenue numeric(10,2) not null default 0,
  ctr numeric(10,4),
  cpc numeric(10,2),
  cpa numeric(10,2),
  roas numeric(10,2),
  created_at timestamptz not null default now(),
  unique (ad_creative_id, date)
);

-- ---------------------------------------------------------------------------
-- 4. 0002: customer identity + customer-scoped RLS (idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.customers where auth_user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 5. Row Level Security — enable on every table (idempotent)
-- ---------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.collections enable row level security;
alter table public.collection_products enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_products enable row level security;
alter table public.supplier_variants enable row level security;
alter table public.supplier_shipping enable row level security;
alter table public.inventory enable row level security;
alter table public.pricing_history enable row level security;
alter table public.customers enable row level security;
alter table public.addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.fulfillment enable row level security;
alter table public.reviews enable row level security;
alter table public.ai_providers enable row level security;
alter table public.agent_jobs enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_logs enable row level security;
alter table public.product_candidates enable row level security;
alter table public.product_scores enable row level security;
alter table public.creative_assets enable row level security;
alter table public.creative_jobs enable row level security;
alter table public.campaigns enable row level security;
alter table public.ad_creatives enable row level security;
alter table public.ad_performance enable row level security;

-- ---------------------------------------------------------------------------
-- 6. Policies — drop-if-exists then create (safe on re-run / old collisions)
-- ---------------------------------------------------------------------------
-- Public read for the storefront (published products only)
drop policy if exists "public read categories" on public.categories;
create policy "public read categories" on public.categories for select using (is_active = true);
drop policy if exists "public read collections" on public.collections;
create policy "public read collections" on public.collections for select using (is_active = true);
drop policy if exists "public read published products" on public.products;
create policy "public read published products" on public.products for select using (status = 'published');
drop policy if exists "public read product variants" on public.product_variants;
create policy "public read product variants" on public.product_variants for select using (
  exists (select 1 from public.products p where p.id = product_variants.product_id and p.status = 'published')
);
drop policy if exists "public read product images" on public.product_images;
create policy "public read product images" on public.product_images for select using (
  exists (select 1 from public.products p where p.id = product_images.product_id and p.status = 'published')
);
drop policy if exists "public read collection_products" on public.collection_products;
create policy "public read collection_products" on public.collection_products for select using (
  exists (select 1 from public.products p where p.id = collection_products.product_id and p.status = 'published')
  and exists (select 1 from public.collections c where c.id = collection_products.collection_id and c.is_active = true)
);
drop policy if exists "public read approved reviews" on public.reviews;
create policy "public read approved reviews" on public.reviews for select using (status = 'approved');

-- Authenticated (owner) full access — admin writes flow through service role
drop policy if exists "owner all categories" on public.categories;
create policy "owner all categories" on public.categories for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all collections" on public.collections;
create policy "owner all collections" on public.collections for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all collection_products" on public.collection_products;
create policy "owner all collection_products" on public.collection_products for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all products" on public.products;
create policy "owner all products" on public.products for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all product_variants" on public.product_variants;
create policy "owner all product_variants" on public.product_variants for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all product_images" on public.product_images;
create policy "owner all product_images" on public.product_images for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all suppliers" on public.suppliers;
create policy "owner all suppliers" on public.suppliers for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all supplier_products" on public.supplier_products;
create policy "owner all supplier_products" on public.supplier_products for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all supplier_variants" on public.supplier_variants;
create policy "owner all supplier_variants" on public.supplier_variants for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all supplier_shipping" on public.supplier_shipping;
create policy "owner all supplier_shipping" on public.supplier_shipping for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all inventory" on public.inventory;
create policy "owner all inventory" on public.inventory for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all pricing_history" on public.pricing_history;
create policy "owner all pricing_history" on public.pricing_history for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all customers" on public.customers;
create policy "owner all customers" on public.customers for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all addresses" on public.addresses;
create policy "owner all addresses" on public.addresses for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all orders" on public.orders;
create policy "owner all orders" on public.orders for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all order_items" on public.order_items;
create policy "owner all order_items" on public.order_items for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all payments" on public.payments;
create policy "owner all payments" on public.payments for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all fulfillment" on public.fulfillment;
create policy "owner all fulfillment" on public.fulfillment for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all reviews" on public.reviews;
create policy "owner all reviews" on public.reviews for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all ai_providers" on public.ai_providers;
create policy "owner all ai_providers" on public.ai_providers for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all agent_jobs" on public.agent_jobs;
create policy "owner all agent_jobs" on public.agent_jobs for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all agent_runs" on public.agent_runs;
create policy "owner all agent_runs" on public.agent_runs for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all agent_logs" on public.agent_logs;
create policy "owner all agent_logs" on public.agent_logs for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all product_candidates" on public.product_candidates;
create policy "owner all product_candidates" on public.product_candidates for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all product_scores" on public.product_scores;
create policy "owner all product_scores" on public.product_scores for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all creative_assets" on public.creative_assets;
create policy "owner all creative_assets" on public.creative_assets for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all creative_jobs" on public.creative_jobs;
create policy "owner all creative_jobs" on public.creative_jobs for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all campaigns" on public.campaigns;
create policy "owner all campaigns" on public.campaigns for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all ad_creatives" on public.ad_creatives;
create policy "owner all ad_creatives" on public.ad_creatives for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "owner all ad_performance" on public.ad_performance;
create policy "owner all ad_performance" on public.ad_performance for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Customer-owned data policies (0002)
drop policy if exists "customer select own profile" on public.customers;
create policy "customer select own profile" on public.customers
  for select using (auth.uid() = auth_user_id);
drop policy if exists "customer insert own profile" on public.customers;
create policy "customer insert own profile" on public.customers
  for insert with check (auth.uid() = auth_user_id);
drop policy if exists "customer update own profile" on public.customers;
create policy "customer update own profile" on public.customers
  for update using (auth.uid() = auth_user_id) with check (auth.uid() = auth_user_id);

drop policy if exists "customer select own addresses" on public.addresses;
create policy "customer select own addresses" on public.addresses
  for select using (customer_id = public.current_customer_id());
drop policy if exists "customer insert own addresses" on public.addresses;
create policy "customer insert own addresses" on public.addresses
  for insert with check (customer_id = public.current_customer_id());
drop policy if exists "customer update own addresses" on public.addresses;
create policy "customer update own addresses" on public.addresses
  for update using (customer_id = public.current_customer_id()) with check (customer_id = public.current_customer_id());
drop policy if exists "customer delete own addresses" on public.addresses;
create policy "customer delete own addresses" on public.addresses
  for delete using (customer_id = public.current_customer_id());

drop policy if exists "customer select own orders" on public.orders;
create policy "customer select own orders" on public.orders
  for select using (customer_id = public.current_customer_id());
drop policy if exists "customer insert own orders" on public.orders;
create policy "customer insert own orders" on public.orders
  for insert with check (customer_id = public.current_customer_id());

drop policy if exists "customer select own order_items" on public.order_items;
create policy "customer select own order_items" on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.customer_id = public.current_customer_id()
    )
  );

drop policy if exists "customer insert own reviews" on public.reviews;
create policy "customer insert own reviews" on public.reviews
  for insert with check (customer_id = public.current_customer_id() and status = 'pending');
drop policy if exists "customer select own reviews" on public.reviews;
create policy "customer select own reviews" on public.reviews
  for select using (customer_id = public.current_customer_id());

-- ---------------------------------------------------------------------------
-- 7. Updated-at triggers (drop-if-exists + create — idempotent)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'categories','collections','products','product_variants','suppliers',
    'supplier_products','customers','orders','fulfillment','ai_providers',
    'agent_jobs','product_candidates','creative_assets','creative_jobs',
    'campaigns','ad_creatives'
  ] loop
    execute format('drop trigger if exists set_updated_at_trg on public.%I;', t);
    execute format('create trigger set_updated_at_trg before update on public.%I for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Indexes (create index if not exists — idempotent)
-- ---------------------------------------------------------------------------
create index if not exists idx_products_slug on public.products(slug);
create index if not exists idx_products_status on public.products(status);
create index if not exists idx_products_category on public.products(category_id);
create index if not exists idx_products_agent_score on public.products(agent_score desc);
create index if not exists idx_variants_product on public.product_variants(product_id);
create index if not exists idx_images_product on public.product_images(product_id);
create index if not exists idx_orders_customer on public.orders(customer_id);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_reviews_product on public.reviews(product_id);
create index if not exists idx_reviews_status on public.reviews(status);
create index if not exists idx_agent_jobs_status on public.agent_jobs(status);
create index if not exists idx_agent_jobs_type on public.agent_jobs(type);
create index if not exists idx_candidates_status on public.product_candidates(status);
create index if not exists idx_ad_perf_creative on public.ad_performance(ad_creative_id, date);

-- ---------------------------------------------------------------------------
-- 9. Role grants (0003) — idempotent
-- ---------------------------------------------------------------------------
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
