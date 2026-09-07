-- =============================================================
-- 0031 — Provider-neutral payment fields
-- =============================================================
-- Makes orders payment-provider agnostic. Existing Stripe fields
-- are preserved for historical compatibility; new fields identify
-- the provider and payment lifecycle for any gateway.
-- =============================================================

-- Provider-neutral fields
ALTER TABLE public.luxedge_orders
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS payment_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS payment_provider_payment_id text,
  ADD COLUMN IF NOT EXISTS payment_provider_order_id text;

-- Index for provider-based filtering/reporting
CREATE INDEX IF NOT EXISTS idx_luxedge_orders_payment_provider
  ON public.luxedge_orders(payment_provider);

-- Index for order_type filtering (free_gift vs paid)
CREATE INDEX IF NOT EXISTS idx_luxedge_orders_order_type
  ON public.luxedge_orders(order_type);

-- Unique constraint: one provider payment per provider+payment_id
-- (prevents duplicate revenue from webhook replays across providers)
CREATE UNIQUE INDEX IF NOT EXISTS idx_luxedge_orders_provider_payment_unique
  ON public.luxedge_orders(payment_provider, payment_provider_payment_id)
  WHERE payment_provider_payment_id IS NOT NULL;

-- Backfill existing orders: Stripe orders keep stripe as provider
-- Gift Drop orders get free_gift type
UPDATE public.luxedge_orders
  SET order_type = 'free_gift',
      payment_required = false,
      payment_provider = 'none',
      payment_status = 'not_required'
  WHERE coupon_code = 'PET-GIFT-DROP' OR order_number LIKE 'GIFT-%';

-- Update Stripe orders (those with stripe_session_id or stripe_payment_intent)
UPDATE public.luxedge_orders
  SET payment_provider = 'stripe'
  WHERE (stripe_session_id IS NOT NULL OR stripe_payment_intent IS NOT NULL)
    AND payment_provider = 'stripe';
