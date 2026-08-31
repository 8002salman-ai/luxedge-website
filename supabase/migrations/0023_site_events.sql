-- ============================================================================
-- LUXEDGE V2 — 0023: SITE EVENTS (first-party traffic analytics)
--
-- Records lightweight, first-party analytics events (page_view, view_item,
-- add_to_cart, begin_checkout, purchase, search, ...) so the Admin "Traffic
-- Overview" can show REAL visitor numbers and charts — independent of Google
-- (GA4 dashboard needs Google API auth that is not configured here). The same
-- events also still fire to GA4 via gtag.
--
-- SECURITY MODEL:
--   * anon (the public storefront, anon key, no JWT) — INSERT ONLY. Any visitor
--     may record an event; nobody may read.
--   * authenticated admin (app_metadata.role = 'admin') — SELECT ONLY, full
--     history, for the admin dashboard. No writes; admins cannot forge events.
--   * service_role — full access (server-side only).
-- Anonymous SELECT is intentionally NOT granted, and the anon INSERT policy is
-- the only path — so public data is write-only and never readable by visitors.
-- ============================================================================

create table if not exists public.site_events (
  id           uuid primary key default gen_random_uuid(),
  event        text not null,
  path         text not null default '/',
  referrer     text,
  visitor_id   text,                 -- persistent visitor id (localStorage)
  session_id   text,                 -- per-tab session id (sessionStorage)
  device       text,                 -- 'mobile' | 'tablet' | 'desktop'
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  item_ids     jsonb,                -- product ids referenced by the event
  occurred_at  timestamptz not null default now()
);

create index if not exists idx_site_events_occurred
  on public.site_events (occurred_at desc);
create index if not exists idx_site_events_event
  on public.site_events (event);

alter table public.site_events enable row level security;

-- Visitors (anon) may only INSERT new events — never read.
create policy "site_events anon insert"
  on public.site_events
  for insert to anon, authenticated
  with check (true);

-- Only signed-in admins may read the full history.
create policy "site_events admin select"
  on public.site_events
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- anon: insert only. authenticated: select (RLS admin-only) + insert.
grant insert on public.site_events to anon;
grant select, insert on public.site_events to authenticated;
grant all on public.site_events to service_role;