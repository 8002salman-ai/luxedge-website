-- ============================================================================
-- LUXEDGE V2 — 0007: ADD 'MARKET_INTELLIGENCE' TO agent_jobs.type
--
-- WHY THIS EXISTS
--   Phase 4B introduces the AI Market Intelligence layer, which records its
--   runs as durable agent_jobs (alongside PRODUCT_RESEARCH / PRODUCT_SCORE /
--   PRODUCT_QA / LISTING_GENERATE). The agent_jobs.type check constraint
--   (from 0001/0004) does not include 'MARKET_INTELLIGENCE', so any write
--   with that type would fail live with:
--     new row for relation "agent_jobs" violates check constraint
--     "agent_jobs_type_check"
--
-- WHAT IT DOES
--   Recreates agent_jobs_type_check including 'MARKET_INTELLIGENCE'.
--   Additive-safe: no data changes, no DROP TABLE/TRUNCATE, re-runnable
--   (drop-if-exists + create), inside one transaction. LISTING_GENERATE and
--   PRODUCT_QA already exist in the constraint (Phase 4A), so no change there.
--
-- APPLY: paste into Dashboard → SQL Editor and run.
-- ============================================================================

BEGIN;

alter table public.agent_jobs drop constraint if exists agent_jobs_type_check;
alter table public.agent_jobs add constraint agent_jobs_type_check check (
  type in (
    'MARKET_INTELLIGENCE',
    'PRODUCT_RESEARCH','PRODUCT_SCORE','PRODUCT_QA',
    'LISTING_GENERATE','CREATIVE_GENERATE',
    'PRODUCT_PUBLISH','INVENTORY_CHECK','PRICE_CHECK','SHIPPING_CHECK','AD_PERFORMANCE_CHECK'
  )
);

COMMIT;
