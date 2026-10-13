-- ---------------------------------------------------------------------------
-- 001_extensions_and_helpers.sql
-- Extensions, identity helpers, permission model, shared utility functions.
-- Runs on Supabase (PostgreSQL 15+) and in the PGLite test harness.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- auth schema shim is provided by Supabase; the test harness creates an
-- equivalent minimal shim (auth.users + auth.uid()) before applying
-- migrations. Nothing to do here for that.

-- Shared schema for helper functions used by RLS policies and RPCs.
create schema if not exists public;

-- ---------------------------------------------------------------------------
-- Text normalization used for alias / product-name matching.
-- Must be IMMUTABLE so it can be used in GENERATED columns.
--   - lowercases (Bengali has no case, English does)
--   - strips punctuation and symbols, keeps letters and digits of any script
--   - collapses whitespace
-- ---------------------------------------------------------------------------
create or replace function public.norm_text(t text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(
    regexp_replace(
      regexp_replace(lower(coalesce(t, '')), '[^[:alnum:]\u0980-\u09FF]+', ' ', 'g'),
      '\s+', ' ', 'g'
    )
  );
$$;

-- Bengali/Arabic digit -> ASCII digit. Used by the OCR parser (app side) and
-- available to SQL for validation of extracted values. IMMUTABLE.
create or replace function public.ascii_digits(t text)
returns text
language sql
immutable
parallel safe
as $$
  select translate(coalesce(t, ''),
    '০১২৩৪৫৬৭৮৯٠١٢٣٤٥٦٧٨٩',
    '01234567890123456789');
$$;

-- ---------------------------------------------------------------------------
-- Identity
--   On Supabase: auth.uid() (JWT subject).
--   In tests:    redefined to read the GUC 'app.current_user_id'.
-- ---------------------------------------------------------------------------
create or replace function public.app_current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;

-- Fallback identity used by policies: prefers auth.uid() when present.
create or replace function public.app_user_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    case when to_regprocedure('auth.uid()') is not null then auth.uid() end,
    nullif(current_setting('app.current_user_id', true), '')::uuid
  );
$$;

-- ---------------------------------------------------------------------------
-- Roles and permissions
--   owner   -> everything
--   manager -> everything except settings.manage / users.manage
--   staff   -> only explicit grants in business_members.member_permissions
-- ---------------------------------------------------------------------------
create or replace function public.app_all_permissions()
returns text[]
language sql
immutable
as $$
  select array[
    'dashboard.view', 'reports.view', 'products.write', 'inventory.write',
    'suppliers.write', 'purchases.post', 'hawkers.write', 'sales.post',
    'payments.post', 'expenses.post', 'scanner.use', 'closing.post',
    'analytics.view', 'alerts.manage', 'audit.view', 'settings.manage',
    'users.manage'
  ];
$$;

create or replace function public.app_default_role_permissions(p_role text)
returns text[]
language sql
immutable
as $$
  select case p_role
    when 'owner'   then public.app_all_permissions()
    when 'manager' then array[
      'dashboard.view', 'reports.view', 'products.write', 'inventory.write',
      'suppliers.write', 'purchases.post', 'hawkers.write', 'sales.post',
      'payments.post', 'expenses.post', 'scanner.use', 'closing.post',
      'analytics.view', 'alerts.manage', 'audit.view'
    ]
    else array[]::text[]
  end;
$$;

-- Effective permissions of a user inside one business.
-- plpgsql so the body is validated lazily (business_members may not exist
-- yet when this file runs in a fresh database).
create or replace function public.app_permissions(p_business_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_perms text[];
begin
  select public.app_default_role_permissions(m.role)
         || coalesce(m.member_permissions, array[]::text[])
    into v_perms
    from public.business_members m
   where m.business_id = p_business_id
     and m.user_id = public.app_user_id()
     and m.status = 'active'
   limit 1;
  return coalesce(v_perms, array[]::text[]);
end;
$$;

create or replace function public.app_can(p_business_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_permission = any(public.app_permissions(p_business_id));
$$;

create or replace function public.app_assert_can(p_business_id uuid, p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.app_user_id() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if not public.app_can(p_business_id, p_permission) then
    raise exception 'FORBIDDEN: permission % required', p_permission;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit trail helper (callable from RPCs and triggers).
-- ---------------------------------------------------------------------------
create or replace function public.write_audit(
  p_business_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb default null,
  p_after jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_logs (business_id, user_id, action, entity_type, entity_id, before, after)
  values (p_business_id, public.app_user_id(), p_action, p_entity_type, p_entity_id, p_before, p_after);
end;
$$;
