-- ============================================================================
-- LUXEDGE V2 — 0028: WISHLIST ITEMS (account-backed "save for later")
--
-- Signed-in shoppers can persist their wishlist server-side so saved items
-- follow them across devices. The storefront wishlist module (features/
-- wishlist) reads/writes this table with the user's own access token; the
-- rows are RLS-scoped to their account, so no custom API is needed.
--
-- ANALYTICS STAYS IN site_events: every toggle still records
-- add_to_wishlist / remove_from_wishlist into site_events (migration 0023),
-- which is what the admin Saved counts (product-stats, Traffic dashboard)
-- aggregate. This table is persistence ONLY — never read for analytics.
--
-- SECURITY MODEL:
--   * authenticated (the signed-in shopper) — SELECT/INSERT/DELETE only on
--     rows where user_id = auth.uid(). No UPDATE needed (a row either exists
--     or it does not).
--   * anon — no access at all (anonymous visitors use device-local storage).
--   * service_role — full access (server-side tooling only).
--   * The insert WITH CHECK forces user_id = auth.uid(), so a client can
--     never write a row attributed to another account.
-- ============================================================================

create table if not exists public.wishlist_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  product_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index if not exists idx_wishlist_items_user
  on public.wishlist_items (user_id);

alter table public.wishlist_items enable row level security;

create policy "wishlist_items own select"
  on public.wishlist_items
  for select to authenticated
  using (auth.uid() = user_id);

create policy "wishlist_items own insert"
  on public.wishlist_items
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "wishlist_items own delete"
  on public.wishlist_items
  for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.wishlist_items to authenticated;
grant all on public.wishlist_items to service_role;