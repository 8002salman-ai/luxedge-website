-- ============================================================================
-- LUXEDGE V2 — 0005: DROP STALE LEGACY CURRENCY/COUNTRY CHECKS
--
-- WHY THIS EXISTS
--   0004 reconciled the live 13-table legacy schema but did NOT remove the
--   legacy CHECK constraints on `currency` / `country` columns. The live
--   products table still has `products_currency_check` which only accepts
--   lowercase 'usd', while V2 (0001) defaults every currency column to
--   uppercase 'USD'. Result: every V2 product/order/payment insert with the
--   default currency fails with:
--     new row for relation "products" violates check constraint
--     "products_currency_check"
--   (Verified live 2026-08-17: currency 'usd' → 201, 'USD' → 400.)
--
-- WHAT IT DOES
--   Drops EVERY legacy CHECK constraint matching %_currency_check or
--   %_country_check in the public schema (products, orders, addresses, and
--   any other table carrying one). V2 enforces nothing on these columns, so
--   removing the stale checks is additive-safe: no data changes, no DROP
--   TABLE/TRUNCATE, re-runnable (idempotent), inside one transaction.
--
-- APPLY AFTER 0004: paste into Dashboard → SQL Editor and run.
-- ============================================================================

BEGIN;

do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass::text as tbl, conname
    from pg_constraint
    where contype = 'c'
      and connamespace = 'public'::regnamespace
      and (conname like '%\_currency\_check' or conname like '%\_country\_check')
  loop
    execute format('alter table public.%I drop constraint if exists %I', c.tbl, c.conname);
    raise notice 'dropped % on %', c.conname, c.tbl;
  end loop;
end $$;

COMMIT;
