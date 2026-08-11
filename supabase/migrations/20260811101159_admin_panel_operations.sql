create or replace function public.admin_update_product(target_product_id uuid, next_status public.catalog_status, next_price_amount integer, next_inventory integer)
returns void language plpgsql security invoker set search_path = public as $$
declare target_variant_id uuid; current_price integer;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if next_price_amount < 0 or next_inventory < 0 then raise exception 'invalid_values'; end if;
  select id, price_amount into target_variant_id, current_price from public.product_variants where product_id = target_product_id order by created_at limit 1;
  if target_variant_id is null then raise exception 'variant_not_found'; end if;
  update public.products set status = next_status, updated_at = now() where id = target_product_id;
  update public.product_variants set status = next_status, price_amount = next_price_amount, updated_at = now() where id = target_variant_id;
  update public.inventory set available = next_inventory, reserved = least(reserved, next_inventory), updated_at = now() where variant_id = target_variant_id;
  if current_price is distinct from next_price_amount then insert into public.price_history (variant_id, price_amount) values (target_variant_id, next_price_amount); end if;
end; $$;

create or replace function public.admin_update_order_fulfillment(target_order_id uuid, next_status public.order_status, next_carrier text default null, next_tracking_number text default null)
returns void language plpgsql security invoker set search_path = public as $$
declare current_payment_status public.payment_status;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if next_status not in ('pending', 'processing', 'shipped', 'delivered', 'cancelled') then raise exception 'invalid_fulfillment_status'; end if;
  select payment_status into current_payment_status from public.orders where id = target_order_id;
  if current_payment_status is null then raise exception 'order_not_found'; end if;
  if next_status in ('processing', 'shipped', 'delivered') and current_payment_status <> 'paid' then raise exception 'payment_required'; end if;
  if next_status in ('shipped', 'delivered') and (nullif(trim(next_carrier), '') is null or nullif(trim(next_tracking_number), '') is null) then raise exception 'tracking_required'; end if;
  update public.orders set status = next_status, shipping_carrier = nullif(trim(next_carrier), ''), tracking_number = nullif(trim(next_tracking_number), ''), shipped_at = case when next_status = 'shipped' and shipped_at is null then now() else shipped_at end, updated_at = now() where id = target_order_id;
end; $$;

grant execute on function public.admin_update_product(uuid, public.catalog_status, integer, integer) to authenticated;
grant execute on function public.admin_update_order_fulfillment(uuid, public.order_status, text, text) to authenticated;
