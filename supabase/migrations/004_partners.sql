-- ---------------------------------------------------------------------------
-- 004_partners.sql
-- Suppliers, hawkers (customers) and their running account ledgers.
-- ---------------------------------------------------------------------------

create table public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  name           text not null,
  business_name  text,
  phone          text,
  address        text,
  gstin          text check (gstin is null or gstin ~ '^[0-9A-Z]{15}$'),
  notes          text,
  opening_balance numeric(14, 2) not null default 0 check (opening_balance >= 0),
  credit_days    integer not null default 0 check (credit_days >= 0),
  is_active      boolean not null default true,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index suppliers_business_idx on public.suppliers (business_id, is_active);
create index suppliers_name_idx on public.suppliers (business_id, public.norm_text(name));

create trigger suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

alter table public.product_aliases
  add constraint product_aliases_supplier_fk
  foreign key (supplier_id) references public.suppliers (id) on delete set null;

create table public.hawkers (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  name           text not null,
  phone          text,
  address_area   text,
  opening_balance numeric(14, 2) not null default 0 check (opening_balance >= 0),
  credit_limit   numeric(14, 2),
  credit_days    integer not null default 0 check (credit_days >= 0),
  notes          text,
  is_active      boolean not null default true,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index hawkers_business_idx on public.hawkers (business_id, is_active);
create index hawkers_name_idx on public.hawkers (business_id, public.norm_text(name));

create trigger hawkers_updated_at
  before update on public.hawkers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Ledger entries. Running balance is written transactionally by the posting
-- RPCs (balance_after). Debit = customer owes more (sales), Credit = money
-- received / returns. For suppliers it is mirrored: debit = purchase billed,
-- credit = payment made.
-- ---------------------------------------------------------------------------
create table public.hawker_transactions (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  hawker_id     uuid not null references public.hawkers (id) on delete cascade,
  entry_type    text not null check (entry_type in
                  ('opening', 'sale', 'payment', 'return', 'adjustment')),
  entry_date    date not null default current_date,
  ref_type      text,
  ref_id        uuid,
  debit         numeric(14, 2) not null default 0 check (debit >= 0),
  credit        numeric(14, 2) not null default 0 check (credit >= 0),
  balance_after numeric(14, 2) not null default 0,
  due_date      date,
  notes         text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  check (debit > 0 or credit > 0 or entry_type = 'opening')
);

create index hawker_tx_ledger_idx
  on public.hawker_transactions (business_id, hawker_id, entry_date, created_at);
create index hawker_tx_ref_idx on public.hawker_transactions (ref_type, ref_id);

create table public.supplier_transactions (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  supplier_id   uuid not null references public.suppliers (id) on delete cascade,
  entry_type    text not null check (entry_type in
                  ('opening', 'purchase', 'payment', 'purchase_return', 'adjustment')),
  entry_date    date not null default current_date,
  ref_type      text,
  ref_id        uuid,
  debit         numeric(14, 2) not null default 0 check (debit >= 0),
  credit        numeric(14, 2) not null default 0 check (credit >= 0),
  balance_after numeric(14, 2) not null default 0,
  due_date      date,
  notes         text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  check (debit > 0 or credit > 0 or entry_type = 'opening')
);

create index supplier_tx_ledger_idx
  on public.supplier_transactions (business_id, supplier_id, entry_date, created_at);
create index supplier_tx_ref_idx on public.supplier_transactions (ref_type, ref_id);
