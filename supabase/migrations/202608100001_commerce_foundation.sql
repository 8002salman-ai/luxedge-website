create extension if not exists pgcrypto;
create type public.catalog_status as enum ('draft', 'review', 'published', 'archived');
create type public.order_status as enum ('pending', 'payment_pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');

create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, display_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.products (id uuid primary key default gen_random_uuid(), slug text not null unique, title text not null, description text not null default '', status public.catalog_status not null default 'draft', currency text not null default 'usd' check (currency = lower(currency) and char_length(currency) = 3), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.product_variants (id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade, sku text not null unique, title text not null, price_amount integer not null check (price_amount >= 0), status public.catalog_status not null default 'draft', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.inventory (variant_id uuid primary key references public.product_variants(id) on delete cascade, available integer not null default 0 check (available >= 0), reserved integer not null default 0 check (reserved >= 0 and reserved <= available), updated_at timestamptz not null default now());
create table public.supplier_mappings (id uuid primary key default gen_random_uuid(), variant_id uuid not null references public.product_variants(id) on delete cascade, supplier_code text not null, supplier_sku text not null, landed_cost_amount integer check (landed_cost_amount >= 0), channel_approved boolean not null default false, evidence_checked_at timestamptz, unique (supplier_code, supplier_sku));
create table public.price_history (id bigint generated always as identity primary key, variant_id uuid not null references public.product_variants(id) on delete cascade, price_amount integer not null check (price_amount >= 0), effective_at timestamptz not null default now());
create table public.orders (id uuid primary key default gen_random_uuid(), order_number bigint generated always as identity unique, user_id uuid references auth.users(id) on delete restrict, guest_session_hash text, email text not null, status public.order_status not null default 'pending', currency text not null default 'usd' check (currency = lower(currency) and char_length(currency) = 3), subtotal_amount integer not null check (subtotal_amount >= 0), shipping_amount integer not null check (shipping_amount >= 0), tax_amount integer not null check (tax_amount >= 0), discount_amount integer not null default 0 check (discount_amount >= 0), total_amount integer not null check (total_amount >= 0), stripe_payment_intent_id text unique, idempotency_key uuid not null unique default gen_random_uuid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check ((user_id is not null) <> (guest_session_hash is not null)), check (total_amount = subtotal_amount + shipping_amount + tax_amount - discount_amount));
create table public.order_items (id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete restrict, product_id uuid not null references public.products(id) on delete restrict, variant_id uuid not null references public.product_variants(id) on delete restrict, sku text not null, title text not null, quantity integer not null check (quantity between 1 and 25), unit_amount integer not null check (unit_amount >= 0), line_amount integer generated always as (quantity * unit_amount) stored);
create table public.processed_webhook_events (stripe_event_id text primary key, event_type text not null, processed_at timestamptz not null default now());

create index products_public_catalog_idx on public.products(status, created_at desc);
create index product_variants_product_idx on public.product_variants(product_id, status);
create index orders_user_idx on public.orders(user_id, created_at desc) where user_id is not null;
create index order_items_order_idx on public.order_items(order_id);

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory enable row level security;
alter table public.supplier_mappings enable row level security;
alter table public.price_history enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.processed_webhook_events enable row level security;

grant select on public.products, public.product_variants to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.orders, public.order_items to authenticated;

create policy "Published products are public" on public.products for select to anon, authenticated using (status = 'published');
create policy "Published variants are public" on public.product_variants for select to anon, authenticated using (status = 'published' and exists (select 1 from public.products p where p.id = product_id and p.status = 'published'));
create policy "Users can read own profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "Users can create own profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "Users can update own profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "Customers can read own orders" on public.orders for select to authenticated using ((select auth.uid()) = user_id);
create policy "Customers can read own order items" on public.order_items for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));

comment on table public.orders is 'Server-created authoritative orders. Guest access is mediated server-side; no anon policy is intentional.';
comment on table public.processed_webhook_events is 'Server-only Stripe replay protection. No client grants or policies are intentional.';
