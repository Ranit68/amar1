-- ---------------------------------------------------------------------------
-- 016_rpcs_tenancy.sql
-- Tenancy RPCs: profile provisioning and business creation.
-- All writes are performed by security-definer functions; RLS stays SELECT-only.
-- ---------------------------------------------------------------------------

-- Auto-provision a profile row whenever a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Create a business and make the caller its owner. Seeds defaults via trigger.
create or replace function public.create_business(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := public.app_user_id();
  v_business_id uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 1 then
    raise exception 'BUSINESS_NAME_REQUIRED';
  end if;

  insert into public.profiles (id, full_name)
  values (v_uid, '')
  on conflict (id) do nothing;

  insert into public.businesses (name)
  values (trim(p_name))
  returning id into v_business_id;

  insert into public.business_members (business_id, user_id, role)
  values (v_business_id, v_uid, 'owner');

  perform public.write_audit(
    v_business_id, 'business.create', 'businesses', v_business_id,
    null, jsonb_build_object('name', trim(p_name))
  );

  return v_business_id;
end;
$$;

grant execute on function public.create_business(text) to authenticated;
