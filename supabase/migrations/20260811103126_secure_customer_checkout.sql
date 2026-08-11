-- Atomic, server-only order creation. The browser never supplies prices, SKU,
-- product titles, currency, totals, or a customer identity accepted as trusted.
create or replace function public.server_create_order(
  p_user_id uuid,
  p_guest_session_hash text,
  p_email text,
  p_phone text,
  p_shipping_address jsonb,
  p_items jsonb
)
returns table (id uuid, order_number bigint, subtotal_amount integer, shipping_amount integer, tax_amount integer, total_amount integer, currency text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested record;
  catalog record;
  created_order_id uuid;
  created_order_number bigint;
  calculated_subtotal bigint := 0;
  order_currency text := null;
begin
  if (p_user_id is null) = (nullif(p_guest_session_hash, '') is null) then
    raise exception 'invalid_customer_identity';
  end if;
  if p_email is null or char_length(trim(p_email)) > 254 or trim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'invalid_email';
  end if;
  if jsonb_typeof(p_shipping_address) <> 'object'
    or char_length(trim(coalesce(p_shipping_address ->> 'fullName', ''))) not between 2 and 120
    or char_length(trim(coalesce(p_shipping_address ->> 'street1', ''))) not between 2 and 160
    or char_length(trim(coalesce(p_shipping_address ->> 'city', ''))) not between 2 and 100
    or char_length(trim(coalesce(p_shipping_address ->> 'state', ''))) not between 2 and 80
    or char_length(trim(coalesce(p_shipping_address ->> 'postalCode', ''))) not between 3 and 20
    or upper(coalesce(p_shipping_address ->> 'country', '')) <> 'US' then
    raise exception 'invalid_shipping_address';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 25 then
    raise exception 'invalid_items';
  end if;

  for requested in
    select (entry ->> 'variantId')::uuid as variant_id, sum((entry ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) entry
    group by (entry ->> 'variantId')::uuid
  loop
    if requested.quantity not between 1 and 25 then raise exception 'invalid_quantity'; end if;
    select v.id as variant_id, v.product_id, v.sku, v.title as variant_title, v.price_amount,
      p.title as product_title, p.currency, i.available, i.reserved
    into catalog
    from public.product_variants v
    join public.products p on p.id = v.product_id
    join public.inventory i on i.variant_id = v.id
    where v.id = requested.variant_id and v.status = 'published' and p.status = 'published'
    for share of v, p, i;
    if catalog.variant_id is null then raise exception 'product_unavailable'; end if;
    if catalog.available - catalog.reserved < requested.quantity then raise exception 'insufficient_inventory'; end if;
    if order_currency is null then order_currency := catalog.currency;
    elsif order_currency <> catalog.currency then raise exception 'mixed_currency_order';
    end if;
    calculated_subtotal := calculated_subtotal + (catalog.price_amount::bigint * requested.quantity::bigint);
    if calculated_subtotal > 2147483647 then raise exception 'order_total_too_large'; end if;
  end loop;

  insert into public.orders (user_id, guest_session_hash, email, phone, shipping_address, billing_address, status, payment_status, currency, subtotal_amount, shipping_amount, tax_amount, discount_amount, total_amount)
  values (p_user_id, nullif(p_guest_session_hash, ''), lower(trim(p_email)), nullif(trim(p_phone), ''), p_shipping_address, p_shipping_address, 'pending', 'pending', order_currency, calculated_subtotal::integer, 0, 0, 0, calculated_subtotal::integer)
  returning orders.id, orders.order_number into created_order_id, created_order_number;

  for requested in
    select (entry ->> 'variantId')::uuid as variant_id, sum((entry ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) entry
    group by (entry ->> 'variantId')::uuid
  loop
    select v.product_id, v.sku, v.title as variant_title, v.price_amount, p.title as product_title
    into catalog from public.product_variants v join public.products p on p.id = v.product_id where v.id = requested.variant_id;
    insert into public.order_items (order_id, product_id, variant_id, sku, title, quantity, unit_amount)
    values (created_order_id, catalog.product_id, requested.variant_id, catalog.sku,
      case when catalog.variant_title = 'Default' then catalog.product_title else catalog.product_title || ' — ' || catalog.variant_title end,
      requested.quantity, catalog.price_amount);
  end loop;

  return query select created_order_id, created_order_number, calculated_subtotal::integer, 0, 0, calculated_subtotal::integer, order_currency;
end;
$$;

revoke all on function public.server_create_order(uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.server_create_order(uuid, text, text, text, jsonb, jsonb) to service_role;
comment on function public.server_create_order is 'Server-only atomic checkout. Catalog prices and totals are always reloaded inside Postgres.';
