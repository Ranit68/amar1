-- ---------------------------------------------------------------------------
-- 021_product_prices.sql
-- Allow setting a product's purchase / selling price directly from the catalog
-- (e.g. when creating a product). Prices live in the append-only
-- product_price_history table, which has no client write policy, so the write
-- goes through this permission-gated security definer RPC.
-- ---------------------------------------------------------------------------

create or replace function public.set_product_price(
  p_product_id uuid,
  p_price_type text,
  p_unit       text,
  p_price      numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
  v_unit        text;
begin
  if p_price_type not in ('purchase', 'sale') then
    raise exception 'INVALID_PRICE_TYPE: %', p_price_type;
  end if;

  if p_price is null or p_price < 0 then
    raise exception 'INVALID_PRICE: price must be >= 0';
  end if;

  select business_id into v_business_id
    from public.products
   where id = p_product_id;

  if v_business_id is null then
    raise exception 'UNKNOWN_PRODUCT: %', p_product_id;
  end if;

  perform public.app_assert_can(v_business_id, 'products.write');

  v_unit := coalesce(nullif(public.norm_text(p_unit), ''), 'piece');

  insert into public.product_price_history
    (business_id, product_id, price_type, unit, price, source_ref, created_by)
  values
    (v_business_id, p_product_id, p_price_type, v_unit, p_price, 'manual', public.app_user_id());
end;
$$;

grant execute on function public.set_product_price(uuid, text, text, numeric) to authenticated;
