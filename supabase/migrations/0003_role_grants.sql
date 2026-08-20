-- ============================================================================
-- LUXEDGE V2 — 0003: ROLE GRANTS (idempotent)
--
-- Restores the standard Supabase privileges on all public tables/sequences/
-- functions. Needed when schema was applied through a raw postgres connection
-- (which does not install Supabase's ALTER DEFAULT PRIVILEGES), leaving
-- `authenticated` / `service_role` without access (observed: PostgREST
-- returned 42501 "permission denied for table categories" for the secret
-- key, and RLS INSERTs failed for the service role).
--
-- Safe to run at any time: GRANT is idempotent and additive.
-- Apply in the Dashboard → SQL Editor (or via psql once the connection
-- string works).
-- ============================================================================

-- Current tables / sequences / functions
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

-- Future objects (so the grants survive new migrations)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
