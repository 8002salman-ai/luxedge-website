-- ============================================================================
-- LUXEDGE V2 — 0009: REVOKE DIRECT MUTATION ON supplier_api_runs
--
-- WHY THIS EXISTS
--   Live verification of 0008 (2026-08-17) found that anon/authenticated STILL
--   hold INSERT/UPDATE/DELETE grants on public.supplier_api_runs. Supabase's
--   project defaults grant table privileges DIRECTLY to anon/authenticated/
--   service_role at project creation — 0008's `revoke all ... from public` does
--   not remove those direct role grants. RLS (SELECT-only admin policy, no write
--   policies) already masks the write grants — verified live: anon PATCH on a
--   real row returns 204 with ZERO rows changed (the row's hard_budget stayed
--   untouched). This migration makes the audit's "no direct counter/budget
--   mutation" requirement explicit at the GRANT level, defense in depth.
--
-- AFTER 0009
--   anon / authenticated can only SELECT supplier_api_runs (through the
--   admin-only RLS SELECT policy). ALL mutation flows through the SECURITY
--   DEFINER RPCs: start_supplier_api_run / reserve_supplier_api_points /
--   finish_supplier_api_run (admin-JWT-only; the CJ proxy is the only caller).
--   service_role keeps its standard ops grants (used for verification/cleanup,
--   never by the browser; the RPCs still refuse service-role JWTs internally).
--
-- APPLY: paste into Dashboard → SQL Editor and run. Idempotent + transactional.
-- ============================================================================

BEGIN;

revoke insert, update, delete on public.supplier_api_runs from anon;
revoke insert, update, delete on public.supplier_api_runs from authenticated;

COMMIT;
