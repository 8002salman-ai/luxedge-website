-- =============================================================
-- 0012 — Hermes research-intelligence ingestion (RESEARCH ONLY)
-- =============================================================
-- Luxedge is the main execution system. Hermes (via Salman OS) is an
-- OPTIONAL external intelligence source: it sends structured research
-- data (product suggestions, SEO suggestions, marketing findings).
--
-- These tables store RESEARCH EVIDENCE ONLY. Nothing here can trigger
-- code execution, product creation, publishing, pricing, or any other
-- Luxedge write — that all happens later through Luxedge's own
-- validation/scoring/pipeline with owner authorization.
--
-- All four tables are admin-read/write via RLS (same pattern as
-- product_candidates / product_scores). The public storefront has no
-- policies here.

-- ------------------------------------------------------------------
-- 1) hermes_recommendations — structured product suggestions
--    (research evidence, NOT automatically imported products)
-- ------------------------------------------------------------------
create table if not exists public.hermes_recommendations (
  id uuid primary key default gen_random_uuid(),
  -- provenance
  source text not null default 'hermes',
  source_ref text,                       -- Salman OS / Hermes run reference
  received_via text not null default 'salman_os',
  -- identity
  product_name text not null,
  category text,
  subcategory text,
  brand text,
  -- evidence links
  source_url text,
  supplier text,
  -- economics (research claims — validated by Luxedge before use)
  supplier_price numeric(10,2),
  currency text not null default 'USD',
  shipping_cost numeric(10,2),
  landed_cost numeric(10,2),
  delivery_estimate text,
  expected_selling_price numeric(10,2),
  margin_estimate numeric(5,2),          -- percent
  -- market evidence (claims — never treated as Luxedge facts)
  ratings numeric(3,1),
  reviews integer,
  demand_evidence text,
  competition text,
  -- narrative
  benefits text,
  marketing_potential text,
  ads_potential text,
  risks text,
  recommendation text,
  -- confidence / lifecycle
  confidence numeric(3,2),               -- 0..1, Hermes's own confidence
  status text not null default 'new'
    check (status in ('new','reviewed','accepted','rejected','imported')),
  review_note text,
  -- Luxedge's own assessment (computed, stored)
  luxedge_score numeric(5,2),            -- Luxedge Opportunity Score (0..100)
  validation jsonb not null default '{}'::jsonb,   -- field-by-field VALIDATED/UNKNOWN
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- 2) hermes_seo_suggestions — SEO research feed.
--    Luxedge's own SEO engine decides whether/how to implement.
--    NEVER auto-applied.
-- ------------------------------------------------------------------
create table if not exists public.hermes_seo_suggestions (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'hermes',
  source_ref text,
  project text not null default 'luxedge',
  url text,                              -- target page (may be null = sitewide)
  suggestion_type text not null
    check (suggestion_type in ('keyword','title','meta_description','content','internal_link','category','topic_cluster','marketing_language','other')),
  recommendation text not null,
  evidence text,
  keyword text,
  intent text,
  priority text not null default 'medium'
    check (priority in ('low','medium','high')),
  confidence numeric(3,2),
  status text not null default 'new'
    check (status in ('new','reviewed','accepted','rejected','implemented')),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- 3) hermes_marketing_intel — market / marketing research findings
-- ------------------------------------------------------------------
create table if not exists public.hermes_marketing_intel (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'hermes',
  source_ref text,
  intel_type text not null
    check (intel_type in ('market','positioning','competitor','trend','seasonal','bundle','promotion','content','email','social','audience','offer','other')),
  title text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  confidence numeric(3,2),
  status text not null default 'new'
    check (status in ('new','reviewed','dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- 4) ads_readiness — Luxedge's OWN ads-readiness assessment per
--    product, computed from Luxedge economics only. Unknown economics
--    stay UNKNOWN (never invented). Planning input, never a campaign.
-- ------------------------------------------------------------------
create table if not exists public.ads_readiness (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  recommendation_id uuid references public.hermes_recommendations(id) on delete set null,
  -- Luxedge economics (computed/verified at assessment time)
  selling_price numeric(10,2),
  landed_cost numeric(10,2),
  gross_margin numeric(5,2),             -- percent
  estimated_variable_costs numeric(10,2),
  contribution_margin numeric(10,2),
  break_even_cac numeric(10,2),
  allowable_cac numeric(10,2),
  assessment text,
  readiness text not null default 'insufficient_data'
    check (readiness in ('insufficient_data','possible','promising','strong')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- RLS — admin only (identical pattern to product_candidates)
-- ------------------------------------------------------------------
alter table public.hermes_recommendations enable row level security;
alter table public.hermes_seo_suggestions enable row level security;
alter table public.hermes_marketing_intel enable row level security;
alter table public.ads_readiness enable row level security;

drop policy if exists "owner all hermes_recommendations" on public.hermes_recommendations;
create policy "owner all hermes_recommendations" on public.hermes_recommendations
  for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "owner all hermes_seo_suggestions" on public.hermes_seo_suggestions;
create policy "owner all hermes_seo_suggestions" on public.hermes_seo_suggestions
  for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "owner all hermes_marketing_intel" on public.hermes_marketing_intel;
create policy "owner all hermes_marketing_intel" on public.hermes_marketing_intel
  for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "owner all ads_readiness" on public.ads_readiness;
create policy "owner all ads_readiness" on public.ads_readiness
  for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- indexes for the admin feeds
create index if not exists hermes_recommendations_status_idx on public.hermes_recommendations(status);
create index if not exists hermes_recommendations_created_at_idx on public.hermes_recommendations(created_at);
create index if not exists hermes_seo_suggestions_status_idx on public.hermes_seo_suggestions(status);
create index if not exists hermes_seo_suggestions_created_at_idx on public.hermes_seo_suggestions(created_at);
create index if not exists hermes_marketing_intel_created_at_idx on public.hermes_marketing_intel(created_at);
create index if not exists ads_readiness_product_idx on public.ads_readiness(product_id);
