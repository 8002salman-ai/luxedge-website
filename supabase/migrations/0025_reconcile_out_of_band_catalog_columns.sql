-- ============================================================================
-- LUXEDGE — 0025 RECONCILE OUT-OF-BAND CATALOG COLUMNS
--
-- The LIVE production schema carries columns that were added out-of-band
-- (manual dashboard ALTERs, never committed to a migration). They are live-
-- verified HTTP 200 via PostgREST (anon key, 2026-09-01) and their exact
-- types were read from the live OpenAPI schema (read-only):
--
--   public.products.title              → text     (default none)
--   public.products.description        → text     (default '')
--   public.products.image_url          → text     (default none)
--   public.products.compare_at_amount  → integer  (legacy cents; the client
--                                                  converts via centsToDollars)
--   public.product_images.public_url   → text     (default none)
--
-- All statements are ADD COLUMN IF NOT EXISTS, so they are a SAFE NO-OP
-- against the already-migrated live database (Postgres skips existing columns
-- by name) and idempotent everywhere. No data is changed or fabricated.
--
-- products.price_amount is deliberately NOT added: it does not exist on the
-- live table (PostgreSQL 42703) and was the real cause of the storefront
-- catalog 400 incident.
-- ============================================================================

alter table public.products
  add column if not exists title text,
  add column if not exists description text not null default '',
  add column if not exists image_url text,
  add column if not exists compare_at_amount integer;

alter table public.product_images
  add column if not exists public_url text;