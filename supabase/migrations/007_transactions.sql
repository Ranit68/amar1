-- ---------------------------------------------------------------------------
-- 007_transactions.sql
-- Purchase bills + items, hawker sales bills + items.
-- All money columns are numeric(14,2); quantities numeric(16,3).
-- Posted bills are frozen: corrections happen via void/reversal, never by
-- silently mutating stock-affecting rows.
-- ---------------------------------------------------------------------------

create table public.purchase_bills (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  supplier_id    uuid not null references public.suppliers (id),
  invoice_number text,
  invoice_date   date not null default current_date,
  uploaded_at    timestamptz not null default now(),
  ocr_text       text,
  ocr_job_id     uuid references public.ocr_jobs (id),
  document_id    uuid references public.bill_documents (id),

  subtotal       numeric(14, 2) not null default 0 check (subtotal >= 0),
  discount_total numeric(14, 2) not null default 0 check (discount_total >= 0),
  tax_total      numeric(14, 2) not null default 0 check (tax_total >= 0),
  freight_cost   numeric(14, 2) not null default 0 check (freight_cost >= 0),
  other_costs    numeric(14, 2) not null default 0 check (other_costs >= 0),
  total          numeric(14, 2) not null default 0 check (total >= 0),
  amount_paid    numeric(14, 2) not null default 0 check (amount_paid >= 0),
  outstanding    numeric(14, 2) not null default 0 check (outstanding >= 0),

  status         text not null default 'draft'
                   check (status in ('draft', 'pending_approval', 'approved',
                                     'rejected', 'void')),
  payment_status text not null default 'unpaid'
                   check (payment_status in ('unpaid', 'partial', 'paid')),
  void_reason    text,
  voided_at      timestamptz,
  duplicate_of   uuid references public.purchase_bills (id),

  idempotency_key text,
  created_by     uuid references auth.users (id),
  approved_by    uuid references auth.users (id),
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (outstanding <= total)
);

-- Duplicate invoice guard: one non-void bill per supplier+invoice number.
create unique index purchase_bills_duplicate_idx
  on public.purchase_bills (business_id, supplier_id, public.ascii_digits(invoice_number))
  where invoice_number is not null
    and invoice_number <> ''
    and status <> 'void';

create unique index purchase_bills_idempotency_idx
  on public.purchase_bills (business_id, idempotency_key)
  where idempotency_key is not null;

create index purchase_bills_business_idx on public.purchase_bills (business_id, invoice_date desc);
create index purchase_bills_supplier_idx on public.purchase_bills (supplier_id, invoice_date desc);
create index purchase_bills_status_idx on public.purchase_bills (business_id, status);

create trigger purchase_bills_updated_at
  before update on public.purchase_bills
  for each row execute function public.set_updated_at();

create table public.purchase_items (
  id             uuid primary key default gen_random_uuid(),
  bill_id        uuid not null references public.purchase_bills (id) on delete cascade,
  business_id    uuid not null references public.businesses (id) on delete cascade,
  product_id     uuid not null references public.products (id),
  raw_name       text not null,          -- exactly as printed on the bill
  matched_alias  text,
  qty            numeric(16, 3) not null check (qty > 0),
  unit           text not null,
  qty_base       numeric(16, 3) not null check (qty_base > 0),
  unit_price     numeric(14, 4) not null check (unit_price >= 0),
  discount       numeric(14, 2) not null default 0 check (discount >= 0),
  tax            numeric(14, 2) not null default 0 check (tax >= 0),
  line_total     numeric(14, 2) not null check (line_total >= 0),
  -- cost per base unit after this bill (weighted average), incl. allocation
  cost_per_base_unit numeric(16, 6) not null default 0 check (cost_per_base_unit >= 0),
  notes          text,
  line_no        integer not null default 0,
  created_at     timestamptz not null default now()
);

create index purchase_items_bill_idx on public.purchase_items (bill_id);
create index purchase_items_product_idx on public.purchase_items (product_id);

create table public.sales_bills (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  hawker_id      uuid not null references public.hawkers (id),
  invoice_number text,
  invoice_date   date not null default current_date,
  uploaded_at    timestamptz not null default now(),
  ocr_text       text,
  ocr_job_id     uuid references public.ocr_jobs (id),
  document_id    uuid references public.bill_documents (id),

  subtotal       numeric(14, 2) not null default 0 check (subtotal >= 0),
  discount_total numeric(14, 2) not null default 0 check (discount_total >= 0),
  tax_total      numeric(14, 2) not null default 0 check (tax_total >= 0),
  total          numeric(14, 2) not null default 0 check (total >= 0),
  amount_received numeric(14, 2) not null default 0 check (amount_received >= 0),
  outstanding    numeric(14, 2) not null default 0 check (outstanding >= 0),

  cost_of_goods  numeric(14, 2) not null default 0 check (cost_of_goods >= 0),
  gross_profit   numeric(14, 2) not null default 0,

  status         text not null default 'draft'
                   check (status in ('draft', 'pending_approval', 'approved',
                                     'rejected', 'void')),
  payment_status text not null default 'unpaid'
                   check (payment_status in ('unpaid', 'partial', 'paid')),
  void_reason    text,
  voided_at      timestamptz,
  duplicate_of   uuid references public.sales_bills (id),

  idempotency_key text,
  created_by     uuid references auth.users (id),
  approved_by    uuid references auth.users (id),
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (outstanding <= total)
);

create unique index sales_bills_duplicate_idx
  on public.sales_bills (business_id, hawker_id, public.ascii_digits(invoice_number))
  where invoice_number is not null
    and invoice_number <> ''
    and status <> 'void';

create unique index sales_bills_idempotency_idx
  on public.sales_bills (business_id, idempotency_key)
  where idempotency_key is not null;

create index sales_bills_business_idx on public.sales_bills (business_id, invoice_date desc);
create index sales_bills_hawker_idx on public.sales_bills (hawker_id, invoice_date desc);
create index sales_bills_status_idx on public.sales_bills (business_id, status);

create trigger sales_bills_updated_at
  before update on public.sales_bills
  for each row execute function public.set_updated_at();

create table public.sales_items (
  id             uuid primary key default gen_random_uuid(),
  bill_id        uuid not null references public.sales_bills (id) on delete cascade,
  business_id    uuid not null references public.businesses (id) on delete cascade,
  product_id     uuid not null references public.products (id),
  raw_name       text not null,
  matched_alias  text,
  qty            numeric(16, 3) not null check (qty > 0),
  unit           text not null,
  qty_base       numeric(16, 3) not null check (qty_base > 0),
  unit_price     numeric(14, 4) not null check (unit_price >= 0),
  discount       numeric(14, 2) not null default 0 check (discount >= 0),
  tax            numeric(14, 2) not null default 0 check (tax >= 0),
  line_total     numeric(14, 2) not null check (line_total >= 0),
  unit_cost      numeric(16, 6) not null default 0 check (unit_cost >= 0),
  line_cost      numeric(14, 2) not null default 0 check (line_cost >= 0),
  gross_profit   numeric(14, 2) not null default 0,
  notes          text,
  line_no        integer not null default 0,
  created_at     timestamptz not null default now()
);

create index sales_items_bill_idx on public.sales_items (bill_id);
create index sales_items_product_idx on public.sales_items (product_id);
