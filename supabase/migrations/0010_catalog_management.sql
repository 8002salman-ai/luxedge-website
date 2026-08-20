-- ============================================================================
-- LUXEDGE V2 — 0010: CATALOG MANAGEMENT (Product Manager + Promotions)
--
-- WHY THIS EXISTS
--   The Catalog Launch Phase (owner direction) turns Luxedge into a real
--   editable store catalog. The products table already exists; this migration
--   adds the merchandising / pricing / inventory / shipping / SEO fields the
--   Product Manager needs, links product_images to variants, and creates the
--   promotions + settings tables (coupons, store offers, free-shipping rules).
--
-- STATUS MODEL
--   products.status is extended to the catalog lifecycle:
--     draft (default) → ready → active → inactive / archived
--   Only status IN ('active','published') is storefront-visible ('published'
--   retained for pre-existing pipeline rows). AUTO PUBLISH remains OFF.
--
-- TRUTH RULES
--   Merchandising flags (featured / new_arrival / trending / best_rated /
--   best_seller / promoted) are ADMIN-SET. They must only be enabled on real
--   evidence or an explicit owner merchandising decision — never fabricated.
--   compare_at_price is a genuine promotional value approved by the store,
--   not deceptive pricing.
--
-- SECURITY
--   anon may read ACTIVE storefront products + ACTIVE coupons/offers +
--   free-shipping settings only. All writes remain admin-only (RLS + admin
--   JWT through the browser db adapter; service-role is server-side only).
--   No credentials anywhere.
--
-- APPLY: paste into Dashboard → SQL Editor and run (idempotent, transactional).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. PRODUCTS — catalog status values
-- ---------------------------------------------------------------------------
alter table public.products drop constraint if exists products_status_check;
alter table public.products add constraint products_status_check check (
  status in ('candidate','researching','qualified','creative_generation','listing_draft','draft','ready','active','inactive','qa','approved','published','rejected','failed','paused','archived')
);

-- ---------------------------------------------------------------------------
-- 2. PRODUCTS — merchandising / pricing / inventory / shipping / SEO columns
-- ---------------------------------------------------------------------------
alter table public.products add column if not exists short_title text;
alter table public.products add column if not exists subtitle text;
alter table public.products add column if not exists tags jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists featured boolean not null default false;
alter table public.products add column if not exists new_arrival boolean not null default false;
alter table public.products add column if not exists trending boolean not null default false;
alter table public.products add column if not exists best_rated boolean not null default false;
alter table public.products add column if not exists best_seller boolean not null default false;
alter table public.products add column if not exists promoted boolean not null default false;
alter table public.products add column if not exists sale_enabled boolean not null default false;
alter table public.products add column if not exists discount_type text check (discount_type is null or discount_type in ('percent','fixed'));
alter table public.products add column if not exists discount_value numeric(10,2);
alter table public.products add column if not exists stock_status text check (stock_status is null or stock_status in ('in_stock','low_stock','out_of_stock','on_backorder'));
alter table public.products add column if not exists low_stock_threshold integer not null default 0;
alter table public.products add column if not exists free_shipping boolean not null default false;
alter table public.products add column if not exists delivery_min_days integer;
alter table public.products add column if not exists delivery_max_days integer;
alter table public.products add column if not exists shipping_note text;
alter table public.products add column if not exists us_inventory boolean not null default false;
alter table public.products add column if not exists supplier_source text;
alter table public.products add column if not exists supplier_product_ref text;
alter table public.products add column if not exists canonical_slug text;
alter table public.products add column if not exists og_image text;
alter table public.products add column if not exists owner_notes text;
alter table public.products add column if not exists evidence_notes text;
alter table public.products add column if not exists sort_order integer not null default 0;

-- ---------------------------------------------------------------------------
-- 3. PRODUCT IMAGES — optional variant linkage (variant-image mapping)
-- ---------------------------------------------------------------------------
alter table public.product_images add column if not exists variant_id uuid references public.product_variants(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 4. COUPONS
-- ---------------------------------------------------------------------------
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  description text,
  discount_type text not null check (discount_type in ('percent','fixed')),
  discount_value numeric(10,2) not null default 0,
  min_cart_value numeric(10,2) not null default 0,
  eligible_product_ids jsonb not null default '[]'::jsonb,
  eligible_category_ids jsonb not null default '[]'::jsonb,
  start_at timestamptz,
  end_at timestamptz,
  usage_limit integer,
  used_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. STORE OFFERS
-- ---------------------------------------------------------------------------
create table if not exists public.store_offers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  offer_type text not null check (offer_type in ('percentage','product_sale','category_sale','free_shipping')),
  value numeric(10,2),
  product_ids jsonb not null default '[]'::jsonb,
  category_ids jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  start_at timestamptz,
  end_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. STORE SETTINGS (free-shipping strategy, defaults; key/value jsonb)
-- ---------------------------------------------------------------------------
create table if not exists public.store_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.coupons enable row level security;
alter table public.store_offers enable row level security;
alter table public.store_settings enable row level security;

-- Storefront reads: ACTIVE products (published retained for legacy rows)
drop policy if exists "public read published products" on public.products;
create policy "public read published products" on public.products for select using (status in ('published','active'));

-- Storefront may read active coupons/offers and free-shipping settings.
-- A coupon CODE is public by design (codes are meant to be shared); usage
-- limits are enforced at application time by the server/admin logic.
drop policy if exists "public read active coupons" on public.coupons;
create policy "public read active coupons" on public.coupons for select using (is_active = true);

drop policy if exists "public read active offers" on public.store_offers;
create policy "public read active offers" on public.store_offers for select using (is_active = true);

drop policy if exists "public read free shipping settings" on public.store_settings;
create policy "public read free shipping settings" on public.store_settings for select using (key = 'free_shipping');

-- Admin full access
drop policy if exists "owner all coupons" on public.coupons;
create policy "owner all coupons" on public.coupons for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "owner all store_offers" on public.store_offers;
create policy "owner all store_offers" on public.store_offers for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "owner all store_settings" on public.store_settings;
create policy "owner all store_settings" on public.store_settings for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ---------------------------------------------------------------------------
-- 8. INDEXES + TRIGGERS
-- ---------------------------------------------------------------------------
create index if not exists idx_products_status_catalog on public.products(status) where status in ('published','active');
create index if not exists idx_products_featured on public.products(featured) where featured = true;
create index if not exists idx_products_new_arrival on public.products(new_arrival) where new_arrival = true;
create index if not exists idx_product_images_variant on public.product_images(variant_id);
create index if not exists idx_coupons_code on public.coupons(code);
create index if not exists idx_coupons_active on public.coupons(is_active) where is_active = true;
create index if not exists idx_offers_active on public.store_offers(is_active) where is_active = true;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_trg' and tgrelid = 'public.coupons'::regclass) then
    create trigger set_updated_at_trg before update on public.coupons for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_trg' and tgrelid = 'public.store_offers'::regclass) then
    create trigger set_updated_at_trg before update on public.store_offers for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_trg' and tgrelid = 'public.store_settings'::regclass) then
    create trigger set_updated_at_trg before update on public.store_settings for each row execute function public.set_updated_at();
  end if;
end $$;

COMMIT;
