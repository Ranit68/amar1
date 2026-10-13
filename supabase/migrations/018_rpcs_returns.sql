-- ---------------------------------------------------------------------------
-- 018_rpcs_returns.sql
-- Sales and purchase returns.
--
-- Accounting model (documented, intentional):
--   * A sales return brings goods back into stock. Re-entry cost is the
--     original sale's unit_cost when the original bill + product match, else
--     the product's current weighted-average cost.
--   * refund_mode = 'credit' reduces the hawker receivable (ledger credit).
--     refund_mode = 'cash' refunds the drawer and posts NO ledger entry
--     (the return value is settled in cash immediately).
--   * A purchase return removes goods at the current weighted-average cost and,
--     in 'credit' mode, reduces the supplier payable (ledger credit). In 'cash'
--     mode the supplier refunds cash and no ledger entry is posted.
--
-- Posted bills are never mutated; returns are separate documents.
-- ---------------------------------------------------------------------------

create or replace function public.post_sales_return(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_hawker   uuid := (p_payload->>'hawker_id')::uuid;
  v_bill     uuid := nullif(p_payload->>'original_bill_id', '')::uuid;
  v_mode     text := coalesce(p_payload->>'refund_mode', 'credit');
  v_date     date := coalesce(nullif(p_payload->>'return_date', '')::date, current_date);
  v_idem     text := nullif(coalesce(p_payload->>'idempotency_key', ''), '');
  v_items    jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  v_return   uuid;
  v_total    numeric := 0;
  v_lines    jsonb := '[]'::jsonb;
  v_existing uuid;
  v_account  record;
  e          record;
  v_factor   numeric;
  v_qty      numeric;
  v_qty_base numeric;
  v_price    numeric;
  v_discount numeric;
  v_line     numeric;
  v_cost     numeric;
  v_avg      numeric;
begin
  perform public.app_assert_can(v_business, 'sales.post');

  if jsonb_array_length(v_items) = 0 then
    raise exception 'INVALID_PAYLOAD: at least one item is required';
  end if;
  if v_mode not in ('credit', 'cash') then
    raise exception 'INVALID_REFUND_MODE: %', v_mode;
  end if;

  perform 1 from public.hawkers
   where id = v_hawker and business_id = v_business for update;
  if not found then
    raise exception 'UNKNOWN_HAWKER: %', v_hawker;
  end if;

  if v_idem is not null then
    select id into v_existing from public.sales_returns
     where business_id = v_business and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('return_id', v_existing, 'idempotency_hit', true);
    end if;
  end if;

  if v_mode = 'cash' then
    select * into v_account from public.cash_accounts
     where id = nullif(p_payload->>'cash_account_id', '')::uuid
       and business_id = v_business and is_active;
    if v_account is null then
      raise exception 'UNKNOWN_CASH_ACCOUNT: %', p_payload->>'cash_account_id';
    end if;
  end if;

  -- First pass: price the return lines.
  for e in select elem from jsonb_array_elements(v_items) as t(elem)
  loop
    v_qty := (e.elem->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_QTY: %', e.elem->>'qty';
    end if;

    v_factor := public.resolve_unit_factor((e.elem->>'product_id')::uuid, e.elem->>'unit');
    v_qty_base := round(v_qty * v_factor, 3);

    v_price := nullif(e.elem->>'unit_price', '')::numeric;
    if v_price is null and v_bill is not null then
      select si.unit_price into v_price from public.sales_items si
       where si.bill_id = v_bill and si.product_id = (e.elem->>'product_id')::uuid
       limit 1;
    end if;
    v_price := coalesce(v_price, 0);

    v_discount := coalesce(nullif(e.elem->>'discount', '')::numeric, 0);
    v_line := round(v_qty * v_price - v_discount, 2);
    if v_line < 0 then
      raise exception 'INVALID_PAYLOAD: negative line total';
    end if;

    v_cost := null;
    if v_bill is not null then
      select si.unit_cost into v_cost from public.sales_items si
       where si.bill_id = v_bill and si.product_id = (e.elem->>'product_id')::uuid
       limit 1;
    end if;
    if v_cost is null then
      select avg_cost into v_avg from public.inventory_balances
       where business_id = v_business and product_id = (e.elem->>'product_id')::uuid;
      v_cost := coalesce(v_avg, 0);
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', e.elem->>'product_id',
      'raw_name', coalesce(e.elem->>'raw_name',
        (select name from public.products where id = (e.elem->>'product_id')::uuid)),
      'qty', v_qty,
      'unit', e.elem->>'unit',
      'qty_base', v_qty_base,
      'unit_price', v_price,
      'discount', v_discount,
      'line_total', v_line,
      'unit_cost', v_cost
    ));
    v_total := v_total + v_line;
  end loop;

  insert into public.sales_returns
    (business_id, hawker_id, original_bill_id, return_date, refund_mode,
     total, items, notes, idempotency_key, created_by)
  values
    (v_business, v_hawker, v_bill, v_date, v_mode,
     v_total, v_lines, p_payload->>'notes', v_idem, public.app_user_id())
  returning id into v_return;

  -- Second pass: put stock back (guarded against duplicate movement rows).
  for e in select elem from jsonb_array_elements(v_lines) as t(elem)
  loop
    perform public.apply_stock_movement(
      v_business, (e.elem->>'product_id')::uuid, 'sale_return',
      (e.elem->>'qty_base')::numeric, (e.elem->>'unit_cost')::numeric,
      'sales_returns', v_return, 'hawker', v_hawker, p_payload->>'notes');
  end loop;

  if v_mode = 'credit' then
    insert into public.hawker_transactions
      (business_id, hawker_id, entry_type, entry_date, ref_type, ref_id,
       debit, credit, balance_after, notes, created_by)
    values
      (v_business, v_hawker, 'return', v_date, 'sales_returns', v_return,
       0, v_total, 0, 'Sales return', public.app_user_id());
    perform public.recalc_hawker_ledger(v_hawker);
  else
    insert into public.cash_transactions
      (business_id, cash_account_id, direction, amount, category, ref_type,
       ref_id, notes, created_by, txn_at)
    values
      (v_business, v_account.id, 'out', v_total, 'other_out', 'sales_returns',
       v_return, p_payload->>'notes', public.app_user_id(),
       ((v_date + time '12:00') at time zone 'Asia/Kolkata'));
    update public.cash_accounts
       set current_balance = current_balance - v_total
     where id = v_account.id;
  end if;

  perform public.write_audit(v_business, 'sale.returned', 'sales_returns', v_return, null,
    jsonb_build_object('total', v_total, 'refund_mode', v_mode, 'hawker_id', v_hawker));

  return jsonb_build_object('return_id', v_return, 'total', v_total, 'idempotency_hit', false);
end;
$$;

create or replace function public.post_purchase_return(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_supplier uuid := (p_payload->>'supplier_id')::uuid;
  v_bill     uuid := nullif(p_payload->>'original_bill_id', '')::uuid;
  v_mode     text := coalesce(p_payload->>'refund_mode', 'credit');
  v_date     date := coalesce(nullif(p_payload->>'return_date', '')::date, current_date);
  v_idem     text := nullif(coalesce(p_payload->>'idempotency_key', ''), '');
  v_items    jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  v_return   uuid;
  v_total    numeric := 0;
  v_lines    jsonb := '[]'::jsonb;
  v_existing uuid;
  v_account  record;
  e          record;
  v_factor   numeric;
  v_qty      numeric;
  v_qty_base numeric;
  v_cost     numeric;
  v_avg      numeric;
  v_line     numeric;
begin
  perform public.app_assert_can(v_business, 'purchases.post');

  if jsonb_array_length(v_items) = 0 then
    raise exception 'INVALID_PAYLOAD: at least one item is required';
  end if;
  if v_mode not in ('credit', 'cash') then
    raise exception 'INVALID_REFUND_MODE: %', v_mode;
  end if;

  perform 1 from public.suppliers
   where id = v_supplier and business_id = v_business for update;
  if not found then
    raise exception 'UNKNOWN_SUPPLIER: %', v_supplier;
  end if;

  if v_idem is not null then
    select id into v_existing from public.purchase_returns
     where business_id = v_business and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('return_id', v_existing, 'idempotency_hit', true);
    end if;
  end if;

  if v_mode = 'cash' then
    select * into v_account from public.cash_accounts
     where id = nullif(p_payload->>'cash_account_id', '')::uuid
       and business_id = v_business and is_active;
    if v_account is null then
      raise exception 'UNKNOWN_CASH_ACCOUNT: %', p_payload->>'cash_account_id';
    end if;
  end if;

  for e in select elem from jsonb_array_elements(v_items) as t(elem)
  loop
    v_qty := (e.elem->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_QTY: %', e.elem->>'qty';
    end if;

    v_factor := public.resolve_unit_factor((e.elem->>'product_id')::uuid, e.elem->>'unit');
    v_qty_base := round(v_qty * v_factor, 3);

    v_cost := nullif(e.elem->>'unit_cost', '')::numeric;
    if v_cost is null and v_bill is not null then
      select pi.cost_per_base_unit into v_cost from public.purchase_items pi
       where pi.bill_id = v_bill and pi.product_id = (e.elem->>'product_id')::uuid
       limit 1;
    end if;
    if v_cost is null then
      select avg_cost into v_avg from public.inventory_balances
       where business_id = v_business and product_id = (e.elem->>'product_id')::uuid;
      v_cost := coalesce(v_avg, 0);
    end if;

    v_line := round(v_qty_base * v_cost, 2);

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', e.elem->>'product_id',
      'raw_name', coalesce(e.elem->>'raw_name',
        (select name from public.products where id = (e.elem->>'product_id')::uuid)),
      'qty', v_qty,
      'unit', e.elem->>'unit',
      'qty_base', v_qty_base,
      'unit_cost', v_cost,
      'line_total', v_line
    ));
    v_total := v_total + v_line;
  end loop;

  insert into public.purchase_returns
    (business_id, supplier_id, original_bill_id, return_date, refund_mode,
     total, items, notes, idempotency_key, created_by)
  values
    (v_business, v_supplier, v_bill, v_date, v_mode,
     v_total, v_lines, p_payload->>'notes', v_idem, public.app_user_id())
  returning id into v_return;

  -- Goods physically leave stock at the current weighted-average cost.
  for e in select elem from jsonb_array_elements(v_lines) as t(elem)
  loop
    perform public.apply_stock_movement(
      v_business, (e.elem->>'product_id')::uuid, 'purchase_return',
      -(e.elem->>'qty_base')::numeric, 0,
      'purchase_returns', v_return, 'supplier', v_supplier, p_payload->>'notes');
  end loop;

  if v_mode = 'credit' then
    insert into public.supplier_transactions
      (business_id, supplier_id, entry_type, entry_date, ref_type, ref_id,
       debit, credit, balance_after, notes, created_by)
    values
      (v_business, v_supplier, 'purchase_return', v_date, 'purchase_returns', v_return,
       0, v_total, 0, 'Purchase return', public.app_user_id());
    perform public.recalc_supplier_ledger(v_supplier);
  else
    insert into public.cash_transactions
      (business_id, cash_account_id, direction, amount, category, ref_type,
       ref_id, notes, created_by, txn_at)
    values
      (v_business, v_account.id, 'in', v_total, 'other_in', 'purchase_returns',
       v_return, p_payload->>'notes', public.app_user_id(),
       ((v_date + time '12:00') at time zone 'Asia/Kolkata'));
    update public.cash_accounts
       set current_balance = current_balance + v_total
     where id = v_account.id;
  end if;

  perform public.write_audit(v_business, 'purchase.returned', 'purchase_returns', v_return, null,
    jsonb_build_object('total', v_total, 'refund_mode', v_mode, 'supplier_id', v_supplier));

  return jsonb_build_object('return_id', v_return, 'total', v_total, 'idempotency_hit', false);
end;
$$;

grant execute on function public.post_sales_return(jsonb) to authenticated;
grant execute on function public.post_purchase_return(jsonb) to authenticated;
