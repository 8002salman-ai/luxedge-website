-- Advanced catalog editing, public product media, authoritative checkout totals,
-- and inventory reservation/finalization.

alter table public.products
  add column seo_title text,
  add column seo_description text,
  add column tax_code text not null default 'txcd_99999999';

alter table public.product_variants
  add column option_values jsonb not null default '{}'::jsonb,
  add column compare_at_amount integer check (compare_at_amount is null or compare_at_amount >= price_amount);

alter table public.orders
  add column stripe_tax_calculation_id text,
  add column stripe_tax_transaction_id text,
  add column reservation_expires_at timestamptz,
  add column reservation_released_at timestamptz;

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null unique,
  public_url text not null,
  alt_text text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images(product_id, sort_order, created_at);
alter table public.product_images enable row level security;
grant select on public.product_images to anon, authenticated;
grant insert, update, delete on public.product_images to authenticated;
create policy "Published product images are public" on public.product_images for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.status = 'published'));
create policy "Admins manage product images" on public.product_images for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, update, delete on public.supplier_mappings to authenticated;
grant select on public.price_history to authenticated;
create policy "Admins manage supplier mappings" on public.supplier_mappings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins read price history" on public.price_history for select to authenticated
  using ((select public.is_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-media', 'product-media', true, 5242880, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Admins upload product media" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-media' and (select public.is_admin()));
create policy "Admins read product media metadata" on storage.objects for select to authenticated
  using (bucket_id = 'product-media' and (select public.is_admin()));
create policy "Admins update product media" on storage.objects for update to authenticated
  using (bucket_id = 'product-media' and (select public.is_admin()))
  with check (bucket_id = 'product-media' and (select public.is_admin()));
create policy "Admins delete product media" on storage.objects for delete to authenticated
  using (bucket_id = 'product-media' and (select public.is_admin()));

create or replace function public.admin_create_product_v2(
  product_title text, product_slug text, product_description text, product_short_description text,
  product_category_id uuid, product_seo_title text, product_seo_description text,
  product_weight_oz numeric, product_tax_code text,
  variant_sku text, variant_title text, variant_price_amount integer, variant_compare_at_amount integer,
  variant_inventory integer, variant_option_values jsonb,
  supplier_code text, supplier_sku text, supplier_landed_cost_amount integer, supplier_channel_approved boolean
)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare created_product_id uuid; created_variant_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if char_length(trim(product_title)) < 2 or product_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'invalid_product'; end if;
  if char_length(trim(variant_sku)) < 2 or variant_price_amount < 0 or variant_inventory < 0 then raise exception 'invalid_variant'; end if;
  if variant_compare_at_amount is not null and variant_compare_at_amount < variant_price_amount then raise exception 'invalid_compare_price'; end if;
  if product_weight_oz is null or product_weight_oz <= 0 or product_weight_oz > 2400 then raise exception 'invalid_weight'; end if;
  if product_tax_code !~ '^txcd_[0-9]{8}$' then raise exception 'invalid_tax_code'; end if;
  if (nullif(trim(supplier_code), '') is null) <> (nullif(trim(supplier_sku), '') is null) then raise exception 'incomplete_supplier'; end if;

  insert into public.products (title, slug, description, short_description, category_id, seo_title, seo_description, weight_oz, tax_code, status)
  values (trim(product_title), product_slug, coalesce(product_description,''), coalesce(product_short_description,''), product_category_id,
    nullif(trim(product_seo_title),''), nullif(trim(product_seo_description),''), product_weight_oz, product_tax_code, 'draft')
  returning id into created_product_id;
  insert into public.product_variants (product_id, sku, title, price_amount, compare_at_amount, option_values, status)
  values (created_product_id, upper(trim(variant_sku)), coalesce(nullif(trim(variant_title),''),'Default'), variant_price_amount, variant_compare_at_amount, coalesce(variant_option_values,'{}'::jsonb), 'draft')
  returning id into created_variant_id;
  insert into public.inventory (variant_id, available) values (created_variant_id, variant_inventory);
  insert into public.price_history (variant_id, price_amount) values (created_variant_id, variant_price_amount);
  if nullif(trim(supplier_code), '') is not null then
    insert into public.supplier_mappings (variant_id, supplier_code, supplier_sku, landed_cost_amount, channel_approved, evidence_checked_at)
    values (created_variant_id, lower(trim(supplier_code)), trim(supplier_sku), supplier_landed_cost_amount, supplier_channel_approved, case when supplier_channel_approved then now() else null end);
  end if;
  return created_product_id;
end; $$;

create or replace function public.admin_update_product_details(
  target_product_id uuid, product_title text, product_slug text, product_description text, product_short_description text,
  product_category_id uuid, product_seo_title text, product_seo_description text,
  product_weight_oz numeric, product_tax_code text, product_status public.catalog_status, product_featured boolean
)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if char_length(trim(product_title)) < 2 or product_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'invalid_product'; end if;
  if product_weight_oz is null or product_weight_oz <= 0 or product_weight_oz > 2400 then raise exception 'invalid_weight'; end if;
  if product_tax_code !~ '^txcd_[0-9]{8}$' then raise exception 'invalid_tax_code'; end if;
  update public.products set title=trim(product_title), slug=product_slug, description=coalesce(product_description,''),
    short_description=coalesce(product_short_description,''), category_id=product_category_id,
    seo_title=nullif(trim(product_seo_title),''), seo_description=nullif(trim(product_seo_description),''),
    weight_oz=product_weight_oz, tax_code=product_tax_code, status=product_status, is_featured=product_featured, updated_at=now()
  where id=target_product_id;
  if not found then raise exception 'product_not_found'; end if;
end; $$;

create or replace function public.admin_add_variant(
  target_product_id uuid, variant_sku text, variant_title text, variant_price_amount integer,
  variant_compare_at_amount integer, variant_inventory integer, variant_option_values jsonb,
  supplier_code text, supplier_sku text, supplier_landed_cost_amount integer, supplier_channel_approved boolean
)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare created_variant_id uuid; product_state public.catalog_status;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select status into product_state from public.products where id=target_product_id;
  if product_state is null then raise exception 'product_not_found'; end if;
  if char_length(trim(variant_sku)) < 2 or variant_price_amount < 0 or variant_inventory < 0 then raise exception 'invalid_variant'; end if;
  if variant_compare_at_amount is not null and variant_compare_at_amount < variant_price_amount then raise exception 'invalid_compare_price'; end if;
  if (nullif(trim(supplier_code), '') is null) <> (nullif(trim(supplier_sku), '') is null) then raise exception 'incomplete_supplier'; end if;
  insert into public.product_variants (product_id,sku,title,price_amount,compare_at_amount,option_values,status)
  values (target_product_id,upper(trim(variant_sku)),coalesce(nullif(trim(variant_title),''),'Default'),variant_price_amount,variant_compare_at_amount,coalesce(variant_option_values,'{}'::jsonb),product_state)
  returning id into created_variant_id;
  insert into public.inventory(variant_id,available) values(created_variant_id,variant_inventory);
  insert into public.price_history(variant_id,price_amount) values(created_variant_id,variant_price_amount);
  if nullif(trim(supplier_code), '') is not null then
    insert into public.supplier_mappings(variant_id,supplier_code,supplier_sku,landed_cost_amount,channel_approved,evidence_checked_at)
    values(created_variant_id,lower(trim(supplier_code)),trim(supplier_sku),supplier_landed_cost_amount,supplier_channel_approved,case when supplier_channel_approved then now() else null end);
  end if;
  return created_variant_id;
end; $$;

create or replace function public.admin_update_variant(
  target_variant_id uuid, variant_sku text, variant_title text, variant_price_amount integer,
  variant_compare_at_amount integer, variant_inventory integer, variant_option_values jsonb, variant_status public.catalog_status,
  supplier_code text, supplier_sku text, supplier_landed_cost_amount integer, supplier_channel_approved boolean
)
returns void language plpgsql security invoker set search_path = '' as $$
declare previous_price integer;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if char_length(trim(variant_sku)) < 2 or variant_price_amount < 0 or variant_inventory < 0 then raise exception 'invalid_variant'; end if;
  if variant_compare_at_amount is not null and variant_compare_at_amount < variant_price_amount then raise exception 'invalid_compare_price'; end if;
  if (nullif(trim(supplier_code), '') is null) <> (nullif(trim(supplier_sku), '') is null) then raise exception 'incomplete_supplier'; end if;
  select price_amount into previous_price from public.product_variants where id=target_variant_id;
  if previous_price is null then raise exception 'variant_not_found'; end if;
  update public.product_variants set sku=upper(trim(variant_sku)), title=coalesce(nullif(trim(variant_title),''),'Default'),
    price_amount=variant_price_amount, compare_at_amount=variant_compare_at_amount, option_values=coalesce(variant_option_values,'{}'::jsonb),
    status=variant_status, updated_at=now() where id=target_variant_id;
  update public.inventory set available=variant_inventory, reserved=least(reserved,variant_inventory), updated_at=now() where variant_id=target_variant_id;
  if previous_price is distinct from variant_price_amount then insert into public.price_history(variant_id,price_amount) values(target_variant_id,variant_price_amount); end if;
  delete from public.supplier_mappings where variant_id=target_variant_id;
  if nullif(trim(supplier_code), '') is not null then
    insert into public.supplier_mappings(variant_id,supplier_code,supplier_sku,landed_cost_amount,channel_approved,evidence_checked_at)
    values(target_variant_id,lower(trim(supplier_code)),trim(supplier_sku),supplier_landed_cost_amount,supplier_channel_approved,case when supplier_channel_approved then now() else null end);
  end if;
end; $$;

grant execute on function public.admin_create_product_v2(text,text,text,text,uuid,text,text,numeric,text,text,text,integer,integer,integer,jsonb,text,text,integer,boolean) to authenticated;
grant execute on function public.admin_update_product_details(uuid,text,text,text,text,uuid,text,text,numeric,text,public.catalog_status,boolean) to authenticated;
grant execute on function public.admin_add_variant(uuid,text,text,integer,integer,integer,jsonb,text,text,integer,boolean) to authenticated;
grant execute on function public.admin_update_variant(uuid,text,text,integer,integer,integer,jsonb,public.catalog_status,text,text,integer,boolean) to authenticated;

drop function if exists public.server_create_order(uuid,text,text,text,jsonb,jsonb);
create function public.server_create_order(
  p_user_id uuid, p_guest_session_hash text, p_email text, p_phone text, p_shipping_address jsonb, p_items jsonb,
  p_shipping_amount integer, p_tax_amount integer, p_shippo_rate_id text, p_shipping_carrier text, p_shipping_service text, p_stripe_tax_calculation_id text
)
returns table (id uuid, order_number bigint, subtotal_amount integer, shipping_amount integer, tax_amount integer, total_amount integer, currency text)
language plpgsql security definer set search_path = '' as $$
declare requested record; catalog record; created_order_id uuid; created_order_number bigint; calculated_subtotal bigint:=0; order_currency text:=null;
begin
  if (p_user_id is null) = (nullif(p_guest_session_hash,'') is null) then raise exception 'invalid_customer_identity'; end if;
  if p_email is null or char_length(trim(p_email))>254 or trim(p_email)!~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'invalid_email'; end if;
  if jsonb_typeof(p_shipping_address)<>'object' or char_length(trim(coalesce(p_shipping_address->>'fullName',''))) not between 2 and 120
    or char_length(trim(coalesce(p_shipping_address->>'street1',''))) not between 2 and 160 or char_length(trim(coalesce(p_shipping_address->>'city',''))) not between 2 and 100
    or char_length(trim(coalesce(p_shipping_address->>'state',''))) not between 2 and 80 or char_length(trim(coalesce(p_shipping_address->>'postalCode',''))) not between 3 and 20
    or upper(coalesce(p_shipping_address->>'country',''))<>'US' then raise exception 'invalid_shipping_address'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 25 then raise exception 'invalid_items'; end if;
  if p_shipping_amount<0 or p_tax_amount<0 or nullif(p_shippo_rate_id,'') is null then raise exception 'invalid_checkout_totals'; end if;
  for requested in select (entry->>'variantId')::uuid variant_id,sum((entry->>'quantity')::integer)::integer quantity from jsonb_array_elements(p_items) entry group by (entry->>'variantId')::uuid loop
    if requested.quantity not between 1 and 25 then raise exception 'invalid_quantity'; end if;
    select v.id variant_id,v.product_id,v.sku,v.title variant_title,v.price_amount,p.title product_title,p.currency,i.available,i.reserved into catalog
    from public.product_variants v join public.products p on p.id=v.product_id join public.inventory i on i.variant_id=v.id
    where v.id=requested.variant_id and v.status='published' and p.status='published' for update of i;
    if catalog.variant_id is null then raise exception 'product_unavailable'; end if;
    if catalog.available-catalog.reserved<requested.quantity then raise exception 'insufficient_inventory'; end if;
    if order_currency is null then order_currency:=catalog.currency; elsif order_currency<>catalog.currency then raise exception 'mixed_currency_order'; end if;
    calculated_subtotal:=calculated_subtotal+(catalog.price_amount::bigint*requested.quantity::bigint);
    if calculated_subtotal>2147483647 then raise exception 'order_total_too_large'; end if;
  end loop;
  insert into public.orders as new_order(user_id,guest_session_hash,email,phone,shipping_address,billing_address,status,payment_status,currency,subtotal_amount,shipping_amount,tax_amount,discount_amount,total_amount,shippo_rate_id,shipping_carrier,shipping_service,stripe_tax_calculation_id,reservation_expires_at)
  values(p_user_id,nullif(p_guest_session_hash,''),lower(trim(p_email)),nullif(trim(p_phone),''),p_shipping_address,p_shipping_address,'pending','pending',order_currency,calculated_subtotal::integer,p_shipping_amount,p_tax_amount,0,calculated_subtotal::integer+p_shipping_amount+p_tax_amount,p_shippo_rate_id,nullif(p_shipping_carrier,''),nullif(p_shipping_service,''),nullif(p_stripe_tax_calculation_id,''),now()+interval '30 minutes')
  returning new_order.id,new_order.order_number into created_order_id,created_order_number;
  for requested in select (entry->>'variantId')::uuid variant_id,sum((entry->>'quantity')::integer)::integer quantity from jsonb_array_elements(p_items) entry group by (entry->>'variantId')::uuid loop
    select v.product_id,v.sku,v.title variant_title,v.price_amount,p.title product_title into catalog from public.product_variants v join public.products p on p.id=v.product_id where v.id=requested.variant_id;
    insert into public.order_items(order_id,product_id,variant_id,sku,title,quantity,unit_amount) values(created_order_id,catalog.product_id,requested.variant_id,catalog.sku,case when catalog.variant_title='Default' then catalog.product_title else catalog.product_title||' - '||catalog.variant_title end,requested.quantity,catalog.price_amount);
    update public.inventory set reserved=reserved+requested.quantity,updated_at=now() where variant_id=requested.variant_id;
  end loop;
  return query select created_order_id,created_order_number,calculated_subtotal::integer,p_shipping_amount,p_tax_amount,(calculated_subtotal::integer+p_shipping_amount+p_tax_amount),order_currency;
end; $$;

create or replace function public.server_finalize_paid_order(p_order_id uuid,p_payment_intent_id text,p_amount integer,p_currency text)
returns boolean language plpgsql security definer set search_path='' as $$
declare target record; line record;
begin
  select id,total_amount,currency,stripe_payment_intent_id,payment_status,reservation_released_at into target from public.orders where id=p_order_id for update;
  if target.id is null or target.stripe_payment_intent_id<>p_payment_intent_id or target.total_amount<>p_amount or target.currency<>p_currency then raise exception 'payment_mismatch'; end if;
  if target.payment_status='paid' then return true; end if;
  if target.reservation_released_at is not null then raise exception 'reservation_released'; end if;
  for line in select variant_id,quantity from public.order_items where order_id=p_order_id loop
    update public.inventory set available=available-line.quantity,reserved=reserved-line.quantity,updated_at=now()
    where variant_id=line.variant_id and available>=line.quantity and reserved>=line.quantity;
    if not found then raise exception 'inventory_finalize_failed'; end if;
  end loop;
  update public.orders set payment_status='paid',status='paid',updated_at=now() where id=p_order_id;
  return true;
end; $$;

create or replace function public.server_release_order_reservation(p_order_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare target record; line record;
begin
  select id,payment_status,reservation_released_at into target from public.orders where id=p_order_id for update;
  if target.id is null then return false; end if;
  if target.payment_status='paid' then raise exception 'paid_order'; end if;
  if target.reservation_released_at is not null then return true; end if;
  for line in select variant_id,quantity from public.order_items where order_id=p_order_id loop
    update public.inventory set reserved=greatest(0,reserved-line.quantity),updated_at=now() where variant_id=line.variant_id;
  end loop;
  update public.orders set reservation_released_at=now(),status='cancelled',updated_at=now() where id=p_order_id;
  return true;
end; $$;

revoke all on function public.server_create_order(uuid,text,text,text,jsonb,jsonb,integer,integer,text,text,text,text) from public,anon,authenticated;
revoke all on function public.server_finalize_paid_order(uuid,text,integer,text) from public,anon,authenticated;
revoke all on function public.server_release_order_reservation(uuid) from public,anon,authenticated;
grant execute on function public.server_create_order(uuid,text,text,text,jsonb,jsonb,integer,integer,text,text,text,text) to service_role;
grant execute on function public.server_finalize_paid_order(uuid,text,integer,text) to service_role;
grant execute on function public.server_release_order_reservation(uuid) to service_role;

create or replace function public.admin_update_order_fulfillment(target_order_id uuid,next_status public.order_status,next_carrier text default null,next_tracking_number text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare current_payment_status public.payment_status; line record; released timestamptz;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if next_status not in ('pending','processing','shipped','delivered','cancelled') then raise exception 'invalid_fulfillment_status'; end if;
  select payment_status,reservation_released_at into current_payment_status,released from public.orders where id=target_order_id for update;
  if current_payment_status is null then raise exception 'order_not_found'; end if;
  if next_status in ('processing','shipped','delivered') and current_payment_status<>'paid' then raise exception 'payment_required'; end if;
  if next_status in ('shipped','delivered') and (nullif(trim(next_carrier),'') is null or nullif(trim(next_tracking_number),'') is null) then raise exception 'tracking_required'; end if;
  if next_status='cancelled' and current_payment_status<>'paid' and released is null then
    for line in select variant_id,quantity from public.order_items where order_id=target_order_id loop update public.inventory set reserved=greatest(0,reserved-line.quantity),updated_at=now() where variant_id=line.variant_id; end loop;
  end if;
  update public.orders set status=next_status,shipping_carrier=nullif(trim(next_carrier),''),tracking_number=nullif(trim(next_tracking_number),''),
    reservation_released_at=case when next_status='cancelled' and current_payment_status<>'paid' then coalesce(reservation_released_at,now()) else reservation_released_at end,
    shipped_at=case when next_status='shipped' and shipped_at is null then now() else shipped_at end,updated_at=now() where id=target_order_id;
end; $$;
