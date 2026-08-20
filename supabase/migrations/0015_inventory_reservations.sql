-- ============================================================================
-- 0015 — REAL inventory reservation (prevents oversell between checkout
--        create and the payment webhook)
--
-- PROBLEM IT SOLVES:
--   Decrementing stock only AFTER payment leaves a race: two customers can
--   both pay for the last unit before either webhook decrements. Instead,
--   stock is reduced ATOMICALLY when the checkout session is created
--   (reserve_inventory), held while the customer pays, then either
--   CONSUMED on verified payment or RELEASED (stock restored) on expiry /
--   async-payment failure.
--
-- FLOW:
--   POST /api/checkout
--     → reserve_inventory(product, qty, reservation_id, expires_at)
--       (available stock reduced immediately — second customer sees
--        OUT_OF_STOCK instead of paying for the last unit)
--     → create Stripe session with metadata.reservation = reservation_id
--     → on Stripe session failure: release_reservation (stock restored)
--   Webhook:
--     checkout.session.completed + payment_status=paid
--     / async_payment_succeeded
--       → persist paid order exactly once → consume_reservation
--     checkout.session.completed + payment_status!=paid
--       → persist order as awaiting_payment (NO inventory change)
--     checkout.session.expired / async_payment_failed
--       → release_reservation (stock restored, exactly once)
--
-- IDEMPOTENCY:
--   - reserve: unique (reservation_id, product_id) → re-calling is a no-op.
--   - consume: only status='reserved' (or released/expired → stock restored,
--     so decrement now) rows flip to 'consumed'; already-consumed rows are
--     untouched → webhook replays never double-consume.
--   - release: only status='reserved' rows flip to 'released' + restore
--     stock → never double-restores.
--   - Abandoned checkouts are covered even if the webhook never fires: every
--     reserve call lazily sweeps expired reservations and restores their
--     stock.
--
-- SECURITY: RLS enabled; admin read-only. The three RPCs are the ONLY
-- writers and are granted to service_role alone (revoked from
-- public/anon/authenticated).
-- ============================================================================

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  status text not null default 'reserved'
    check (status in ('reserved','consumed','released','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  unique (reservation_id, product_id)
);

alter table public.inventory_reservations enable row level security;

drop policy if exists "owner read inventory_reservations" on public.inventory_reservations;
create policy "owner read inventory_reservations" on public.inventory_reservations
  for select using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create index if not exists inventory_reservations_group_idx on public.inventory_reservations(reservation_id);
create index if not exists inventory_reservations_expiry_idx on public.inventory_reservations(status, expires_at);

-- ---------------------------------------------------------------------------
-- reserve_inventory — atomically reduce available stock + record the hold.
-- Lazily sweeps EXPIRED reservations first so abandoned checkouts return
-- stock without waiting on the webhook.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_inventory(
  p_reservation_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_qty integer;
  v_untracked boolean;
begin
  if p_quantity is null or p_quantity < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_quantity');
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'invalid_expiry');
  end if;

  -- Sweep: any expired 'reserved' row → release + restore stock (exactly
  -- once per row; the status guard makes replays harmless).
  for v_row in
    select id, product_id, quantity
      from public.inventory_reservations
     where status = 'reserved'
       and expires_at < now()
  loop
    update public.inventory_reservations
       set status = 'released', released_at = now()
     where id = v_row.id and status = 'reserved';
    if found then
      update public.products
         set inventory_qty = inventory_qty + v_row.quantity,
             updated_at = now()
       where id = v_row.product_id
         and inventory_qty is not null;
    end if;
  end loop;

  -- Idempotent: this group+product is already held.
  if exists (select 1 from public.inventory_reservations
              where reservation_id = p_reservation_id and product_id = p_product_id) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select (inventory_qty is null) into v_untracked
    from public.products where id = p_product_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;

  if v_untracked then
    insert into public.inventory_reservations (reservation_id, product_id, quantity, expires_at)
    values (p_reservation_id, p_product_id, p_quantity, p_expires_at);
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

  insert into public.inventory_reservations (reservation_id, product_id, quantity, expires_at)
  values (p_reservation_id, p_product_id, p_quantity, p_expires_at);
  return jsonb_build_object('ok', true, 'remaining', v_qty);
end;
$$;

-- ---------------------------------------------------------------------------
-- consume_reservation — mark a held reservation as consumed after a VERIFIED
-- payment. Idempotent: reserved→consumed needs no stock change (already
-- reduced at reserve); released/expired→consumed restores-then-decrements so
-- a late async payment still charges stock exactly once.
-- Returns consumed count + group size so the webhook can distinguish
-- "already handled" from "reservation missing entirely" (legacy fallback).
-- ---------------------------------------------------------------------------
create or replace function public.consume_reservation(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_consumed integer := 0;
  v_group integer;
begin
  select count(*) into v_group
    from public.inventory_reservations
   where reservation_id = p_reservation_id;

  for v_row in
    select id, product_id, quantity, status
      from public.inventory_reservations
     where reservation_id = p_reservation_id
  loop
    -- Replay guard: already consumed → skip (never double-consume).
    if v_row.status = 'consumed' then
      continue;
    end if;
    update public.inventory_reservations
       set status = 'consumed', consumed_at = now()
     where id = v_row.id and status <> 'consumed';
    if not found then
      continue;
    end if;

    if v_row.status = 'reserved' then
      -- Stock was already reduced at reserve time — nothing more to do.
      v_consumed := v_consumed + 1;
    else
      -- released/expired → stock was restored; decrement now (exactly once,
      -- guarded against oversell).
      update public.products
         set inventory_qty = inventory_qty - v_row.quantity,
             updated_at = now()
       where id = v_row.product_id
         and inventory_qty is not null
         and inventory_qty >= v_row.quantity;
      v_consumed := v_consumed + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'consumed', v_consumed, 'group_size', v_group);
end;
$$;

-- ---------------------------------------------------------------------------
-- release_reservation — restore stock for a checkout that expired or failed
-- (exactly once per row; replays are no-ops).
-- ---------------------------------------------------------------------------
create or replace function public.release_reservation(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_released integer := 0;
begin
  for v_row in
    select id, product_id, quantity
      from public.inventory_reservations
     where reservation_id = p_reservation_id
       and status = 'reserved'
  loop
    update public.inventory_reservations
       set status = 'released', released_at = now()
     where id = v_row.id and status = 'reserved';
    if found then
      update public.products
         set inventory_qty = inventory_qty + v_row.quantity,
             updated_at = now()
       where id = v_row.product_id
         and inventory_qty is not null;
      v_released := v_released + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'released', v_released);
end;
$$;

-- Only the serverless checkout/webhook (service role) may call these.
revoke all on function public.reserve_inventory(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_reservation(uuid) from public, anon, authenticated;
revoke all on function public.release_reservation(uuid) from public, anon, authenticated;
grant execute on function public.reserve_inventory(uuid, uuid, integer, timestamptz) to service_role;
grant execute on function public.consume_reservation(uuid) to service_role;
grant execute on function public.release_reservation(uuid) to service_role;
