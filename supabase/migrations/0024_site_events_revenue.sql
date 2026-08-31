-- 0024: revenue fields on site_events.
-- The recorder now sends value (numeric, USD) and currency on commerce events
-- (purchase, begin_checkout, add_to_cart, view_item) so the Admin dashboard can
-- show real sales revenue instead of just event counts.
-- Safe to re-run; missing columns are handled gracefully by the recorder until
-- this migration is applied.
alter table public.site_events
  add column if not exists value    numeric,
  add column if not exists currency text;
