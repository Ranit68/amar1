-- ---------------------------------------------------------------------------
-- 015_seed.sql
-- Per-business defaults, applied by a trigger when a business row is created:
-- unit catalog entries (for pickers), cash accounts, default expense
-- categories, and a starter product category. All inserts are idempotent so
-- the function is safe to re-run.
-- ---------------------------------------------------------------------------

create or replace function public.seed_business_defaults(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Starter category so new products have somewhere to go.
  insert into public.categories (business_id, name, name_bn)
  values (p_business_id, 'General', 'সাধারণ')
  on conflict (business_id, name) do nothing;

  -- Unit picker entries (universal conversions already live in
  -- unit_dimensions/unit_aliases; this is only the per-business list).
  insert into public.units_catalog (business_id, unit, name_bn, kind) values
    (p_business_id, 'pcs',  'পিস',     'count'),
    (p_business_id, 'dozen','ডজন',    'count'),
    (p_business_id, 'kg',   'কেজি',    'mass'),
    (p_business_id, 'g',    'গ্রাম',    'mass'),
    (p_business_id, 'l',    'লিটার',   'volume'),
    (p_business_id, 'ml',   'মিলি',    'volume'),
    (p_business_id, 'bag',  'বস্তা',   'other'),
    (p_business_id, 'box',  'বাক্স',   'other')
  on conflict (business_id, unit) do nothing;

  -- Cash accounts: physical drawer, bank, and UPI (all start empty).
  insert into public.cash_accounts (business_id, name, kind, opening_balance, current_balance)
  values
    (p_business_id, 'Cash Drawer', 'cash', 0, 0),
    (p_business_id, 'Bank Account', 'bank', 0, 0),
    (p_business_id, 'UPI',          'upi',  0, 0)
  on conflict (business_id, name) do nothing;

  -- Expense categories used by the quick-entry screen.
  insert into public.expense_categories (business_id, name, name_bn, is_default) values
    (p_business_id, 'Rent',       'বাড়িভাড়া', false),
    (p_business_id, 'Salary',     'বেতন',      false),
    (p_business_id, 'Transport',  'যাতায়াত',   false),
    (p_business_id, 'Utilities',  'বিদ্যুৎ ও পানি', false),
    (p_business_id, 'Packaging',  'প্যাকেজিং', false),
    (p_business_id, 'Miscellaneous', 'বিবিধ',  true)
  on conflict (business_id, name) do nothing;
end;
$$;

create or replace function public.trg_seed_business_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_business_defaults(new.id);
  return new;
end;
$$;

create trigger businesses_seed_defaults
  after insert on public.businesses
  for each row execute function public.trg_seed_business_defaults();

-- Safety net for databases that already contain businesses (e.g. an earlier
-- manual insert). No-op on a fresh database.
do $$
declare
  b record;
begin
  for b in select id from public.businesses loop
    perform public.seed_business_defaults(b.id);
  end loop;
end $$;
