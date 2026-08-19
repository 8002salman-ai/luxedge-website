-- =============================================================
-- 0013 — Stripe order persistence (REAL checkout)
-- =============================================================
-- The legacy `orders` table is a demo-era artifact (integer
-- `total_amount`, opaque CHECK constraint, hidden NOT NULL columns)
-- and is NOT safely reusable for real payments. This migration adds
-- ONE clean order table used by the server-side Stripe webhook.
--
-- Design:
--   - stripe_session_id is UNIQUE -> the webhook is idempotent: a
--     replayed checkout.session.completed event cannot create a
--     duplicate order (insert fails 23505, treated as already done).
--   - items is a JSONB snapshot (product id/name/unit price/qty at
--     purchase time) — the webhook never trusts client prices.
--   - No card data is ever stored (PCI). Only Stripe identifiers,
--     totals, and shipping contact.
--   - Admin-only RLS (same pattern as product_candidates). The
--     serverless webhook writes with the service-role key (bypasses
--     RLS); customers/admins read via server endpoints.
-- =============================================================

create table if not exists public.luxedge_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  customer_email text,
  customer_name text,
  shipping_address jsonb,
  items jsonb not null default '[]'::jsonb,
  coupon_code text,
  subtotal numeric(10,2) not null,
  discount numeric(10,2) not null default 0,
  shipping numeric(10,2) not null default 0,
  tax numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  currency text not null default 'USD',
  status text not null default 'awaiting_payment'
    check (status in ('pending','awaiting_payment','paid','processing','shipped','delivered','cancelled','refunded','failed')),
  stripe_session_id text unique,
  stripe_payment_intent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.luxedge_orders enable row level security;

drop policy if exists "owner all luxedge_orders" on public.luxedge_orders;
create policy "owner all luxedge_orders" on public.luxedge_orders
  for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create index if not exists luxedge_orders_created_at_idx on public.luxedge_orders(created_at desc);
create index if not exists luxedge_orders_stripe_session_idx on public.luxedge_orders(stripe_session_id);
create index if not exists luxedge_orders_email_idx on public.luxedge_orders(customer_email);
