-- ---------------------------------------------------------------------------
-- 009_reporting.sql
-- Audit log and daily closing records.
-- ---------------------------------------------------------------------------

create table public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  user_id      uuid references auth.users (id),
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  ip_address   text,
  created_at   timestamptz not null default now()
);

create index audit_logs_business_idx on public.audit_logs (business_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_user_idx on public.audit_logs (user_id);

create table public.daily_closings (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete cascade,
  closing_date      date not null,

  sales_total       numeric(14, 2) not null default 0,
  cash_sales        numeric(14, 2) not null default 0,
  upi_sales         numeric(14, 2) not null default 0,
  bank_sales        numeric(14, 2) not null default 0,
  credit_sales      numeric(14, 2) not null default 0,
  collections       numeric(14, 2) not null default 0,
  supplier_payments numeric(14, 2) not null default 0,
  expenses_paid     numeric(14, 2) not null default 0,

  expected_cash     numeric(14, 2) not null default 0,
  counted_cash      numeric(14, 2),
  difference        numeric(14, 2),

  gross_profit      numeric(14, 2) not null default 0,
  operating_expenses numeric(14, 2) not null default 0,
  net_operating_profit numeric(14, 2) not null default 0,

  snapshot          jsonb not null default '{}'::jsonb,
  notes             text,
  status            text not null default 'draft'
                      check (status in ('draft', 'confirmed', 'reopened')),
  confirmed_by      uuid references auth.users (id),
  confirmed_at      timestamptz,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, closing_date)
);

create trigger daily_closings_updated_at
  before update on public.daily_closings
  for each row execute function public.set_updated_at();
