-- ---------------------------------------------------------------------------
-- 012_rpcs_sales.sql
-- Hawker sales bill lifecycle: draft -> approved (atomic stock deduction at
-- weighted-average cost, COGS + gross profit capture, hawker ledger, received
-- payments, cash, audit) and controlled void.
-- ---------------------------------------------------------------------------

create or replace function public.create_sales_draft(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_hawker uuid := (p_payload->>'hawker_id')::uuid;
  v_idem text := nullif(coalesce(p_payload->>'idempotency_key', ''), '');
  v_existing uuid;
  v_items jsonb;
  v_bill uuid;
  it jsonb;
  v_subtotal numeric := 0;
  v_line_disc numeric := 0;
  v_tax numeric := 0;
  v_bill_disc numeric := coalesce((p_payload->>'discount_total')::numeric, 0);
  v_total numeric;
  v_hawker_ok boolean;
begin
  perform public.app_assert_can(v_business, 'sales.post');

  if v_business is null or v_hawker is null then
    raise exception 'INVALID_PAYLOAD: business_id and hawker_id are required';
  end if;
  if v_bill_disc < 0 then
    raise exception 'INVALID_PAYLOAD: discount must be >= 0';
  end if;

  if v_idem is not null then
    select id into v_existing from public.sales_bills
     where business_id = v_business and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('bill_id', v_existing, 'idempotency_hit', true);
    end if;
  end if;

  select true into v_hawker_ok from public.hawkers
   where id = v_hawker and business_id = v_business;
  if v_hawker_ok is distinct from true then
    raise exception 'UNKNOWN_HAWKER: %', v_hawker;
  end if;

  if coalesce(p_payload->>'invoice_number', '') <> '' then
    select id into v_existing from public.sales_bills
     where business_id = v_business
       and hawker_id = v_hawker
       and status <> 'void'
       and public.ascii_digits(invoice_number) =
           public.ascii_digits(p_payload->>'invoice_number');
    if found then
      raise exception 'DUPLICATE_INVOICE: an identical invoice already exists (bill %)', v_existing;
    end if;
  end if;

  v_items := public.normalize_line_items(v_business, p_payload->'items');

  for it in select * from jsonb_array_elements(v_items) loop
    v_subtotal := v_subtotal + (it->>'line_gross')::numeric;
    v_line_disc := v_line_disc + (it->>'discount')::numeric;
    v_tax := v_tax + (it->>'tax')::numeric;
  end loop;

  v_total := round(v_subtotal - v_line_disc - v_bill_disc + v_tax, 2);
  if v_total < 0 then
    raise exception 'INVALID_TOTAL: discounts exceed line totals';
  end if;

  insert into public.sales_bills (
    business_id, hawker_id, invoice_number, invoice_date, uploaded_at,
    ocr_text, ocr_job_id, document_id,
    subtotal, discount_total, tax_total, total,
    status, payment_status, idempotency_key, created_by
  ) values (
    v_business, v_hawker,
    nullif(coalesce(p_payload->>'invoice_number', ''), ''),
    coalesce((p_payload->>'invoice_date')::date, current_date),
    now(),
    p_payload->>'ocr_text',
    nullif(p_payload->>'ocr_job_id', '')::uuid,
    nullif(p_payload->>'document_id', '')::uuid,
    v_subtotal, round(v_line_disc + v_bill_disc, 2), v_tax, v_total,
    'draft', 'unpaid', v_idem,
    public.app_user_id()
  ) returning id into v_bill;

  for it in select * from jsonb_array_elements(v_items) loop
    insert into public.sales_items (
      bill_id, business_id, product_id, raw_name, matched_alias,
      qty, unit, qty_base, unit_price, discount, tax, line_total, line_no
    ) values (
      v_bill, v_business,
      (it->>'product_id')::uuid,
      it->>'raw_name', it->>'matched_alias',
      (it->>'qty')::numeric, it->>'unit', (it->>'qty_base')::numeric,
      (it->>'unit_price')::numeric, (it->>'discount')::numeric,
      (it->>'tax')::numeric, (it->>'line_total')::numeric,
      (it->>'line_no')::integer
    );
  end loop;

  perform public.write_audit(v_business, 'sale.draft_created', 'sales_bills', v_bill, null,
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(v_items)));

  return jsonb_build_object('bill_id', v_bill, 'idempotency_hit', false);
end;
$$;

create or replace function public.approve_sales_bill(
  p_bill_id uuid,
  p_received jsonb default '[]'::jsonb,
  p_allow_credit_over_limit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b record;
  it record;
  v_net numeric := 0;
  v_received numeric := 0;
  pmt jsonb;
  v_account record;
  v_payment_id uuid;
  v_pay_status text;
  v_dup uuid;
  v_hawker record;
  v_expected_bal numeric;
  v_cogs numeric := 0;
  v_m jsonb;
  v_factor numeric;
  v_result_items jsonb := '[]'::jsonb;
  pay record;
begin
  select * into b from public.sales_bills where id = p_bill_id for update;
  if b is null then
    raise exception 'UNKNOWN_BILL: %', p_bill_id;
  end if;
  perform public.app_assert_can(b.business_id, 'sales.post');

  if b.status = 'approved' then
    return jsonb_build_object('bill_id', b.id, 'status', 'approved', 'already_processed', true);
  end if;
  if b.status in ('void', 'rejected') then
    raise exception 'INVALID_STATE: bill is % and cannot be approved', b.status;
  end if;

  -- Serialise ledger + credit-limit evaluation for this hawker.
  select * into v_hawker from public.hawkers where id = b.hawker_id for update;
  if v_hawker is null then
    raise exception 'UNKNOWN_HAWKER: %', b.hawker_id;
  end if;

  if b.invoice_number is not null then
    select id into v_dup from public.sales_bills
     where business_id = b.business_id and hawker_id = b.hawker_id
       and id <> b.id and status <> 'void'
       and public.ascii_digits(invoice_number) = public.ascii_digits(b.invoice_number);
    if found then
      raise exception 'DUPLICATE_INVOICE: identical invoice exists (bill %)', v_dup;
    end if;
  end if;

  select coalesce(sum(line_total), 0) into v_net from public.sales_items where bill_id = b.id;
  if v_net <= 0 then
    raise exception 'NO_ITEMS: bill has no priced items';
  end if;

  -- Recompute base quantities with the CURRENT conversion rules (they may
  -- have been corrected since the draft was entered).
  for it in select * from public.sales_items where bill_id = b.id loop
    v_factor := public.resolve_unit_factor(it.product_id, it.unit);
    update public.sales_items
       set qty_base = round(it.qty * v_factor, 3)
     where id = it.id;
  end loop;

  -- Credit-limit pre-check (balance after this bill, before stock work).
  for pmt in select * from jsonb_array_elements(coalesce(p_received, '[]'::jsonb)) loop
    v_received := v_received + coalesce((pmt->>'amount')::numeric, 0);
  end loop;
  if v_received > b.total + 0.009 and not coalesce(p_allow_credit_over_limit, false) then
    raise exception 'PAYMENT_EXCEEDS_TOTAL: received % of total %', v_received, b.total;
  end if;

  select public.hawker_balance(b.hawker_id) into v_expected_bal;
  v_expected_bal := v_expected_bal + b.total - v_received;
  if v_hawker.credit_limit is not null
     and v_expected_bal > v_hawker.credit_limit
     and not coalesce(p_allow_credit_over_limit, false) then
    raise exception 'CREDIT_LIMIT_EXCEEDED: hawker % would owe % (limit %)',
      v_hawker.name, v_expected_bal, v_hawker.credit_limit;
  end if;

  -- Deduct stock (per product, serialized by the balance row lock) and
  -- capture the actual weighted-average cost as COGS.
  for it in
    select product_id, sum(qty_base) as qty_base, sum(line_total) as value
      from public.sales_items where bill_id = b.id
     group by product_id order by product_id
  loop
    v_m := public.apply_stock_movement(
      b.business_id, it.product_id, 'sale', -it.qty_base, null,
      'sales_bills', b.id, 'hawker', b.hawker_id,
      'sale bill ' || coalesce(b.invoice_number, b.id::text)
    );
    v_result_items := v_result_items || jsonb_build_array(jsonb_build_object(
      'product_id', it.product_id,
      'qty_base', it.qty_base,
      'avg_cost', v_m->>'avg_cost'
    ));
  end loop;

  -- Write the captured cost back onto each line.
  for it in select * from public.sales_items where bill_id = b.id order by product_id, id loop
    declare
      v_bal record;
      v_line_cost numeric;
    begin
      select qty, avg_cost into v_bal
        from public.inventory_balances
       where business_id = b.business_id and product_id = it.product_id;

      -- Cost of the units that just left = avg AFTER the sale movement;
      -- because outgoing leaves avg unchanged, this is also the pre-sale avg.
      v_line_cost := round(it.qty_base * coalesce(v_bal.avg_cost, 0), 2);
      update public.sales_items
         set unit_cost = coalesce(v_bal.avg_cost, 0),
             line_cost = v_line_cost,
             gross_profit = it.line_total - v_line_cost
       where id = it.id;
      v_cogs := v_cogs + v_line_cost;
    end;
  end loop;

  v_cogs := round(v_cogs, 2);

  -- Selling price history (append only when changed).
  insert into public.product_price_history
    (business_id, product_id, price_type, unit, price, source_ref, created_by)
  select distinct on (si.product_id, si.unit)
    b.business_id, si.product_id, 'sale', si.unit, si.unit_price,
    b.invoice_number, public.app_user_id()
  from public.sales_items si
  where si.bill_id = b.id
    and not exists (
      select 1 from (
        select h.price from public.product_price_history h
         where h.product_id = si.product_id and h.price_type = 'sale' and h.unit = si.unit
         order by h.effective_at desc, h.id desc limit 1
      ) latest where latest.price = si.unit_price
    )
  order by si.product_id, si.unit;

  -- Payments received with the bill.
  for pmt in select * from jsonb_array_elements(coalesce(p_received, '[]'::jsonb)) loop
    if coalesce((pmt->>'amount')::numeric, 0) <= 0 then
      raise exception 'INVALID_PAYMENT: amount must be > 0';
    end if;

    select * into v_account from public.cash_accounts
     where id = (pmt->>'cash_account_id')::uuid and business_id = b.business_id and is_active;
    if v_account is null then
      if coalesce(pmt->>'method', 'cash') = 'credit' then
        continue;
      end if;
      raise exception 'UNKNOWN_CASH_ACCOUNT: %', pmt->>'cash_account_id';
    end if;

    insert into public.customer_payments (
      business_id, hawker_id, amount, method, cash_account_id, reference_no,
      notes, idempotency_key, created_by
    ) values (
      b.business_id, b.hawker_id, (pmt->>'amount')::numeric,
      coalesce(pmt->>'method', 'cash'), v_account.id, pmt->>'reference_no',
      pmt->>'notes', null, public.app_user_id()
    ) returning id into v_payment_id;

    insert into public.payment_allocations
      (business_id, payment_kind, payment_id, ref_type, ref_id, amount)
    values (b.business_id, 'customer', v_payment_id, 'sales_bill', b.id, (pmt->>'amount')::numeric);

    insert into public.cash_transactions
      (business_id, cash_account_id, direction, amount, category, ref_type, ref_id, notes, created_by)
    values (b.business_id, v_account.id, 'in', (pmt->>'amount')::numeric,
            'sale_receipt', 'sales_bills', b.id,
            'received with bill ' || coalesce(b.invoice_number, b.id::text),
            public.app_user_id());

    update public.cash_accounts
       set current_balance = current_balance + (pmt->>'amount')::numeric
     where id = v_account.id;
  end loop;

  v_pay_status := case when v_received <= 0 then 'unpaid'
                       when v_received >= b.total then 'paid'
                       else 'partial' end;

  update public.sales_bills
     set status = 'approved',
         amount_received = v_received,
         outstanding = b.total - v_received,
         payment_status = v_pay_status,
         cost_of_goods = v_cogs,
         gross_profit = round(b.total - v_cogs, 2),
         approved_by = public.app_user_id(),
         approved_at = now()
   where id = b.id;

  -- Hawker ledger: sale debit + payment credits, then rebuild balances.
  insert into public.hawker_transactions
    (business_id, hawker_id, entry_type, entry_date, ref_type, ref_id,
     debit, credit, balance_after, due_date, created_by)
  values
    (b.business_id, b.hawker_id, 'sale', b.invoice_date, 'sales_bills', b.id,
     b.total, 0, 0,
     b.invoice_date + coalesce(v_hawker.credit_days, 0),
     public.app_user_id());

  for pay in
    select pa.amount, cp.id as payment_id, cp.paid_at
      from public.payment_allocations pa
      join public.customer_payments cp on cp.id = pa.payment_id
     where pa.payment_kind = 'customer' and pa.ref_type = 'sales_bill' and pa.ref_id = b.id
       and cp.status = 'posted'
  loop
    insert into public.hawker_transactions
      (business_id, hawker_id, entry_type, entry_date, ref_type, ref_id,
       debit, credit, balance_after, created_by)
    values
      (b.business_id, b.hawker_id, 'payment', (pay.paid_at)::date, 'customer_payments', pay.payment_id,
       0, pay.amount, 0, public.app_user_id());
  end loop;

  perform public.recalc_hawker_ledger(b.hawker_id);

  if b.ocr_job_id is not null then
    update public.ocr_jobs
       set status = 'approved', result_table = 'sales_bills', result_id = b.id, updated_at = now()
     where id = b.ocr_job_id;
  end if;

  perform public.write_audit(b.business_id, 'sale.approved', 'sales_bills', b.id, null,
    jsonb_build_object('total', b.total, 'cogs', v_cogs, 'received', v_received));

  return jsonb_build_object(
    'bill_id', b.id, 'status', 'approved',
    'total', b.total, 'cost_of_goods', v_cogs,
    'gross_profit', round(b.total - v_cogs, 2),
    'amount_received', v_received, 'outstanding', b.total - v_received,
    'stock', v_result_items
  );
end;
$$;

create or replace function public.post_sales_bill(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_bill uuid;
  v_idem text := nullif(coalesce(p_payload->>'idempotency_key', ''), '');
  v_created jsonb;
begin
  perform public.app_assert_can(v_business, 'sales.post');

  begin
    v_created := public.create_sales_draft(p_payload);
  exception when unique_violation then
    if v_idem is not null then
      select id into v_bill from public.sales_bills
       where business_id = v_business and idempotency_key = v_idem;
      if found then
        return jsonb_build_object('bill_id', v_bill, 'idempotency_hit', true);
      end if;
    end if;
    raise;
  end;

  if coalesce((v_created->>'idempotency_hit')::boolean, false) then
    return v_created;
  end if;

  v_bill := (v_created->>'bill_id')::uuid;
  return public.approve_sales_bill(
    v_bill,
    coalesce(p_payload->'received', '[]'::jsonb),
    coalesce((p_payload->>'allow_credit_override')::boolean, false)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- void_sales_bill: controlled reversal. Stock returns at the current average
-- cost, the sale ledger entry is offset, allocations of bill-time payments
-- are detached (the money itself stays recorded as an unallocated advance),
-- and all running balances are rebuilt.
-- ---------------------------------------------------------------------------
create or replace function public.void_sales_bill(
  p_bill_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b record;
  it record;
  v_m jsonb;
  v_removed_allocs jsonb := '[]'::jsonb;
  v_bal record;
begin
  select * into b from public.sales_bills where id = p_bill_id for update;
  if b is null then
    raise exception 'UNKNOWN_BILL: %', p_bill_id;
  end if;
  perform public.app_assert_can(b.business_id, 'sales.post');

  if b.status = 'void' then
    return jsonb_build_object('bill_id', b.id, 'status', 'void', 'already_processed', true);
  end if;
  if b.status <> 'approved' then
    raise exception 'INVALID_STATE: only approved bills can be voided (status %)', b.status;
  end if;

  perform 1 from public.hawkers where id = b.hawker_id for update;

  for it in select product_id, sum(qty_base) as qty_base
              from public.sales_items where bill_id = b.id
             group by product_id order by product_id
  loop
    select qty, avg_cost into v_bal
      from public.inventory_balances
     where business_id = b.business_id and product_id = it.product_id;
    v_m := public.apply_stock_movement(
      b.business_id, it.product_id, 'adjustment', it.qty_base,
      coalesce(v_bal.avg_cost, 0),
      'sales_bills', b.id, 'hawker', b.hawker_id,
      'void of sale bill ' || coalesce(b.invoice_number, b.id::text)
    );
  end loop;

  -- Detach payment allocations (kept for the audit trail below).
  select coalesce(jsonb_agg(to_jsonb(pa)), '[]'::jsonb) into v_removed_allocs
    from public.payment_allocations pa
   where pa.payment_kind = 'customer' and pa.ref_type = 'sales_bill' and pa.ref_id = b.id;

  delete from public.payment_allocations
   where payment_kind = 'customer' and ref_type = 'sales_bill' and ref_id = b.id;

  insert into public.hawker_transactions
    (business_id, hawker_id, entry_type, entry_date, ref_type, ref_id,
     debit, credit, balance_after, notes, created_by)
  values
    (b.business_id, b.hawker_id, 'adjustment', current_date, 'sales_bills', b.id,
     0, b.total, 0, 'VOID: ' || coalesce(p_reason, 'no reason'), public.app_user_id());

  perform public.recalc_hawker_ledger(b.hawker_id);

  update public.sales_bills
     set status = 'void', void_reason = p_reason, voided_at = now()
   where id = b.id;

  if b.ocr_job_id is not null then
    update public.ocr_jobs set status = 'cancelled', updated_at = now()
     where id = b.ocr_job_id and status <> 'approved';
  end if;

  perform public.write_audit(b.business_id, 'sale.voided', 'sales_bills', b.id,
    jsonb_build_object('total', b.total, 'removed_allocations', v_removed_allocs),
    jsonb_build_object('reason', p_reason));

  return jsonb_build_object('bill_id', b.id, 'status', 'void');
end;
$$;
