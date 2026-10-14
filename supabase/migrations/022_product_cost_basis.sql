-- ---------------------------------------------------------------------------
-- 022_product_cost_basis.sql
-- Bug: profit showed the full sale amount because COGS was 0 whenever stock was
-- added without a priced purchase bill (opening stock / stock adjustment) - the
-- inventory weighted-average cost stayed at 0. The product's "buying price"
-- (product_price_history, purchase) was never used as a cost basis.
--
-- Fix, three parts:
--   1. product_last_purchase_cost(): the product's latest purchase price,
--      expressed per base unit (defensive: falls back to the raw price).
--   2. apply_stock_movement(): incoming stock with no known cost (adjustments,
--      opening stock, counts) is valued at that purchase price.
--   3. set_product_price(): setting a buying price seeds avg_cost while there
--      is no stock yet.
-- Existing zero-cost balances are backfilled at the end.
-- ---------------------------------------------------------------------------

create or replace function public.product_last_purchase_cost(p_product_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_price numeric;
  v_unit  text;
  v_cost  numeric;
begin
  select h.price, h.unit into v_price, v_unit
    from public.product_price_history h
   where h.product_id = p_product_id
     and h.price_type = 'purchase'
   order by h.effective_at desc, h.id desc
   limit 1;

  if v_price is null then
    return null;
  end if;

  begin
    v_cost := round(v_price / public.resolve_unit_factor(p_product_id, v_unit), 6);
  exception when others then
    v_cost := v_price;  -- conversion unknown: assume the price is per base unit
  end;

  return v_cost;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_stock_movement (re-created): incoming movements that carry no cost fall
-- back to the product's latest purchase price. Purchases keep their own cost.
-- ---------------------------------------------------------------------------
create or replace function public.apply_stock_movement(
  p_business_id      uuid,
  p_product_id       uuid,
  p_movement_type    text,
  p_qty_change       numeric,
  p_unit_cost        numeric,
  p_source_type      text,
  p_source_id        uuid,
  p_counterparty_type text default null,
  p_counterparty_id   uuid default null,
  p_notes            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_qty numeric := 0;
  v_avg numeric := 0;
  v_new_qty numeric;
  v_new_avg numeric;
  v_unit_cost numeric;
  v_line_cost numeric;
  v_cost_in numeric;
  v_name text;
  v_movement_id uuid;
begin
  if p_qty_change is null or p_qty_change = 0 then
    raise exception 'INVALID_QTY: movement quantity must be non-zero';
  end if;

  insert into public.inventory_balances (business_id, product_id, qty, avg_cost)
  values (p_business_id, p_product_id, 0, 0)
  on conflict (business_id, product_id) do nothing;

  select b.qty, b.avg_cost into v_qty, v_avg
    from public.inventory_balances b
   where b.business_id = p_business_id and b.product_id = p_product_id
     for update;

  if v_qty is null then
    raise exception 'BALANCE_LOCK_FAILED: product %', p_product_id;
  end if;

  if p_qty_change > 0 then
    -- Value incoming stock: the supplied cost, else the product's purchase price.
    v_cost_in := coalesce(p_unit_cost, 0);
    if v_cost_in = 0 and p_movement_type <> 'purchase' then
      v_cost_in := coalesce(public.product_last_purchase_cost(p_product_id), 0);
    end if;

    v_new_qty := v_qty + p_qty_change;
    if v_new_qty = 0 or v_qty = 0 then
      v_new_avg := v_cost_in;
    else
      v_new_avg := round((v_qty * v_avg + p_qty_change * v_cost_in) / v_new_qty, 6);
    end if;
    v_unit_cost := v_cost_in;
    v_line_cost := round(p_qty_change * v_cost_in, 2);
  else
    v_new_qty := v_qty + p_qty_change;
    if v_new_qty < 0 then
      select name into v_name from public.products where id = p_product_id;
      raise exception 'INSUFFICIENT_STOCK: % (available %, requested %)',
        coalesce(v_name, p_product_id::text), v_qty, -p_qty_change;
    end if;
    v_new_avg := v_avg;
    v_unit_cost := v_avg;
    v_line_cost := round(-p_qty_change * v_avg, 2);
  end if;

  insert into public.stock_movements (
    business_id, product_id, movement_type, qty_change, qty_after,
    unit_cost, source_type, source_id, counterparty_type, counterparty_id,
    user_id, notes
  ) values (
    p_business_id, p_product_id, p_movement_type, p_qty_change, v_new_qty,
    v_unit_cost, p_source_type, p_source_id, p_counterparty_type, p_counterparty_id,
    public.app_user_id(), p_notes
  ) returning id into v_movement_id;

  update public.inventory_balances
     set qty = v_new_qty,
         avg_cost = v_new_avg,
         last_movement_at = now()
   where business_id = p_business_id and product_id = p_product_id;

  return jsonb_build_object(
    'movement_id', v_movement_id,
    'qty_after', v_new_qty,
    'avg_cost', v_new_avg,
    'unit_cost', v_unit_cost,
    'line_cost', v_line_cost
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- set_product_price (re-created): a purchase price also seeds the cost basis
-- while the product has no stock, so profit is right without a purchase bill.
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
  v_cost        numeric;
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

  if p_price_type = 'purchase' then
    v_cost := public.product_last_purchase_cost(p_product_id);
    if v_cost is not null then
      insert into public.inventory_balances (business_id, product_id, qty, avg_cost)
      values (v_business_id, p_product_id, 0, v_cost)
      on conflict (business_id, product_id)
        do update set avg_cost = excluded.avg_cost
        where public.inventory_balances.qty = 0;
    end if;
  end if;
end;
$$;

grant execute on function public.set_product_price(uuid, text, text, numeric) to authenticated;

-- Backfill: value any existing zero-cost balances at the product's purchase price.
update public.inventory_balances b
   set avg_cost = public.product_last_purchase_cost(b.product_id)
 where b.avg_cost = 0
   and public.product_last_purchase_cost(b.product_id) is not null;
