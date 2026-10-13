-- ---------------------------------------------------------------------------
-- 011_rpcs_purchases.sql
-- Purchase bill lifecycle: draft -> approved (atomic), void, with stock,
-- supplier ledger, payments, cash and audit updated in ONE transaction.
--   post_purchase_bill  = create draft + approve in a single call
--   create_purchase_draft / approve_purchase_bill are exposed separately for
--   two-step review workflows.
-- Idempotency: payloads may carry idempotency_key; retries return the
-- original bill instead of double-counting.
-- ---------------------------------------------------------------------------

-- Shared: validate payload items -> normalized item array with line totals.
-- Returns jsonb array of {product_id, raw_name, matched_alias, qty, unit,
-- qty_base, unit_price, discount, tax, line_total}.
create or replace function public.normalize_line_items(
  p_business_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  out jsonb := '[]'::jsonb;
  it jsonb;
  v_product record;
  v_factor numeric;
  v_qty_base numeric;
  v_gross numeric;
  v_line numeric;
  v_line_no integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_ITEMS: at least one line item is required';
  end if;

  for it in select * from jsonb_array_elements(p_items)
  loop
    v_line_no := v_line_no + 1;

    if coalesce((it->>'qty')::numeric, 0) <= 0 then
      raise exception 'INVALID_QTY: line % must have qty > 0', v_line_no;
    end if;
    if coalesce((it->>'unit_price')::numeric, -1) < 0 then
      raise exception 'INVALID_PRICE: line % unit price must be >= 0', v_line_no;
    end if;

    select p.id, p.base_unit, p.name, p.is_active, p.business_id
      into v_product
      from public.products p
     where p.id = (it->>'product_id')::uuid;

    if v_product is null then
      raise exception 'UNKNOWN_PRODUCT: line %', v_line_no;
    end if;
    if v_product.business_id <> p_business_id then
      raise exception 'CROSS_BUSINESS_PRODUCT: line %', v_line_no;
    end if;
    if not v_product.is_active then
      raise exception 'INACTIVE_PRODUCT: % (line %)', v_product.name, v_line_no;
    end if;

    v_factor := public.resolve_unit_factor(v_product.id, it->>'unit');
    v_qty_base := round((it->>'qty')::numeric * v_factor, 3);
    if v_qty_base <= 0 then
      raise exception 'INVALID_QTY_BASE: line %', v_line_no;
    end if;

    v_gross := round((it->>'qty')::numeric * (it->>'unit_price')::numeric, 2);
    v_line := v_gross
              - coalesce((it->>'discount')::numeric, 0)
              + coalesce((it->>'tax')::numeric, 0);
    if v_line < 0 then
      raise exception 'LINE_TOTAL_NEGATIVE: line %', v_line_no;
    end if;

    out := out || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'raw_name', coalesce(it->>'raw_name', v_product.name),
      'matched_alias', it->>'matched_alias',
      'qty', (it->>'qty')::numeric,
      'unit', coalesce(it->>'unit', v_product.base_unit),
      'qty_base', v_qty_base,
      'unit_price', (it->>'unit_price')::numeric,
      'discount', coalesce((it->>'discount')::numeric, 0),
      'tax', coalesce((it->>'tax')::numeric, 0),
      'line_gross', v_gross,
      'line_total', v_line,
      'line_no', v_line_no
    ));
  end loop;

  return out;
end;
$$;

-- Shared: insert the bill + item rows (no stock / no ledger yet).
create or replace function public.create_purchase_draft(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_supplier uuid := (p_payload->>'supplier_id')::uuid;
  v_idem text := nullif(coalesce(p_payload->>'idempotency_key', ''), '');
  v_existing uuid;
  v_items jsonb;
  v_bill uuid;
  it jsonb;
  v_subtotal numeric := 0;
  v_line_disc numeric := 0;
  v_tax numeric := 0;
  v_bill_disc numeric := coalesce((p_payload->>'discount_total')::numeric, 0);
  v_freight numeric := coalesce((p_payload->>'freight_cost')::numeric, 0);
  v_other numeric := coalesce((p_payload->>'other_costs')::numeric, 0);
  v_total numeric;
  v_supplier_ok boolean;
begin
  perform public.app_assert_can(v_business, 'purchases.post');

  if v_business is null or v_supplier is null then
    raise exception 'INVALID_PAYLOAD: business_id and supplier_id are required';
  end if;
  if v_bill_disc < 0 or v_freight < 0 or v_other < 0 then
    raise exception 'INVALID_PAYLOAD: discounts and costs must be >= 0';
  end if;

  if v_idem is not null then
    select id into v_existing from public.purchase_bills
     where business_id = v_business and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('bill_id', v_existing, 'idempotency_hit', true);
    end if;
  end if;

  select true into v_supplier_ok from public.suppliers
   where id = v_supplier and business_id = v_business;
  if v_supplier_ok is distinct from true then
    raise exception 'UNKNOWN_SUPPLIER: %', v_supplier;
  end if;

  if coalesce(p_payload->>'invoice_number', '') <> '' then
    select id into v_existing from public.purchase_bills
     where business_id = v_business
       and supplier_id = v_supplier
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

  v_total := round(v_subtotal - v_line_disc - v_bill_disc + v_tax + v_freight + v_other, 2);
  if v_total < 0 then
    raise exception 'INVALID_TOTAL: discounts exceed line totals';
  end if;

  insert into public.purchase_bills (
    business_id, supplier_id, invoice_number, invoice_date, uploaded_at,
    ocr_text, ocr_job_id, document_id,
    subtotal, discount_total, tax_total, freight_cost, other_costs, total,
    status, payment_status, idempotency_key, created_by
  ) values (
    v_business, v_supplier,
    nullif(coalesce(p_payload->>'invoice_number', ''), ''),
    coalesce((p_payload->>'invoice_date')::date, current_date),
    now(),
    p_payload->>'ocr_text',
    nullif(p_payload->>'ocr_job_id', '')::uuid,
    nullif(p_payload->>'document_id', '')::uuid,
    v_subtotal, round(v_line_disc + v_bill_disc, 2), v_tax, v_freight, v_other,
    v_total,
    'draft', 'unpaid', v_idem,
    public.app_user_id()
  ) returning id into v_bill;

  for it in select * from jsonb_array_elements(v_items) loop
    insert into public.purchase_items (
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

  perform public.write_audit(v_business, 'purchase.draft_created', 'purchase_bills', v_bill, null,
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(v_items)));

  return jsonb_build_object('bill_id', v_bill, 'idempotency_hit', false);
end;
$$;

-- Approve a draft purchase bill: stock + weighted average cost + supplier
-- ledger + payments + cash, all atomically.
create or replace function public.approve_purchase_bill(
  p_bill_id uuid,
  p_payments jsonb default '[]'::jsonb,
  p_allow_overpay boolean default false
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
  v_extras numeric;
  v_share numeric;
  v_cost numeric;
  v_paid numeric := 0;
  pmt jsonb;
  v_supplier_bal numeric;
  v_due date;
  v_account record;
  v_payment_id uuid;
  v_alloc_total numeric;
  v_result_items jsonb := '[]'::jsonb;
  pay record;
  v_dup uuid;
  v_pay_status text;
begin
  select * into b from public.purchase_bills where id = p_bill_id for update;
  if b is null then
    raise exception 'UNKNOWN_BILL: %', p_bill_id;
  end if;
  perform public.app_assert_can(b.business_id, 'purchases.post');

  -- Serialise all ledger changes for this supplier.
  perform 1 from public.suppliers where id = b.supplier_id for update;

  if b.status = 'approved' then
    return jsonb_build_object('bill_id', b.id, 'status', 'approved', 'already_processed', true);
  end if;
  if b.status in ('void', 'rejected') then
    raise exception 'INVALID_STATE: bill is % and cannot be approved', b.status;
  end if;

  -- Duplicate guard (races are also caught by the unique index).
  if b.invoice_number is not null then
    select id into v_dup from public.purchase_bills
     where business_id = b.business_id and supplier_id = b.supplier_id
       and id <> b.id and status <> 'void'
       and public.ascii_digits(invoice_number) = public.ascii_digits(b.invoice_number);
    if found then
      raise exception 'DUPLICATE_INVOICE: identical invoice exists (bill %)', v_dup;
    end if;
  end if;

  select coalesce(sum(line_total), 0) into v_net from public.purchase_items where bill_id = b.id;
  if v_net <= 0 then
    raise exception 'NO_ITEMS: bill has no priced items';
  end if;
  v_extras := b.freight_cost + b.other_costs;

  -- Persist allocated freight/other costs into per-line inventory cost.
  for it in
    select * from public.purchase_items where bill_id = b.id order by product_id, id
  loop
    v_share := round(it.line_total / v_net * v_extras, 2);
    v_cost := round(it.line_total + v_share, 2);
    update public.purchase_items
       set cost_per_base_unit = round(v_cost / qty_base, 6)
     where id = it.id;
  end loop;

  -- Stock in (per product, serialized by the balance row lock).
  -- Each line's share of freight/other costs is part of its inventory value;
  -- the weighted average inside apply_stock_movement combines it with the
  -- existing stock value.
  for it in
    select product_id,
           sum(qty_base) as qty_base,
           sum(line_total + round(line_total / v_net * v_extras, 2)) as value
    from public.purchase_items where bill_id = b.id
    group by product_id order by product_id
  loop
    declare
      v_m jsonb;
    begin
      v_m := public.apply_stock_movement(
        b.business_id, it.product_id, 'purchase', it.qty_base,
        round(it.value / it.qty_base, 6),
        'purchase_bills', b.id, 'supplier', b.supplier_id,
        'purchase bill ' || coalesce(b.invoice_number, b.id::text)
      );

      v_result_items := v_result_items || jsonb_build_array(jsonb_build_object(
        'product_id', it.product_id,
        'qty_base', it.qty_base,
        'avg_cost_after', v_m->>'avg_cost'
      ));
    end;
  end loop;

  -- Purchase price history (append only when the price changed).
  insert into public.product_price_history
    (business_id, product_id, price_type, unit, price, supplier_id, source_ref, created_by)
  select distinct on (pi.product_id, pi.unit)
    b.business_id, pi.product_id, 'purchase', pi.unit, pi.unit_price,
    b.supplier_id, b.invoice_number, public.app_user_id()
  from public.purchase_items pi
  where pi.bill_id = b.id
    and pi.unit_price is not null
    and not exists (
      select 1 from (
        select h.price from public.product_price_history h
         where h.product_id = pi.product_id and h.price_type = 'purchase'
           and h.unit = pi.unit
         order by h.effective_at desc, h.id desc
         limit 1
      ) latest where latest.price = pi.unit_price
    )
  order by pi.product_id, pi.unit;

  -- Payments recorded together with the bill.
  for pmt in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    if coalesce((pmt->>'amount')::numeric, 0) <= 0 then
      raise exception 'INVALID_PAYMENT: amount must be > 0';
    end if;
    if v_paid + (pmt->>'amount')::numeric > b.total and not p_allow_overpay then
      raise exception 'PAYMENT_EXCEEDS_TOTAL: paid % of total %',
        v_paid + (pmt->>'amount')::numeric, b.total;
    end if;

    select * into v_account from public.cash_accounts
     where id = (pmt->>'cash_account_id')::uuid and business_id = b.business_id and is_active;
    if v_account is null then
      if coalesce(pmt->>'method', 'cash') = 'credit' then
        continue; -- credit portion: no cash movement
      end if;
      raise exception 'UNKNOWN_CASH_ACCOUNT: %', pmt->>'cash_account_id';
    end if;

    insert into public.supplier_payments (
      business_id, supplier_id, amount, method, cash_account_id, reference_no,
      notes, idempotency_key, created_by
    ) values (
      b.business_id, b.supplier_id, (pmt->>'amount')::numeric,
      coalesce(pmt->>'method', 'cash'), v_account.id, pmt->>'reference_no',
      pmt->>'notes', null, public.app_user_id()
    ) returning id into v_payment_id;

    insert into public.payment_allocations
      (business_id, payment_kind, payment_id, ref_type, ref_id, amount)
    values (b.business_id, 'supplier', v_payment_id, 'purchase_bill', b.id, (pmt->>'amount')::numeric);

    if coalesce(pmt->>'method', 'cash') <> 'credit' then
      insert into public.cash_transactions
        (business_id, cash_account_id, direction, amount, category, ref_type, ref_id, notes, created_by)
      values (b.business_id, v_account.id, 'out', (pmt->>'amount')::numeric,
              'purchase_payment', 'purchase_bills', b.id,
              'payment against bill ' || coalesce(b.invoice_number, b.id::text),
              public.app_user_id());

      update public.cash_accounts
         set current_balance = current_balance - (pmt->>'amount')::numeric
       where id = v_account.id;
    end if;

    v_paid := v_paid + (pmt->>'amount')::numeric;
  end loop;

  v_pay_status := case when v_paid <= 0 then 'unpaid'
                       when v_paid >= b.total then 'paid'
                       else 'partial' end;

  update public.purchase_bills
     set status = 'approved',
         amount_paid = v_paid,
         outstanding = b.total - v_paid,
         payment_status = v_pay_status,
         approved_by = public.app_user_id(),
         approved_at = now()
   where id = b.id;

  -- Supplier ledger: purchase debit, then payment credits. Running balances
  -- are recomputed for the whole ledger so entries dated in the past (or any
  -- out-of-order insert) can never leave stale balance_after values.
  v_due := b.invoice_date + (select coalesce(credit_days, 0) from public.suppliers where id = b.supplier_id);

  insert into public.supplier_transactions
    (business_id, supplier_id, entry_type, entry_date, ref_type, ref_id,
     debit, credit, balance_after, due_date, created_by)
  values
    (b.business_id, b.supplier_id, 'purchase', b.invoice_date, 'purchase_bills', b.id,
     b.total, 0, 0, v_due, public.app_user_id());

  for pay in
    select pa.amount, sp.id as payment_id, sp.paid_at
      from public.payment_allocations pa
      join public.supplier_payments sp on sp.id = pa.payment_id
     where pa.payment_kind = 'supplier' and pa.ref_type = 'purchase_bill' and pa.ref_id = b.id
       and sp.status = 'posted'
  loop
    insert into public.supplier_transactions
      (business_id, supplier_id, entry_type, entry_date, ref_type, ref_id,
       debit, credit, balance_after, created_by)
    values
      (b.business_id, b.supplier_id, 'payment', (pay.paid_at)::date, 'supplier_payments', pay.payment_id,
       0, pay.amount, 0, public.app_user_id());
  end loop;

  perform public.recalc_supplier_ledger(b.supplier_id);

  -- Link OCR job, if any.
  if b.ocr_job_id is not null then
    update public.ocr_jobs
       set status = 'approved', result_table = 'purchase_bills', result_id = b.id, updated_at = now()
     where id = b.ocr_job_id;
  end if;

  perform public.write_audit(b.business_id, 'purchase.approved', 'purchase_bills', b.id, null,
    jsonb_build_object('total', b.total, 'paid', v_paid, 'outstanding', b.total - v_paid));

  return jsonb_build_object(
    'bill_id', b.id, 'status', 'approved',
    'total', b.total, 'amount_paid', v_paid, 'outstanding', b.total - v_paid,
    'stock', v_result_items
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- post_purchase_bill: the normal entry point. Creates the draft and approves
-- it in ONE transaction; on any failure nothing is persisted.
-- ---------------------------------------------------------------------------
create or replace function public.post_purchase_bill(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_bill uuid;
  v_hit boolean := false;
  v_idem text := nullif(coalesce(p_payload->>'idempotency_key', ''), '');
  v_created jsonb;
  v_approved jsonb;
begin
  perform public.app_assert_can(v_business, 'purchases.post');

  begin
    v_created := public.create_purchase_draft(p_payload);
  exception when unique_violation then
    if v_idem is not null then
      select id into v_bill from public.purchase_bills
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
  v_approved := public.approve_purchase_bill(
    v_bill, coalesce(p_payload->'payments', '[]'::jsonb),
    coalesce((p_payload->>'allow_overpay')::boolean, false)
  );
  return v_approved;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_purchase_bill: controlled reversal of an approved bill.
-- Stock is removed at the CURRENT weighted-average cost; if the goods were
-- already sold the reversal fails (INSUFFICIENT_STOCK) instead of corrupting
-- history. Payments already made stay recorded as advances with the supplier;
-- the purchase ledger entry is reversed by an adjustment credit.
-- ---------------------------------------------------------------------------
create or replace function public.void_purchase_bill(
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
begin
  select * into b from public.purchase_bills where id = p_bill_id for update;
  if b is null then
    raise exception 'UNKNOWN_BILL: %', p_bill_id;
  end if;
  perform public.app_assert_can(b.business_id, 'purchases.post');

  if b.status = 'void' then
    return jsonb_build_object('bill_id', b.id, 'status', 'void', 'already_processed', true);
  end if;
  if b.status <> 'approved' then
    raise exception 'INVALID_STATE: only approved bills can be voided (status %)', b.status;
  end if;

  for it in select product_id, sum(qty_base) as qty_base
              from public.purchase_items where bill_id = b.id
             group by product_id order by product_id
  loop
    perform public.apply_stock_movement(
      b.business_id, it.product_id, 'adjustment', -it.qty_base, null,
      'purchase_bills', b.id, 'supplier', b.supplier_id,
      'void of purchase bill ' || coalesce(b.invoice_number, b.id::text)
    );
  end loop;

  -- Reverse the purchase debit with an offsetting adjustment credit.
  perform 1 from public.suppliers where id = b.supplier_id for update;
  insert into public.supplier_transactions
    (business_id, supplier_id, entry_type, entry_date, ref_type, ref_id,
     debit, credit, balance_after, notes, created_by)
  values
    (b.business_id, b.supplier_id, 'adjustment', current_date, 'purchase_bills', b.id,
     0, b.total, 0, 'VOID: ' || coalesce(p_reason, 'no reason'), public.app_user_id());
  perform public.recalc_supplier_ledger(b.supplier_id);

  update public.purchase_bills
     set status = 'void', void_reason = p_reason, voided_at = now()
   where id = b.id;

  if b.ocr_job_id is not null then
    update public.ocr_jobs set status = 'cancelled', updated_at = now()
     where id = b.ocr_job_id and status <> 'approved';
  end if;

  perform public.write_audit(b.business_id, 'purchase.voided', 'purchase_bills', b.id,
    jsonb_build_object('total', b.total), jsonb_build_object('reason', p_reason));

  return jsonb_build_object('bill_id', b.id, 'status', 'void');
end;
$$;
