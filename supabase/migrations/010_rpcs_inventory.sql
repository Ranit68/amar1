-- ---------------------------------------------------------------------------
-- 010_rpcs_inventory.sql
-- Return documents + the core atomic stock movement primitive, plus ledger
-- balance recalculators used by void operations.
-- ---------------------------------------------------------------------------

create table public.sales_returns (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  hawker_id      uuid not null references public.hawkers (id),
  original_bill_id uuid references public.sales_bills (id),
  return_date    date not null default current_date,
  refund_mode    text not null default 'credit' check (refund_mode in ('credit', 'cash')),
  total          numeric(14, 2) not null default 0 check (total >= 0),
  items          jsonb not null default '[]'::jsonb,
  notes          text,
  status         text not null default 'posted' check (status in ('posted', 'void')),
  idempotency_key text,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

create table public.purchase_returns (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  supplier_id    uuid not null references public.suppliers (id),
  original_bill_id uuid references public.purchase_bills (id),
  return_date    date not null default current_date,
  refund_mode    text not null default 'credit' check (refund_mode in ('credit', 'cash')),
  total          numeric(14, 2) not null default 0 check (total >= 0),
  items          jsonb not null default '[]'::jsonb,
  notes          text,
  status         text not null default 'posted' check (status in ('posted', 'void')),
  idempotency_key text,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- apply_stock_movement: THE single primitive that changes stock.
--   incoming (qty_change > 0): weighted-average cost is recomputed as
--       new_avg = (old_qty * old_avg + qty * p_unit_cost) / (old_qty + qty)
--   outgoing (qty_change < 0): stock leaves at the current weighted average;
--       fails with INSUFFICIENT_STOCK when it would go negative.
-- Concurrency: the balance row is locked FOR UPDATE inside the caller's
-- transaction, so concurrent sales serialise per product.
-- Returns jsonb: {qty_after, avg_cost, unit_cost, line_cost}
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
    v_new_qty := v_qty + p_qty_change;
    if v_new_qty = 0 or v_qty = 0 then
      v_new_avg := coalesce(p_unit_cost, 0);
    else
      v_new_avg := round((v_qty * v_avg + p_qty_change * coalesce(p_unit_cost, 0)) / v_new_qty, 6);
    end if;
    v_unit_cost := coalesce(p_unit_cost, 0);
    v_line_cost := round(p_qty_change * v_unit_cost, 2);
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
-- Recalculate a stored running ledger balance after an out-of-order change
-- (void / correction). Entries are immutable; only balance_after is fixed up.
-- ---------------------------------------------------------------------------
create or replace function public.recalc_hawker_ledger(p_hawker_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_bal numeric := 0;
  v_open numeric;
begin
  select opening_balance into v_open from public.hawkers where id = p_hawker_id;
  v_bal := coalesce(v_open, 0);
  for r in
    select id, debit, credit from public.hawker_transactions
     where hawker_id = p_hawker_id
     order by entry_date, created_at, id
  loop
    v_bal := v_bal + r.debit - r.credit;
    update public.hawker_transactions set balance_after = v_bal where id = r.id;
  end loop;
end;
$$;

create or replace function public.recalc_supplier_ledger(p_supplier_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_bal numeric := 0;
  v_open numeric;
begin
  select opening_balance into v_open from public.suppliers where id = p_supplier_id;
  v_bal := coalesce(v_open, 0);
  for r in
    select id, debit, credit from public.supplier_transactions
     where supplier_id = p_supplier_id
     order by entry_date, created_at, id
  loop
    v_bal := v_bal + r.debit - r.credit;
    update public.supplier_transactions set balance_after = v_bal where id = r.id;
  end loop;
end;
$$;

-- Current outstanding balance for a hawker / supplier (ledger running total).
create or replace function public.hawker_balance(p_hawker_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select balance_after from public.hawker_transactions
      where hawker_id = p_hawker_id
      order by entry_date desc, created_at desc, id desc limit 1),
    (select opening_balance from public.hawkers where id = p_hawker_id),
    0
  );
$$;

create or replace function public.supplier_balance(p_supplier_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select balance_after from public.supplier_transactions
      where supplier_id = p_supplier_id
      order by entry_date desc, created_at desc, id desc limit 1),
    (select opening_balance from public.suppliers where id = p_supplier_id),
    0
  );
$$;
