-- ============================================================================
-- LUXEDGE V2 — 0006: ALLOW 'draft' IN products_status_check
--
-- WHY THIS EXISTS
--   0001 defines products.status with default 'draft' but its check
--   constraint omits 'draft' (only 'listing_draft' is listed). Every INSERT
--   that omits status (or sets status='draft') therefore fails live with:
--     new row for relation "products" violates check constraint
--     "products_status_check"
--   (Verified live 2026-08-17 after 0005: a products write with currency
--   'USD' + status 'draft' was rejected by products_status_check.)
--
-- WHAT IT DOES
--   Recreates products_status_check including 'draft'. Additive-safe: no
--   data changes, no DROP TABLE/TRUNCATE, re-runnable (drop-if-exists +
--   create), inside one transaction. Recommended before Phase 4 (the product
--   scout writes products through their status lifecycle).
--
-- APPLY: paste into Dashboard → SQL Editor and run.
-- ============================================================================

BEGIN;

alter table public.products drop constraint if exists products_status_check;
alter table public.products add constraint products_status_check check (
  status in ('candidate','researching','qualified','creative_generation','listing_draft','draft','qa','approved','published','rejected','failed','paused','archived')
);

COMMIT;
