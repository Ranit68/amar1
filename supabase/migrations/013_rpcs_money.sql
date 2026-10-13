-- ---------------------------------------------------------------------------
-- 013_rpcs_money.sql
-- Standalone payments (against one or several bills), expenses, stock
-- adjustments/counts and the daily closing workflow.
-- ---------------------------------------------------------------------------

-- =========================== customer payments =============================
create or replace function public.post_customer_payment(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_hawker uuid := (p_payload->>'hawker_id')::uuid;
  v_amount numeric := (p_payload->>'amount')::numeric;
  v_method text := coalesce(p_payload->>'method', 'cash');
  v_idem text := nullif(coalesce(p_payload->>'idempotency_key', ''), '');
  v_existing uuid;
  v_payment_id uuid;
  v_account record;
  v_hawker_row record;
  al jsonb;
  v_alloc_sum numeric := 0;
  v_bill record;
  v_bill_sum numeric := 0;
begin
  perform public.app_assert_can(v_business, 'payments.post');

  if v_hawker is null or v_amount is null or v_amount <= 0 then
    raise exception 'INVALID_PAYLOAD: hawker_id and amount > 0 required';
  end if;

  if v_idem is not null then
    select id into v_existing from public.customer_payments
     where business_id = v_business and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('payment_id', v_existing, 'idempotency_hit', true);
    end if;
  end if;

  select * into v_hawker_row from public.hawkers
   where id = v_hawker and business_id = v_business for update;
  if v_hawker_row is null then
    raise exception 'UNKNOWN_HAWKER: %', v_hawker;
  end if;

  if v_method <> 'credit' then
    select * into v_account from public.cash_accounts
     where id = (p_payload->>'cash_account_id')::uuid
       and business_id = v_business and is_active;
    if v_account is null then
      raise exception 'UNKNOWN_CASH_ACCOUNT: %', p_payload->>'cash_account_id';
    end if;
  end if;

  -- Allocations must fit inside the payment and inside each bill's outstanding.
  for al in select * from jsonb_array_elements(coalesce(p_payload->'allocations', '[]'::jsonb)) loop
    select * into v_bill from public.sales_bills
     where id = (al->>'ref_id')::uuid and business_id = v_business and hawker_id = v_hawker
       for update;
    if v_bill is null or v_bill.status <> 'approved' then
      raise exception 'INVALID_ALLOCATION: bill % not found or not approved', al->>'ref_id';
    end if;
    if (al->>'amount')::numeric <= 0 then
      raise exception 'INVALID_ALLOCATION: amount must be > 0';
    end if;
    if v_bill_sum + (al->>'amount')::numeric > v_bill.outstanding + 0.01 then
      raise exception 'ALLOCATION_EXCEEDS_OUTSTANDING: bill % has outstanding %',
        v_bill.id, v_bill.outstanding;
    end if;
    v_bill_sum := v_bill_sum + (al->>'amount')::numeric;
    v_alloc_sum := v_alloc_sum + (al->>'amount')::numeric;
  end loop;

  if v_alloc_sum > v_amount + 0.01 then
    raise exception 'ALLOCATION_EXCEEDS_PAYMENT: allocated % of payment %', v_alloc_sum, v_amount;
  end if;

  insert into public.customer_payments (
    business_id, hawker_id, amount, method, cash_account_id, reference_no,
    notes, ocr_document_id, idempotency_key, created_by, paid_at
  ) values (
    v_business, v_hawker, v_amount, v_method,
    case when v_method = 'credit' then null else v_account.id end,
    p_payload->>'reference_no', p_payload->>'notes',
    nullif(p_payload->>'ocr_document_id', '')::uuid,
    v_idem, public.app_user_id(),
    coalesce((p_payload->>'paid_at')::timestamptz, now())
  ) returning id into v_payment_id;

  if v_method <> 'credit' then
    insert into public.cash_transactions
      (business_id, cash_account_id, direction, amount, category, ref_type, ref_id, notes,
       created_by, txn_at)
    values (v_business, v_account.id, 'in', v_amount, 'collection',
            'customer_payments', v_payment_id, p_payload->>'notes', public.app_user_id(),
            coalesce((p_payload->>'paid_at')::timestamptz, now()));
    update public.cash_accounts set current_balance = current_balance + v_amount
     where id = v_account.id;
  end if;

  for al in select * from jsonb_array_elements(coalesce(p_payload->'allocations', '[]'::jsonb)) loop
    insert into public.payment_allocations
      (business_id, payment_kind, payment_id, ref_type, ref_id, amount)
    values (v_business, 'customer', v_payment_id, 'sales_bill', (al->>'ref_id')::uuid,
            (al->>'amount')::numeric);

    update public.sales_bills
       set amount_received = amount_received + (al->>'amount')::numeric,
           outstanding = outstanding - (al->>'amount')::numeric,
           payment_status = case
             when outstanding - (al->>'amount')::numeric <= 0.01 then 'paid'
             when amount_received + (al->>'amount')::numeric <= 0 then 'unpaid'
             else 'partial' end
     where id = (al->>'ref_id')::uuid;
  end loop;

  insert into public.hawker_transactions
    (business_id, hawker_id, entry_type, entry_date, ref_type, ref_id,
     debit, credit, balance_after, notes, created_by)
  values
    (v_business, v_hawker, 'payment',
     coalesce((p_payload->>'paid_at')::date, current_date),
     'customer_payments', v_payment_id, 0, v_amount, 0,
     p_payload->>'notes', public.app_user_id());
  perform public.recalc_hawker_ledger(v_hawker);

  perform public.write_audit(v_business, 'payment.customer_received', 'customer_payments',
    v_payment_id, null, jsonb_build_object('amount', v_amount, 'allocations', v_alloc_sum));

  return jsonb_build_object(
    'payment_id', v_payment_id, 'amount', v_amount,
    'allocated', v_alloc_sum, 'idempotency_hit', false
  );
end;
$$;

-- =========================== supplier payments =============================
create or replace function public.post_supplier_payment(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_supplier uuid := (p_payload->>'supplier_id')::uuid;
  v_amount numeric := (p_payload->>'amount')::numeric;
  v_method text := coalesce(p_payload->>'method', 'cash');
  v_idem text := nullif(coalesce(p_payload->>'idempotency_key', ''), '');
  v_existing uuid;
  v_payment_id uuid;
  v_account record;
  v_supplier_row record;
  al jsonb;
  v_alloc_sum numeric := 0;
  v_bill record;
  v_bill_sum numeric := 0;
begin
  perform public.app_assert_can(v_business, 'payments.post');

  if v_supplier is null or v_amount is null or v_amount <= 0 then
    raise exception 'INVALID_PAYLOAD: supplier_id and amount > 0 required';
  end if;

  if v_idem is not null then
    select id into v_existing from public.supplier_payments
     where business_id = v_business and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('payment_id', v_existing, 'idempotency_hit', true);
    end if;
  end if;

  select * into v_supplier_row from public.suppliers
   where id = v_supplier and business_id = v_business for update;
  if v_supplier_row is null then
    raise exception 'UNKNOWN_SUPPLIER: %', v_supplier;
  end if;

  if v_method <> 'credit' then
    select * into v_account from public.cash_accounts
     where id = (p_payload->>'cash_account_id')::uuid
       and business_id = v_business and is_active;
    if v_account is null then
      raise exception 'UNKNOWN_CASH_ACCOUNT: %', p_payload->>'cash_account_id';
    end if;
  end if;

  for al in select * from jsonb_array_elements(coalesce(p_payload->'allocations', '[]'::jsonb)) loop
    select * into v_bill from public.purchase_bills
     where id = (al->>'ref_id')::uuid and business_id = v_business and supplier_id = v_supplier
       for update;
    if v_bill is null or v_bill.status <> 'approved' then
      raise exception 'INVALID_ALLOCATION: bill % not found or not approved', al->>'ref_id';
    end if;
    if (al->>'amount')::numeric <= 0 then
      raise exception 'INVALID_ALLOCATION: amount must be > 0';
    end if;
    if v_bill_sum + (al->>'amount')::numeric > v_bill.outstanding + 0.01 then
      raise exception 'ALLOCATION_EXCEEDS_OUTSTANDING: bill % has outstanding %',
        v_bill.id, v_bill.outstanding;
    end if;
    v_bill_sum := v_bill_sum + (al->>'amount')::numeric;
    v_alloc_sum := v_alloc_sum + (al->>'amount')::numeric;
  end loop;

  if v_alloc_sum > v_amount + 0.01 then
    raise exception 'ALLOCATION_EXCEEDS_PAYMENT: allocated % of payment %', v_alloc_sum, v_amount;
  end if;

  insert into public.supplier_payments (
    business_id, supplier_id, amount, method, cash_account_id, reference_no,
    notes, ocr_document_id, idempotency_key, created_by, paid_at
  ) values (
    v_business, v_supplier, v_amount, v_method,
    case when v_method = 'credit' then null else v_account.id end,
    p_payload->>'reference_no', p_payload->>'notes',
    nullif(p_payload->>'ocr_document_id', '')::uuid,
    v_idem, public.app_user_id(),
    coalesce((p_payload->>'paid_at')::timestamptz, now())
  ) returning id into v_payment_id;

  if v_method <> 'credit' then
    insert into public.cash_transactions
      (business_id, cash_account_id, direction, amount, category, ref_type, ref_id, notes,
       created_by, txn_at)
    values (v_business, v_account.id, 'out', v_amount, 'payment_out',
            'supplier_payments', v_payment_id, p_payload->>'notes', public.app_user_id(),
            coalesce((p_payload->>'paid_at')::timestamptz, now()));
    update public.cash_accounts set current_balance = current_balance - v_amount
     where id = v_account.id;
  end if;

  for al in select * from jsonb_array_elements(coalesce(p_payload->'allocations', '[]'::jsonb)) loop
    insert into public.payment_allocations
      (business_id, payment_kind, payment_id, ref_type, ref_id, amount)
    values (v_business, 'supplier', v_payment_id, 'purchase_bill', (al->>'ref_id')::uuid,
            (al->>'amount')::numeric);

    update public.purchase_bills
       set amount_paid = amount_paid + (al->>'amount')::numeric,
           outstanding = outstanding - (al->>'amount')::numeric,
           payment_status = case
             when outstanding - (al->>'amount')::numeric <= 0.01 then 'paid'
             when amount_paid + (al->>'amount')::numeric <= 0 then 'unpaid'
             else 'partial' end
     where id = (al->>'ref_id')::uuid;
  end loop;

  insert into public.supplier_transactions
    (business_id, supplier_id, entry_type, entry_date, ref_type, ref_id,
     debit, credit, balance_after, notes, created_by)
  values
    (v_business, v_supplier, 'payment',
     coalesce((p_payload->>'paid_at')::date, current_date),
     'supplier_payments', v_payment_id, 0, v_amount, 0,
     p_payload->>'notes', public.app_user_id());
  perform public.recalc_supplier_ledger(v_supplier);

  perform public.write_audit(v_business, 'payment.supplier_paid', 'supplier_payments',
    v_payment_id, null, jsonb_build_object('amount', v_amount, 'allocations', v_alloc_sum));

  return jsonb_build_object(
    'payment_id', v_payment_id, 'amount', v_amount,
    'allocated', v_alloc_sum, 'idempotency_hit', false
  );
end;
$$;

-- ============================== expenses ==================================
create or replace function public.record_expense(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_amount numeric := (p_payload->>'amount')::numeric;
  v_idem text := nullif(coalesce(p_payload->>'idempotency_key', ''), '');
  v_existing uuid;
  v_expense_id uuid;
  v_account record;
  v_method text := coalesce(p_payload->>'payment_method', 'cash');
  v_kind text := coalesce(p_payload->>'kind', 'operating');
  v_paid boolean := coalesce((p_payload->>'is_paid')::boolean, true);
  v_category text := coalesce(p_payload->>'category', 'Miscellaneous');
begin
  perform public.app_assert_can(v_business, 'expenses.post');

  if v_amount is null or v_amount <= 0 then
    raise exception 'INVALID_PAYLOAD: amount must be > 0';
  end if;
  if v_kind not in ('operating', 'owner_drawings', 'loan_principal',
                    'loan_interest', 'capital', 'tax', 'other') then
    raise exception 'INVALID_KIND: %', v_kind;
  end if;

  if v_idem is not null then
    select id into v_existing from public.expenses
     where business_id = v_business and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('expense_id', v_existing, 'idempotency_hit', true);
    end if;
  end if;

  if v_paid and v_method <> 'credit' then
    select * into v_account from public.cash_accounts
     where id = (p_payload->>'cash_account_id')::uuid
       and business_id = v_business and is_active;
    if v_account is null then
      raise exception 'UNKNOWN_CASH_ACCOUNT: %', p_payload->>'cash_account_id';
    end if;
  end if;

  insert into public.expenses (
    business_id, expense_date, amount, category_id, category, kind,
    description, payment_method, cash_account_id, is_paid, is_recurring,
    receipt_document_id, notes, ocr_job_id, idempotency_key, created_by
  ) values (
    v_business,
    coalesce((p_payload->>'expense_date')::date, current_date),
    v_amount,
    nullif(p_payload->>'category_id', '')::uuid,
    v_category,
    v_kind,
    p_payload->>'description',
    v_method,
    case when v_method = 'credit' or not v_paid then null else v_account.id end,
    v_paid,
    coalesce((p_payload->>'is_recurring')::boolean, false),
    nullif(p_payload->>'receipt_document_id', '')::uuid,
    p_payload->>'notes',
    nullif(p_payload->>'ocr_job_id', '')::uuid,
    v_idem,
    public.app_user_id()
  ) returning id into v_expense_id;

  if v_paid and v_method <> 'credit' then
    insert into public.cash_transactions
      (business_id, cash_account_id, direction, amount, category, ref_type, ref_id, notes,
       created_by, txn_at)
    values (v_business, v_account.id, 'out', v_amount, 'expense',
            'expenses', v_expense_id, p_payload->>'description', public.app_user_id(),
            ((coalesce((p_payload->>'expense_date')::date, current_date) + time '12:00')
              at time zone 'Asia/Kolkata'));
    update public.cash_accounts set current_balance = current_balance - v_amount
     where id = v_account.id;
  end if;

  if coalesce(p_payload->>'ocr_job_id', '') <> '' then
    update public.ocr_jobs
       set status = 'approved', result_table = 'expenses', result_id = v_expense_id,
           updated_at = now()
     where id = (p_payload->>'ocr_job_id')::uuid;
  end if;

  perform public.write_audit(v_business, 'expense.recorded', 'expenses', v_expense_id, null,
    jsonb_build_object('amount', v_amount, 'category', v_category, 'kind', v_kind));

  return jsonb_build_object('expense_id', v_expense_id, 'idempotency_hit', false);
end;
$$;

-- ========================= stock adjustments ==============================
create or replace function public.apply_stock_adjustment(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_product uuid := (p_payload->>'product_id')::uuid;
  v_qty numeric := (p_payload->>'qty_change')::numeric;
  v_type text := coalesce(p_payload->>'adjustment_type', 'correction');
  v_adj_id uuid;
  v_movement_type text;
  v_movement_id uuid;
  v_m jsonb;
  v_bal record;
  v_apply boolean := coalesce((p_payload->>'apply_now')::boolean, true);
begin
  perform public.app_assert_can(v_business, 'inventory.write');

  if v_product is null or v_qty is null or v_qty = 0 then
    raise exception 'INVALID_PAYLOAD: product_id and non-zero qty_change required';
  end if;
  if v_type not in ('damaged', 'expired', 'wastage', 'correction', 'other') then
    raise exception 'INVALID_TYPE: %', v_type;
  end if;
  if v_qty < 0 and v_type = 'correction' and coalesce(p_payload->>'reason', '') = '' then
    raise exception 'REASON_REQUIRED: negative corrections need a reason';
  end if;

  v_movement_type := case v_type
    when 'damaged' then 'damaged'
    when 'expired' then 'expired'
    when 'wastage' then 'wastage'
    else 'adjustment'
  end;

  insert into public.stock_adjustments (
    business_id, product_id, adjustment_type, qty_change, reason, status, created_by
  ) values (
    v_business, v_product, v_type, v_qty,
    coalesce(p_payload->>'reason', 'no reason'),
    case when v_apply then 'applied' else 'pending' end,
    public.app_user_id()
  ) returning id into v_adj_id;

  if v_apply then
    if v_qty > 0 then
      select qty, avg_cost into v_bal
        from public.inventory_balances
       where business_id = v_business and product_id = v_product for update;
      v_m := public.apply_stock_movement(
        v_business, v_product, v_movement_type, v_qty,
        coalesce(v_bal.avg_cost, 0),
        'stock_adjustments', v_adj_id, null, null,
        coalesce(p_payload->>'reason', 'no reason')
      );
    else
      v_m := public.apply_stock_movement(
        v_business, v_product, v_movement_type, v_qty, null,
        'stock_adjustments', v_adj_id, null, null,
        coalesce(p_payload->>'reason', 'no reason')
      );
    end if;
    v_movement_id := (v_m->>'movement_id')::uuid;

    update public.stock_adjustments set applied_movement_id = v_movement_id where id = v_adj_id;
  end if;

  perform public.write_audit(v_business, 'inventory.adjusted', 'stock_adjustments', v_adj_id, null,
    jsonb_build_object('product_id', v_product, 'qty_change', v_qty, 'type', v_type));

  return jsonb_build_object('adjustment_id', v_adj_id, 'applied', v_apply,
                             'movement_id', v_movement_id);
end;
$$;

-- ============================ stock count =================================
create or replace function public.confirm_stock_count(
  p_count_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c record;
  it record;
  v_m jsonb;
  v_bal record;
  v_adjusted integer := 0;
begin
  select * into c from public.stock_counts where id = p_count_id for update;
  if c is null then
    raise exception 'UNKNOWN_COUNT: %', p_count_id;
  end if;
  perform public.app_assert_can(c.business_id, 'inventory.write');

  if c.status = 'confirmed' then
    return jsonb_build_object('count_id', c.id, 'status', 'confirmed', 'already_processed', true);
  end if;
  if c.status <> 'draft' then
    raise exception 'INVALID_STATE: count is %', c.status;
  end if;

  for it in
    select ci.* from public.stock_count_items ci
     where ci.count_id = c.id and ci.diff_qty <> 0
     order by ci.product_id
  loop
    if it.diff_qty > 0 then
      select qty, avg_cost into v_bal
        from public.inventory_balances
       where business_id = c.business_id and product_id = it.product_id for update;
      v_m := public.apply_stock_movement(
        c.business_id, it.product_id, 'count', it.diff_qty,
        coalesce(v_bal.avg_cost, 0),
        'stock_counts', c.id, null, null,
        'physical count ' || c.count_date::text
      );
    else
      v_m := public.apply_stock_movement(
        c.business_id, it.product_id, 'count', it.diff_qty, null,
        'stock_counts', c.id, null, null,
        'physical count ' || c.count_date::text
      );
    end if;
    v_adjusted := v_adjusted + 1;
  end loop;

  update public.stock_counts
     set status = 'confirmed',
         confirmed_by = public.app_user_id(),
         notes = coalesce(p_notes, notes)
   where id = c.id;

  perform public.write_audit(c.business_id, 'inventory.count_confirmed', 'stock_counts', c.id,
    null, jsonb_build_object('adjusted_products', v_adjusted));

  return jsonb_build_object('count_id', c.id, 'status', 'confirmed',
                            'adjusted_products', v_adjusted);
end;
$$;

-- ========================== daily closing =================================
create or replace function public.confirm_daily_closing(
  p_business_id uuid,
  p_closing_date date,
  p_counted_cash numeric default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sales_total numeric;
  v_credit_sales numeric;
  v_collections numeric;
  v_cash_in numeric;
  v_upi_in numeric;
  v_bank_in numeric;
  v_supplier_payments numeric;
  v_expenses_paid numeric;
  v_gross_profit numeric;
  v_opex numeric;
  v_net numeric;
  v_expected numeric;
  v_accounts jsonb := '[]'::jsonb;
  acc record;
  v_asof numeric;
  v_id uuid;
  v_snapshot jsonb;
begin
  perform public.app_assert_can(p_business_id, 'closing.post');

  select coalesce(sum(total), 0), coalesce(sum(gross_profit), 0)
    into v_sales_total, v_gross_profit
    from public.sales_bills
   where business_id = p_business_id and invoice_date = p_closing_date
     and status = 'approved';

  select coalesce(sum(total - amount_received), 0) into v_credit_sales
    from public.sales_bills
   where business_id = p_business_id and invoice_date = p_closing_date
     and status = 'approved';

  select coalesce(sum(amount), 0),
         coalesce(sum(amount) filter (where method = 'cash'), 0),
         coalesce(sum(amount) filter (where method = 'upi'), 0),
         coalesce(sum(amount) filter (where method in ('bank', 'cheque')), 0)
    into v_collections, v_cash_in, v_upi_in, v_bank_in
    from public.customer_payments
   where business_id = p_business_id
     and (paid_at at time zone 'Asia/Kolkata')::date = p_closing_date
     and status = 'posted';

  select coalesce(sum(amount), 0) into v_supplier_payments
    from public.supplier_payments
   where business_id = p_business_id
     and (paid_at at time zone 'Asia/Kolkata')::date = p_closing_date
     and status = 'posted';

  select coalesce(sum(amount), 0) into v_expenses_paid
    from public.expenses
   where business_id = p_business_id and expense_date = p_closing_date
     and is_paid and payment_method <> 'credit';

  select coalesce(sum(amount), 0) into v_opex
    from public.expenses
   where business_id = p_business_id and expense_date = p_closing_date
     and kind = 'operating';

  v_net := round(v_gross_profit - v_opex, 2);

  -- Expected cash (physical drawer) = opening + all cash-kind movements up to
  -- the end of the closing date, per account.
  for acc in
    select ca.id, ca.name, ca.kind, ca.opening_balance
      from public.cash_accounts ca
     where ca.business_id = p_business_id and ca.kind = 'cash' and ca.is_active
  loop
    select acc.opening_balance + coalesce(
      sum(case when ct.direction = 'in' then ct.amount else -ct.amount end), 0)
      into v_asof
      from public.cash_transactions ct
     where ct.cash_account_id = acc.id
       and ct.txn_at < (p_closing_date + interval '1 day');

    v_accounts := v_accounts || jsonb_build_array(jsonb_build_object(
      'account_id', acc.id, 'name', acc.name, 'expected', v_asof));
  end loop;

  select coalesce(sum((a->>'expected')::numeric), 0) into v_expected
    from jsonb_array_elements(v_accounts) a;

  v_snapshot := jsonb_build_object(
    'sales_total', v_sales_total,
    'credit_sales', v_credit_sales,
    'collections', v_collections,
    'cash_in', v_cash_in,
    'upi_in', v_upi_in,
    'bank_in', v_bank_in,
    'supplier_payments', v_supplier_payments,
    'expenses_paid', v_expenses_paid,
    'gross_profit', v_gross_profit,
    'operating_expenses', v_opex,
    'net_operating_profit', v_net,
    'cash_accounts', v_accounts,
    'data_note', 'Figures computed from posted transactions only; earlier periods may be incomplete if historical data was not entered.'
  );

  insert into public.daily_closings (
    business_id, closing_date, sales_total, cash_sales, upi_sales, bank_sales,
    credit_sales, collections, supplier_payments, expenses_paid,
    expected_cash, counted_cash, difference,
    gross_profit, operating_expenses, net_operating_profit,
    snapshot, notes, status, confirmed_by, confirmed_at, created_by
  ) values (
    p_business_id, p_closing_date, v_sales_total, v_cash_in, v_upi_in, v_bank_in,
    v_credit_sales, v_collections, v_supplier_payments, v_expenses_paid,
    v_expected, p_counted_cash,
    case when p_counted_cash is not null then round(p_counted_cash - v_expected, 2) end,
    v_gross_profit, v_opex, v_net,
    v_snapshot, p_notes, 'confirmed', public.app_user_id(), now(),
    public.app_user_id()
  )
  on conflict (business_id, closing_date) do update
    set sales_total = excluded.sales_total,
        cash_sales = excluded.cash_sales,
        upi_sales = excluded.upi_sales,
        bank_sales = excluded.bank_sales,
        credit_sales = excluded.credit_sales,
        collections = excluded.collections,
        supplier_payments = excluded.supplier_payments,
        expenses_paid = excluded.expenses_paid,
        expected_cash = excluded.expected_cash,
        counted_cash = excluded.counted_cash,
        difference = excluded.difference,
        gross_profit = excluded.gross_profit,
        operating_expenses = excluded.operating_expenses,
        net_operating_profit = excluded.net_operating_profit,
        snapshot = excluded.snapshot,
        notes = coalesce(excluded.notes, daily_closings.notes),
        status = 'confirmed',
        confirmed_by = public.app_user_id(),
        confirmed_at = now()
  returning id into v_id;

  perform public.write_audit(p_business_id, 'closing.confirmed', 'daily_closings', v_id, null,
    jsonb_build_object('date', p_closing_date, 'counted_cash', p_counted_cash,
                       'expected_cash', v_expected));

  return jsonb_build_object(
    'closing_id', v_id, 'expected_cash', v_expected,
    'counted_cash', p_counted_cash,
    'difference', case when p_counted_cash is not null
                       then round(p_counted_cash - v_expected, 2) end,
    'net_operating_profit', v_net
  );
end;
$$;
