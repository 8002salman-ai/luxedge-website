-- ============================================================================
-- LUXEDGE V2 — 0027: OPTIONAL LISTING EXPIRY (seller visibility)
--
-- Adds an OPTIONAL eBay-style listing end date to products. Nullable and
-- fully backwards compatible: every existing product defaults to no expiry
-- (Good 'Til Cancelled).
--
-- This is DISPLAY/SELLER-VISIBILITY ONLY. There is deliberately NO automatic
-- expiry enforcement: no background job exists, and a listing that reaches
-- its end date is never auto-archived or auto-deactivated. The admin shows
-- "Ends in Nd" purely as seller information; the owner decides what to do.
-- ============================================================================

alter table public.products
  add column if not exists listing_ends_at timestamptz;

create index if not exists idx_products_listing_ends_at
  on public.products (listing_ends_at)
  where listing_ends_at is not null;