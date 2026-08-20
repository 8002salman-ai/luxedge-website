-- ============================================================================
-- LUXEDGE V2 — 0002: CUSTOMER-SCOPED RLS (Phase 3A)
--
-- Adds real customer identity + ownership policies on top of the Phase 1
-- schema (0001). Apply AFTER 0001:
--   supabase db push   (or paste into the Supabase SQL editor)
--
-- WHAT THIS ADDS:
--   * customers.auth_user_id  — link a storefront customer to auth.users
--   * public.current_customer_id() — helper resolving the signed-in user to
--     their customers row (auth.uid() based; NULL for anon/unknown)
--   * Customer policies: own profile, own addresses, own orders/order_items,
--     own reviews (inserts start as 'pending')
--
-- SECURITY MODEL (unchanged from 0001):
--   * anon        — public READ only of published storefront data
--   * authenticated customer — their OWN rows only (below)
--   * admin        — full access via app_metadata.role = 'admin' claim
--   * service role — full access server-side (never shipped to the browser)
--
-- Customers can NEVER see or touch suppliers, AI providers, agent jobs,
-- product candidates, creatives, campaigns or other customers' data:
-- no policy exists for those tables, and RLS denies by default.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Link customers to auth.users
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete cascade;

create index if not exists idx_customers_auth_user on public.customers(auth_user_id);

-- ---------------------------------------------------------------------------
-- 2. Helper: the customers.id for the signed-in user (NULL when unknown)
-- ---------------------------------------------------------------------------
create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.customers where auth_user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 3. Customer-owned data policies
-- ---------------------------------------------------------------------------

-- Customers (own profile only)
create policy "customer select own profile" on public.customers
  for select using (auth.uid() = auth_user_id);
create policy "customer insert own profile" on public.customers
  for insert with check (auth.uid() = auth_user_id);
create policy "customer update own profile" on public.customers
  for update using (auth.uid() = auth_user_id) with check (auth.uid() = auth_user_id);

-- Addresses (own only)
create policy "customer select own addresses" on public.addresses
  for select using (customer_id = public.current_customer_id());
create policy "customer insert own addresses" on public.addresses
  for insert with check (customer_id = public.current_customer_id());
create policy "customer update own addresses" on public.addresses
  for update using (customer_id = public.current_customer_id()) with check (customer_id = public.current_customer_id());
create policy "customer delete own addresses" on public.addresses
  for delete using (customer_id = public.current_customer_id());

-- Orders: customers see + create their own. Status changes / admin actions
-- remain admin/service-role only (no customer UPDATE/DELETE policy here).
create policy "customer select own orders" on public.orders
  for select using (customer_id = public.current_customer_id());
create policy "customer insert own orders" on public.orders
  for insert with check (customer_id = public.current_customer_id());

-- Order items: only through an order the customer owns
create policy "customer select own order_items" on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.customer_id = public.current_customer_id()
    )
  );

-- Reviews: customers may submit their own (pending by default) and read their own
create policy "customer insert own reviews" on public.reviews
  for insert with check (customer_id = public.current_customer_id() and status = 'pending');
create policy "customer select own reviews" on public.reviews
  for select using (customer_id = public.current_customer_id());
