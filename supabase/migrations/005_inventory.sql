-- ---------------------------------------------------------------------------
-- 005_inventory.sql
-- Authoritative stock history (stock_movements), fast balances
-- (inventory_balances), counts, adjustments and alert acknowledgements.
-- ---------------------------------------------------------------------------

create table public.inventory_balances (
  business_id     uuid not null references public.businesses (id) on delete cascade,
  product_id      uuid not null references public.products (id) on delete cascade,
  qty             numeric(16, 3) not null default 0,
  avg_cost        numeric(16, 6) not null default 0 check (avg_cost >= 0),
  last_movement_at timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (business_id, product_id)
);

create index inventory_balances_low_stock_idx
  on public.inventory_balances (business_id, qty);

create table public.stock_movements (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete cascade,
  movement_type text not null check (movement_type in (
                  'opening', 'purchase', 'sale', 'sale_return',
                  'purchase_return', 'damaged', 'expired', 'wastage',
                  'adjustment', 'count')),
  qty_change   numeric(16, 3) not null check (qty_change <> 0),
  qty_after    numeric(16, 3) not null,
  unit_cost    numeric(16, 6) not null default 0 check (unit_cost >= 0),
  source_type  text,
  source_id    uuid,
  counterparty_type text check (counterparty_type in ('supplier', 'hawker')),
  counterparty_id   uuid,
  user_id      uuid references auth.users (id),
  notes        text,
  created_at   timestamptz not null default now()
);

create index stock_movements_product_idx
  on public.stock_movements (business_id, product_id, created_at desc);
create index stock_movements_source_idx
  on public.stock_movements (source_type, source_id);

-- One movement per (source_type, source_id, product, movement_type) guard:
-- prevents a retried approval from moving the same stock twice.
create unique index stock_movements_source_unique_idx
  on public.stock_movements (source_type, source_id, product_id, movement_type)
  where source_id is not null;

create table public.stock_counts (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  count_date  date not null default current_date,
  notes       text,
  status      text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled')),
  created_by  uuid references auth.users (id),
  confirmed_by uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, count_date, status) -- at most one confirmed/draft count per day
);

create table public.stock_count_items (
  id           uuid primary key default gen_random_uuid(),
  count_id     uuid not null references public.stock_counts (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete cascade,
  counted_qty  numeric(16, 3) not null check (counted_qty >= 0),
  system_qty   numeric(16, 3) not null,
  diff_qty     numeric(16, 3) generated always as (counted_qty - system_qty) stored,
  notes        text,
  unique (count_id, product_id)
);

create table public.stock_adjustments (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  adjustment_type text not null check (adjustment_type in
                    ('damaged', 'expired', 'wastage', 'correction', 'other')),
  qty_change    numeric(16, 3) not null check (qty_change <> 0),
  reason        text not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'applied', 'rejected')),
  applied_movement_id uuid references public.stock_movements (id),
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index stock_adjustments_pending_idx
  on public.stock_adjustments (business_id, status);

-- Alert acknowledgements do NOT change stock, they only mute the UI flag.
create table public.stock_alert_acknowledgements (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  alert_kind    text not null check (alert_kind in ('low_stock', 'out_of_stock', 'expiry', 'slow_moving')),
  acknowledged_by uuid references auth.users (id),
  acknowledged_at timestamptz not null default now(),
  unique (business_id, product_id, alert_kind)
);

create or replace function public.set_inventory_balances_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger inventory_balances_updated_at
  before update on public.inventory_balances
  for each row execute function public.set_inventory_balances_updated_at();

create trigger stock_counts_updated_at
  before update on public.stock_counts
  for each row execute function public.set_updated_at();

create trigger stock_adjustments_updated_at
  before update on public.stock_adjustments
  for each row execute function public.set_updated_at();
