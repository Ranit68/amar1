-- ---------------------------------------------------------------------------
-- 003_catalog.sql
-- Categories, unit catalog + conversion rules, products, aliases,
-- price history.
-- ---------------------------------------------------------------------------

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null,
  name_bn     text,
  parent_id   uuid references public.categories (id),
  created_at  timestamptz not null default now(),
  unique (business_id, name)
);

-- Unit names this business may use. Factors are product-specific and live in
-- product_units; only universally convertible units (mass / volume / count)
-- get their factor from the static unit_dimensions table below.
create table public.units_catalog (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  unit        text not null check (unit = public.norm_text(unit) and char_length(unit) > 0),
  name_bn     text,
  kind        text not null default 'count' check (kind in ('count', 'mass', 'volume', 'other')),
  created_at  timestamptz not null default now(),
  unique (business_id, unit)
);

-- Canonical dimensions for units that convert universally.
-- 1 unit = factor canonical units of the dimension.
create table public.unit_dimensions (
  unit       text primary key,
  dimension  text not null check (dimension in ('count', 'mass', 'volume')),
  factor     numeric(18, 9) not null check (factor > 0)
);

insert into public.unit_dimensions (unit, dimension, factor) values
  ('piece',   'count', 1),
  ('pcs',     'count', 1),
  ('pieces',  'count', 1),
  ('dozen',   'count', 12),
  ('pair',    'count', 2),
  ('g',       'mass',  1),
  ('gram',    'mass',  1),
  ('grams',   'mass',  1),
  ('kg',      'mass',  1000),
  ('kilo',    'mass',  1000),
  ('kilogram','mass',  1000),
  ('ml',      'volume', 1),
  ('millilitre', 'volume', 1),
  ('l',       'volume', 1000),
  ('ltr',     'volume', 1000),
  ('litre',   'volume', 1000);

-- Alias -> canonical unit name (covers Bengali and common spellings).
create table public.unit_aliases (
  alias      text primary key,
  unit       text not null references public.unit_dimensions (unit) on update cascade
);

insert into public.unit_aliases (alias, unit) values
  ('pcs', 'piece'), ('pc', 'piece'), ('piece', 'piece'), ('pieces', 'piece'),
  ('dozon', 'dozen'), ('dozen', 'dozen'), ('dz', 'dozen'),
  ('kg', 'kg'), ('kgs', 'kg'), ('kilo', 'kg'), ('kilos', 'kg'), ('কেজি', 'kg'), ('কিলো', 'kg'),
  ('g', 'g'), ('gm', 'g'), ('gms', 'g'), ('gram', 'g'), ('grams', 'g'), ('গ্রাম', 'g'),
  ('l', 'l'), ('ltr', 'l'), ('lt', 'l'), ('litre', 'l'), ('litres', 'l'), ('লিটার', 'l'),
  ('ml', 'ml'), ('মিলি', 'ml'),
  ('পিস', 'piece'), ('ডজন', 'dozen'), ('জোড়া', 'pair');

-- Normalizes any unit spelling to its canonical name (identity when unknown
-- so product-specific units like 'carton' pass through untouched).
create or replace function public.canon_unit(u text)
returns text
language sql
immutable
as $$
  select coalesce(
    (select a.unit from public.unit_aliases a
      where a.alias = public.norm_text(coalesce(u, '')) limit 1),
    public.norm_text(coalesce(u, ''))
  );
$$;

create table public.products (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  sku            text not null,
  name           text not null,
  name_bn        text,
  name_en        text,
  brand          text,
  category_id    uuid references public.categories (id),
  barcode        text,
  base_unit      text not null default 'piece',
  purchase_unit  text not null default 'piece',
  sell_unit      text not null default 'piece',
  min_stock      numeric(14, 3) not null default 0 check (min_stock >= 0),
  max_stock      numeric(14, 3),
  track_expiry   boolean not null default false,
  track_batch    boolean not null default false,
  is_active      boolean not null default true,
  notes          text,
  name_norm      text generated always as (public.norm_text(name)) stored,
  name_bn_norm   text generated always as (public.norm_text(name_bn)) stored,
  name_en_norm   text generated always as (public.norm_text(name_en)) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (max_stock is null or max_stock >= min_stock)
);

create unique index products_business_sku_idx on public.products (business_id, sku);
create unique index products_business_barcode_idx on public.products (business_id, barcode)
  where barcode is not null;
create index products_name_norm_idx on public.products (business_id, name_norm);
create index products_name_bn_norm_idx on public.products (business_id, name_bn_norm);
create index products_category_idx on public.products (category_id);
create index products_active_idx on public.products (business_id) where is_active;

create trigger products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Aliases: every alternate name a product is known by.
-- ---------------------------------------------------------------------------
create table public.product_aliases (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete cascade,
  alias        text not null,
  alias_norm   text generated always as (public.norm_text(alias)) stored,
  language     text not null default 'other' check (language in ('bn', 'en', 'other')),
  alias_type   text not null default 'other' check (alias_type in (
                 'bengali_name', 'english_name', 'local_shop_name',
                 'supplier_name', 'brand_abbreviation', 'spelling_variation',
                 'other')),
  supplier_id  uuid,
  source       text,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now()
);

create unique index product_aliases_unique_idx
  on public.product_aliases (product_id, alias_norm);
create index product_aliases_norm_idx
  on public.product_aliases (business_id, alias_norm);
create index product_aliases_supplier_idx
  on public.product_aliases (supplier_id) where supplier_id is not null;

-- ---------------------------------------------------------------------------
-- Product-specific unit conversions: 1 <unit> = <factor_to_base> base units.
-- Takes precedence over the universal unit_dimensions table.
-- ---------------------------------------------------------------------------
create table public.product_units (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  product_id     uuid not null references public.products (id) on delete cascade,
  unit           text not null,
  unit_norm      text generated always as (public.norm_text(unit)) stored,
  factor_to_base numeric(18, 6) not null check (factor_to_base > 0),
  created_at     timestamptz not null default now(),
  unique (product_id, unit_norm)
);

create index product_units_business_idx on public.product_units (business_id);

-- ---------------------------------------------------------------------------
-- Resolve the multiplier from a sale/purchase unit to the product's base
-- inventory unit. Raises when the conversion is genuinely unknown - the user
-- must configure it instead of the system guessing.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_unit_factor(
  p_product_id uuid,
  p_unit text
)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
  v_unit text := public.canon_unit(p_unit);
  v_factor numeric;
  v_base_dim record;
  v_unit_dim record;
begin
  if v_unit is null or v_unit = '' then
    raise exception 'MISSING_UNIT: no unit supplied for product %', p_product_id;
  end if;

  select base_unit into v_base from public.products where id = p_product_id;
  if v_base is null then
    raise exception 'UNKNOWN_PRODUCT: %', p_product_id;
  end if;

  if public.canon_unit(v_base) = v_unit or v_base = p_unit then
    return 1;
  end if;

  select factor_to_base into v_factor
    from public.product_units
   where product_id = p_product_id and unit_norm = public.norm_text(v_unit);
  if v_factor is not null then
    return v_factor;
  end if;

  select * into v_base_dim from public.unit_dimensions where unit = public.canon_unit(v_base);
  select * into v_unit_dim from public.unit_dimensions where unit = v_unit;

  if v_base_dim.unit is not null and v_unit_dim.unit is not null then
    if v_base_dim.dimension <> v_unit_dim.dimension then
      raise exception 'INCOMPATIBLE_UNIT: cannot convert % (%) to base unit % (%)',
        p_unit, v_unit_dim.dimension, v_base, v_base_dim.dimension;
    end if;
    return v_unit_dim.factor / v_base_dim.factor;
  end if;

  raise exception 'UNKNOWN_UNIT_CONVERSION: configure "%" for product % (base unit %)',
    p_unit, p_product_id, v_base;
end;
$$;

-- ---------------------------------------------------------------------------
-- Purchase / selling price history (never overwritten, only appended).
-- ---------------------------------------------------------------------------
create table public.product_price_history (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete cascade,
  price_type   text not null check (price_type in ('purchase', 'sale')),
  unit         text not null,
  price        numeric(14, 2) not null check (price >= 0),
  supplier_id  uuid,
  source_ref   text,
  effective_at timestamptz not null default now(),
  created_by   uuid references auth.users (id)
);

create index product_price_history_lookup_idx
  on public.product_price_history (product_id, price_type, effective_at desc);
