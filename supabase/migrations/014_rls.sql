-- ---------------------------------------------------------------------------
-- 014_rls.sql
-- Row Level Security. Clients (anon/authenticated) get SELECT-only policies
-- scoped to their business membership. ALL writes go through security definer
-- RPCs (table owner bypasses RLS) or the service role key server-side.
-- ---------------------------------------------------------------------------

-- Helper predicates are SECURITY DEFINER so policies never recurse into the
-- RLS of the tables they query.
create or replace function public.app_is_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.business_members m
     where m.business_id = p_business_id
       and m.user_id = public.app_user_id()
       and m.status = 'active'
  );
$$;

create or replace function public.app_is_count_member(p_count_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.stock_counts c
     where c.id = p_count_id
       and public.app_is_member(c.business_id)
  );
$$;

create or replace function public.app_shares_business_with(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.business_members m1
      join public.business_members m2 on m1.business_id = m2.business_id
     where m1.user_id = public.app_user_id()
       and m2.user_id = p_profile_id
       and m1.status = 'active'
       and m2.status = 'active'
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. No client-side write policies are defined on
-- purpose: a write that is not issued by a security-definer RPC or the
-- service role is rejected outright.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'businesses', 'profiles', 'business_members',
      'categories', 'units_catalog', 'products', 'product_aliases',
      'product_units', 'product_price_history',
      'suppliers', 'hawkers', 'hawker_transactions', 'supplier_transactions',
      'inventory_balances', 'stock_movements', 'stock_counts', 'stock_count_items',
      'stock_adjustments', 'stock_alert_acknowledgements',
      'bill_documents', 'ocr_jobs',
      'purchase_bills', 'purchase_items', 'sales_bills', 'sales_items',
      'sales_returns', 'purchase_returns',
      'cash_accounts', 'cash_transactions', 'customer_payments',
      'supplier_payments', 'payment_allocations',
      'expense_categories', 'expenses',
      'audit_logs', 'daily_closings',
      'unit_dimensions', 'unit_aliases'
    ])
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Tenant-scoped SELECT policies (business_id present).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'categories', 'units_catalog', 'products', 'product_aliases',
      'product_units', 'product_price_history',
      'suppliers', 'hawkers', 'hawker_transactions', 'supplier_transactions',
      'inventory_balances', 'stock_movements', 'stock_counts',
      'stock_adjustments', 'stock_alert_acknowledgements',
      'bill_documents', 'ocr_jobs',
      'purchase_bills', 'purchase_items', 'sales_bills', 'sales_items',
      'sales_returns', 'purchase_returns',
      'cash_accounts', 'cash_transactions', 'customer_payments',
      'supplier_payments', 'payment_allocations',
      'expense_categories', 'expenses', 'daily_closings'
    ])
  loop
    execute format(
      'create policy %I on public.%I for select using (public.app_is_member(business_id))',
      t || '_member_select', t
    );
  end loop;
end $$;

-- Core tables with bespoke policies.
create policy businesses_member_select on public.businesses
  for select using (public.app_is_member(id));

create policy business_members_member_select on public.business_members
  for select using (public.app_is_member(business_id));

create policy profiles_own_select on public.profiles
  for select using (id = public.app_user_id());

create policy profiles_comember_select on public.profiles
  for select using (public.app_shares_business_with(id));

-- stock_count_items has no business_id; scope via the parent count.
create policy stock_count_items_member_select on public.stock_count_items
  for select using (public.app_is_count_member(count_id));

-- Audit trail is permission-gated.
create policy audit_logs_permission_select on public.audit_logs
  for select using (public.app_can(business_id, 'audit.view'));

-- Global reference data: readable by any authenticated user, writable only
-- through server migrations / service role.
create policy unit_dimensions_authenticated_select on public.unit_dimensions
  for select using (public.app_user_id() is not null);

create policy unit_aliases_authenticated_select on public.unit_aliases
  for select using (public.app_user_id() is not null);

-- ---------------------------------------------------------------------------
-- Grants. Supabase already grants broad schema usage to its API roles; these
-- make the intent explicit and keep the PGLite harness in sync. No privileges
-- for role "anon": an unauthenticated caller sees nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  r text;
begin
  for r in select unnest(array['authenticated', 'app_client']) loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant usage on schema public to %I', r);
      execute format(
        'grant select on all tables in schema public to %I', r);
      execute format(
        'grant execute on all functions in schema public to %I', r);
      if exists (select 1 from pg_namespace where nspname = 'auth') then
        execute format('grant usage on schema auth to %I', r);
        execute format(
          'grant execute on all functions in schema auth to %I', r);
      end if;
    end if;
  end loop;
end $$;

-- Table owners (postgres / supabase_admin / service_role) are exempt from
-- RLS, so every security-definer RPC keeps working unchanged.
