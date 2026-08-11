-- Secure auth/admin foundation. Roles are assigned through auth.users.raw_app_meta_data
-- by a trusted server only; public signup metadata can never promote a user.
create type public.user_role as enum ('customer', 'admin');
create type public.payment_status as enum ('pending', 'paid', 'failed', 'refunded');

alter table public.profiles
  add column email text,
  add column phone text,
  add column role public.user_role not null default 'customer';

create unique index profiles_email_unique_idx on public.profiles (lower(email)) where email is not null;

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Home',
  full_name text not null,
  phone text,
  street1 text not null,
  street2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null default 'US',
  is_default_shipping boolean not null default false,
  is_default_billing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_default_shipping_per_user on public.addresses(user_id) where is_default_shipping;
create unique index one_default_billing_per_user on public.addresses(user_id) where is_default_billing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    case when new.raw_app_meta_data ->> 'role' = 'admin' then 'admin'::public.user_role else 'customer'::public.user_role end
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    role = excluded.role,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, raw_app_meta_data on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'), false);
$$;

-- Customers may edit profile fields, never their role.
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile fields"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id and role = 'customer');
drop policy if exists "Users can create own profile" on public.profiles;
create policy "Users can create customer profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id and role = 'customer');

create policy "Admins can read all profiles"
  on public.profiles for select to authenticated using ((select public.is_admin()));
create policy "Admins can update profiles"
  on public.profiles for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  image_url text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
  add column category_id uuid references public.categories(id) on delete set null,
  add column short_description text not null default '',
  add column image_url text,
  add column compare_at_amount integer check (compare_at_amount is null or compare_at_amount >= 0),
  add column is_featured boolean not null default false,
  add column weight_oz numeric(10,2) check (weight_oz is null or weight_oz > 0);

alter table public.orders
  add column payment_status public.payment_status not null default 'pending',
  add column phone text,
  add column shipping_address jsonb,
  add column billing_address jsonb,
  add column shippo_rate_id text,
  add column shippo_transaction_id text,
  add column shipping_carrier text,
  add column shipping_service text,
  add column tracking_number text,
  add column label_url text,
  add column shipped_at timestamptz;

alter table public.categories enable row level security;
alter table public.addresses enable row level security;
grant select on public.categories to anon, authenticated;
grant select, insert, update, delete on public.addresses to authenticated;
create policy "Active categories are public" on public.categories for select to anon, authenticated using (is_active);
create policy "Customers read own addresses" on public.addresses for select to authenticated using ((select auth.uid()) = user_id);
create policy "Customers create own addresses" on public.addresses for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Customers update own addresses" on public.addresses for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Customers delete own addresses" on public.addresses for delete to authenticated using ((select auth.uid()) = user_id);
create policy "Admins manage addresses" on public.addresses for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "Admins manage categories" on public.categories for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins manage products" on public.products for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins manage variants" on public.product_variants for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins manage inventory" on public.inventory for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins read orders" on public.orders for select to authenticated using ((select public.is_admin()));
create policy "Admins update orders" on public.orders for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins read order items" on public.order_items for select to authenticated using ((select public.is_admin()));

grant insert, update, delete on public.categories, public.products, public.product_variants, public.inventory to authenticated;
grant select, update on public.orders, public.order_items to authenticated;

create or replace function public.admin_create_product(
  product_title text,
  product_slug text,
  product_sku text,
  product_price_amount integer,
  product_inventory integer default 0,
  product_description text default '',
  product_image_url text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  created_product_id uuid;
  created_variant_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if char_length(trim(product_title)) < 2 then raise exception 'title_too_short'; end if;
  if product_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'invalid_slug'; end if;
  if char_length(trim(product_sku)) < 2 then raise exception 'invalid_sku'; end if;
  if product_price_amount < 0 then raise exception 'invalid_price'; end if;
  if product_inventory < 0 then raise exception 'invalid_inventory'; end if;

  insert into public.products (title, slug, description, image_url, status)
  values (trim(product_title), product_slug, coalesce(product_description, ''), nullif(product_image_url, ''), 'draft')
  returning id into created_product_id;

  insert into public.product_variants (product_id, sku, title, price_amount, status)
  values (created_product_id, trim(product_sku), 'Default', product_price_amount, 'draft')
  returning id into created_variant_id;

  insert into public.inventory (variant_id, available) values (created_variant_id, product_inventory);
  return created_product_id;
end;
$$;

grant execute on function public.admin_create_product(text, text, text, integer, integer, text, text) to authenticated;

comment on function public.is_admin is 'Authorization is derived from trusted Supabase app_metadata, never user_metadata.';
