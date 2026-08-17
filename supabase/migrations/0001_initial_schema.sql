-- ============================================================================
-- LUXEDGE V2 — INITIAL SCHEMA (Phase 1 data foundation)
--
-- Additive and safe: creates the tables the V2 data layer (src/services/db.ts)
-- and future AI agents expect. Apply to a NEW Supabase project via:
--   supabase db push
-- or paste into the Supabase SQL editor.
--
-- SECURITY NOTES:
--  * Row Level Security is enabled on every table.
--  * Public (anon) role may only READ published storefront data
--    (products/categories/collections/reviews.approved).
--  * Everything else requires the authenticated role; admin writes happen
--    through the service-role key, which NEVER ships to the browser.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions & helpers
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
-- Storefront catalog
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  parent_id uuid references public.categories(id) on delete set null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  premium_title text,
  short_description text,
  long_description text,
  features jsonb not null default '[]'::jsonb,
  benefits jsonb not null default '[]'::jsonb,
  specifications jsonb not null default '{}'::jsonb,
  category_id uuid references public.categories(id) on delete set null,
  brand text,
  status text not null default 'draft'
    check (status in ('candidate','researching','qualified','creative_generation','listing_draft','qa','approved','published','rejected','failed','paused','archived')),
  agent_score numeric(5,2),
  score_explanation text,
  price numeric(10,2),
  compare_at_price numeric(10,2),
  cost_price numeric(10,2),
  landed_cost numeric(10,2),
  gross_margin numeric(10,2),
  currency text not null default 'USD',
  sku text,
  inventory_qty integer not null default 0,
  shipping_cost numeric(10,2),
  est_us_delivery_days integer,
  seo_title text,
  seo_description text,
  seo_keywords jsonb not null default '[]'::jsonb,
  structured_data jsonb,
  product_source_evidence jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  attributes jsonb not null default '{}'::jsonb,
  sku text,
  price numeric(10,2),
  compare_at_price numeric(10,2),
  cost_price numeric(10,2),
  inventory_qty integer not null default 0,
  status text not null default 'active',
  low_stock_threshold integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  url text not null,
  alt_text text,
  kind text not null default 'product'
    check (kind in ('product','lifestyle','creative','video','ugc')),
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
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
  -- NOTE: never store supplier credentials here
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

-- ---------------------------------------------------------------------------
-- Inventory & pricing
-- ---------------------------------------------------------------------------
create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade,
  quantity integer not null default 0,
  warehouse text,
  reserved integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.pricing_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  price numeric(10,2) not null,
  compare_at_price numeric(10,2),
  source text,
  changed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Customers & orders
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text,
  full_name text,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text,
  postal_code text not null,
  country text not null default 'US',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','processing','shipped','delivered','cancelled','refunded','failed')),
  subtotal numeric(10,2) not null default 0,
  shipping numeric(10,2) not null default 0,
  tax numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  currency text not null default 'USD',
  shipping_address jsonb,
  payment_method text,
  payment_status text not null default 'unpaid',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name text not null,
  quantity integer not null,
  unit_price numeric(10,2) not null,
  total numeric(10,2) not null
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null,
  provider_ref text,
  amount numeric(10,2) not null,
  currency text not null default 'USD',
  status text not null default 'pending',
  raw jsonb,
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

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- AI providers (metadata only — secrets stay in server env vars)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  provider text unique not null,
  is_enabled boolean not null default true,
  is_default boolean not null default false,
  default_model text,
  config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Agent jobs & logs
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Product candidates & scores
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Creatives
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Advertising (hard budget limits — server-enforced, not just AI instructions)
-- ---------------------------------------------------------------------------
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
-- Updated-at triggers
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
    execute format('create trigger set_updated_at_trg before update on public.%I for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
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

-- Public read for the storefront (published products only)
create policy "public read categories" on public.categories for select using (is_active = true);
create policy "public read collections" on public.collections for select using (is_active = true);
create policy "public read published products" on public.products for select using (status = 'published');
create policy "public read product variants" on public.product_variants for select using (
  exists (select 1 from public.products p where p.id = product_variants.product_id and p.status = 'published')
);
create policy "public read product images" on public.product_images for select using (
  exists (select 1 from public.products p where p.id = product_images.product_id and p.status = 'published')
);
create policy "public read approved reviews" on public.reviews for select using (status = 'approved');

-- Authenticated (owner) full access — admin writes flow through service role
create policy "owner all categories" on public.categories for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all collections" on public.collections for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all collection_products" on public.collection_products for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all products" on public.products for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all product_variants" on public.product_variants for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all product_images" on public.product_images for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all suppliers" on public.suppliers for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all supplier_products" on public.supplier_products for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all supplier_variants" on public.supplier_variants for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all supplier_shipping" on public.supplier_shipping for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all inventory" on public.inventory for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all pricing_history" on public.pricing_history for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all customers" on public.customers for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all addresses" on public.addresses for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all orders" on public.orders for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all order_items" on public.order_items for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all payments" on public.payments for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all fulfillment" on public.fulfillment for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all reviews" on public.reviews for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all ai_providers" on public.ai_providers for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all agent_jobs" on public.agent_jobs for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all agent_runs" on public.agent_runs for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all agent_logs" on public.agent_logs for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all product_candidates" on public.product_candidates for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all product_scores" on public.product_scores for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all creative_assets" on public.creative_assets for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all creative_jobs" on public.creative_jobs for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all campaigns" on public.campaigns for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all ad_creatives" on public.ad_creatives for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "owner all ad_performance" on public.ad_performance for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Indexes
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
