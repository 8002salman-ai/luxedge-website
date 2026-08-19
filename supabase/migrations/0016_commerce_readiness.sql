-- ============================================================================
-- LUXEDGE V2 — 0016 COMMERCE READINESS + SOURCE / ECONOMICS HARDENING
--
-- Adds the commerce-readiness model so ACTIVE truly means "genuinely sellable":
--   commerce_readiness — COMMERCE_READY | SOURCE_PENDING | ECONOMICS_PENDING |
--                        FULFILLMENT_PENDING | RISK_REVIEW | DRAFT
--   source_type       — CJ_DROPSHIPPING | AUTHORIZED_WHOLESALE |
--                        MANUFACTURER_DIRECT | RETAIL_REFERENCE_ONLY |
--                        OWNER_STOCK | OTHER_VERIFIED | UNKNOWN
--   inventory_source  — SUPPLIER_VERIFIED | INTERNAL_STOCK | UNTRACKED | UNKNOWN
--   fulfillment_method / supplier_url / supplier_stock_status — supply truth
--   risk_flags        — jsonb list of unresolved risk labels (battery, IP, …)
--
-- Storefront eligibility requires commerce_readiness = 'COMMERCE_READY'
-- (enforced in code; RLS already restricts storefront reads to published/active).
--
-- No data is deleted or fabricated here. Existing rows keep all content;
-- the audit backfills classification from persisted evidence.
-- ============================================================================

alter table public.products
  add column if not exists commerce_readiness text
    check (commerce_readiness in (
      'COMMERCE_READY', 'SOURCE_PENDING', 'ECONOMICS_PENDING',
      'FULFILLMENT_PENDING', 'RISK_REVIEW', 'DRAFT')),
  add column if not exists source_type text
    check (source_type in (
      'CJ_DROPSHIPPING', 'AUTHORIZED_WHOLESALE', 'MANUFACTURER_DIRECT',
      'RETAIL_REFERENCE_ONLY', 'OWNER_STOCK', 'OTHER_VERIFIED', 'UNKNOWN')),
  add column if not exists inventory_source text
    check (inventory_source in ('SUPPLIER_VERIFIED', 'INTERNAL_STOCK', 'UNTRACKED', 'UNKNOWN')),
  add column if not exists fulfillment_method text,
  add column if not exists supplier_url text,
  add column if not exists supplier_stock_status text,
  add column if not exists risk_flags jsonb not null default '[]'::jsonb;

create index if not exists products_commerce_readiness_idx on public.products (commerce_readiness);
create index if not exists products_source_type_idx on public.products (source_type);
