-- ---------------------------------------------------------------------------
-- 008_money.sql
-- Cash accounts, cashbook, customer/supplier payments + allocations,
-- expenses (with explicit accounting kind so drawings/loan principal are
-- never counted as operating expenses).
-- ---------------------------------------------------------------------------

create table public.cash_accounts (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  name           text not null,
  kind           text not null check (kind in ('cash', 'bank', 'upi')),
  opening_balance numeric(14, 2) not null default 0,
  current_balance numeric(14, 2) not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, name)
);

create trigger cash_accounts_updated_at
  before update on public.cash_accounts
  for each row execute function public.set_updated_at();

create table public.cash_transactions (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  cash_account_id uuid not null references public.cash_accounts (id),
  direction       text not null check (direction in ('in', 'out')),
  amount          numeric(14, 2) not null check (amount > 0),
  category        text not null check (category in (
                    'opening', 'sale_receipt', 'collection', 'payment_in',
                    'payment_out', 'expense', 'purchase_payment',
                    'other_in', 'other_out', 'transfer_in', 'transfer_out')),
  ref_type        text,
  ref_id          uuid,
  txn_at          timestamptz not null default now(),
  notes           text,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now()
);

create index cash_transactions_account_idx
  on public.cash_transactions (business_id, cash_account_id, txn_at desc);
create index cash_transactions_date_idx on public.cash_transactions (business_id, txn_at);
create index cash_transactions_ref_idx on public.cash_transactions (ref_type, ref_id);

create table public.customer_payments (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  hawker_id      uuid not null references public.hawkers (id),
  paid_at        timestamptz not null default now(),
  amount         numeric(14, 2) not null check (amount > 0),
  method         text not null default 'cash'
                   check (method in ('cash', 'upi', 'bank', 'cheque', 'other')),
  cash_account_id uuid references public.cash_accounts (id),
  reference_no   text,
  notes          text,
  status         text not null default 'posted' check (status in ('posted', 'void')),
  ocr_document_id uuid references public.bill_documents (id),
  idempotency_key text,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

create index customer_payments_hawker_idx
  on public.customer_payments (hawker_id, paid_at desc);
create index customer_payments_business_idx
  on public.customer_payments (business_id, paid_at desc);

create trigger customer_payments_updated_at
  before update on public.customer_payments
  for each row execute function public.set_updated_at();

create table public.supplier_payments (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  supplier_id    uuid not null references public.suppliers (id),
  paid_at        timestamptz not null default now(),
  amount         numeric(14, 2) not null check (amount > 0),
  method         text not null default 'cash'
                   check (method in ('cash', 'upi', 'bank', 'cheque', 'other')),
  cash_account_id uuid references public.cash_accounts (id),
  reference_no   text,
  notes          text,
  status         text not null default 'posted' check (status in ('posted', 'void')),
  ocr_document_id uuid references public.bill_documents (id),
  idempotency_key text,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

create index supplier_payments_supplier_idx
  on public.supplier_payments (supplier_id, paid_at desc);
create index supplier_payments_business_idx
  on public.supplier_payments (business_id, paid_at desc);

create trigger supplier_payments_updated_at
  before update on public.supplier_payments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- A payment can settle several bills (partial or full).
-- ---------------------------------------------------------------------------
create table public.payment_allocations (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  payment_kind text not null check (payment_kind in ('customer', 'supplier')),
  payment_id   uuid not null,
  ref_type     text not null check (ref_type in ('sales_bill', 'purchase_bill')),
  ref_id       uuid not null,
  amount       numeric(14, 2) not null check (amount > 0),
  created_at   timestamptz not null default now(),
  unique (payment_kind, payment_id, ref_id)
);

create index payment_allocations_ref_idx
  on public.payment_allocations (ref_type, ref_id);

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
create table public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null,
  name_bn     text,
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (business_id, name)
);

create table public.expenses (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  expense_date   date not null default current_date,
  amount         numeric(14, 2) not null check (amount > 0),
  category_id    uuid references public.expense_categories (id),
  category       text not null,           -- denormalised snapshot of category name
  kind           text not null default 'operating'
                   check (kind in ('operating', 'owner_drawings', 'loan_principal',
                                   'loan_interest', 'capital', 'tax', 'other')),
  description    text,
  payment_method text not null default 'cash'
                   check (payment_method in ('cash', 'upi', 'bank', 'credit', 'other')),
  cash_account_id uuid references public.cash_accounts (id),
  is_paid        boolean not null default true,
  is_recurring   boolean not null default false,
  receipt_document_id uuid references public.bill_documents (id),
  notes          text,
  ocr_job_id     uuid references public.ocr_jobs (id),
  idempotency_key text,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

create index expenses_date_idx on public.expenses (business_id, expense_date desc);
create index expenses_category_idx on public.expenses (business_id, category);
create index expenses_kind_idx on public.expenses (business_id, kind, expense_date);

create trigger expenses_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();
