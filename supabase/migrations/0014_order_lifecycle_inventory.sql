-- =============================================================
-- 0014 — Order lifecycle + atomic inventory (Stripe launch hardening)
-- =============================================================
-- Adds refund tracking to luxedge_orders (partial-refund support) and an
-- ATOMIC inventory-decrement RPC so a verified payment can never silently
-- oversell stock, even under webhook replay/concurrency.
--
-- The webhook calls decrement_inventory with the service-role key ONLY after
-- a fresh luxedge_orders insert (stripe_session_id UNIQUE already guards
-- replay), so inventory is decremented exactly once per paid order.
-- =============================================================

-- Refund tracking (Stripe-authoritative amounts, never guessed).
alter table public.luxedge_orders
  add column if not exists refunded_amount numeric(10,2) not null default 0,
  add column if not exists refunded_at timestamptz;

-- Extend the status enum to support partial refunds.
alter table public.luxedge_orders drop constraint if exists luxedge_orders_status_check;
alter table public.luxedge_orders
  add constraint luxedge_orders_status_check check (
    status in ('pending','awaiting_payment','paid','processing','shipped','delivered','cancelled','refunded','partially_refunded','failed')
  );

-- ---------------------------------------------------------------------------
-- Atomic inventory decrement.
--   - Updates ONLY when enough stock exists (inventory_qty >= p_quantity) so
--     stock can never go negative.
--   - inventory_qty NULL = untracked stock → returns ok with untracked:true
--     (nothing to decrement, nothing to oversell).
--   - Returns a jsonb verdict the webhook can read.
-- ---------------------------------------------------------------------------
create or replace function public.decrement_inventory(p_product_id uuid, p_quantity integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty integer;
  v_untracked boolean;
begin
  if p_quantity is null or p_quantity < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_quantity');
  end if;

  -- Does the product exist and is stock untracked?
  select (inventory_qty is null) into v_untracked
    from public.products where id = p_product_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;
  if v_untracked then
    return jsonb_build_object('ok', true, 'untracked', true, 'remaining', null);
  end if;

  update public.products
     set inventory_qty = inventory_qty - p_quantity,
         updated_at = now()
   where id = p_product_id
     and inventory_qty is not null
     and inventory_qty >= p_quantity
  returning inventory_qty into v_qty;

  if v_qty is null then
    return jsonb_build_object('ok', false, 'reason', 'out_of_stock_or_oversell');
  end if;
  return jsonb_build_object('ok', true, 'remaining', v_qty);
end;
$$;

-- Only the serverless webhook (service role) may call this.
revoke all on function public.decrement_inventory(uuid, integer) from public, anon, authenticated;
grant execute on function public.decrement_inventory(uuid, integer) to service_role;
