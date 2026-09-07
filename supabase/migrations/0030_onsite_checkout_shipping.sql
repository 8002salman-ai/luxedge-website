-- =============================================================
-- 0030 — On-site checkout: product weights + PaymentIntent dedupe
-- =============================================================
-- Adds two backward-compatible pieces needed by the on-site
-- (PaymentElement) checkout flow:
--
--   1. products.weight_oz (nullable numeric) — live Shippo carrier
--      rates need physical weight per product. NULL (default) means
--      "no packing metadata yet": the checkout then shows the store's
--      flat-rate fallback instead of a fabricated live rate.
--
--   2. A UNIQUE partial index on luxedge_orders(stripe_payment_intent)
--      — the on-site flow persists its order row BEFORE Stripe confirms
--      (pending), keyed by the real PaymentIntent id. The unique index
--      makes webhook replays / duplicate verify races idempotent: a
--      second insert for the same intent is a no-op instead of a
--      duplicate order. The partial (WHERE stripe_payment_intent IS NOT
--      NULL) form keeps the legacy session rows and the many
--      existing NULL rows out of the index, and legacy hosted-checkout
--      orders stay keyed on the existing stripe_session_id unique
--      constraint exactly as before.
-- =============================================================

alter table public.products
  add column if not exists weight_oz numeric;

create unique index if not exists luxedge_orders_stripe_payment_intent_key
  on public.luxedge_orders(stripe_payment_intent)
  where stripe_payment_intent is not null;
