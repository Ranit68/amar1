-- ---------------------------------------------------------------------------
-- 002_core.sql
-- Tenancy: businesses, user profiles, membership + roles.
-- ---------------------------------------------------------------------------

create table public.businesses (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 160),
  currency      text not null default 'INR' check (currency = 'INR'),
  timezone      text not null default 'Asia/Kolkata',
  locale        text not null default 'bn' check (locale in ('bn', 'en')),
  settings      jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  phone       text,
  locale      text not null default 'bn' check (locale in ('bn', 'en')),
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.business_members (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  role               text not null check (role in ('owner', 'manager', 'staff')),
  member_permissions text[] not null default array[]::text[],
  status             text not null default 'active' check (status in ('active', 'suspended', 'removed')),
  invited_by         uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (business_id, user_id)
);

create index business_members_user_idx on public.business_members (user_id);

-- A business must have at least one owner: enforced by trigger after write.
create or replace function public.enforce_single_tenant_sanity()
returns trigger
language plpgsql
as $$
begin
  if new.role <> 'owner' then
    if not exists (
      select 1 from public.business_members
      where business_id = new.business_id
        and role = 'owner'
        and status = 'active'
        and id <> new.id
    ) then
      raise exception 'A business must keep at least one active owner';
    end if;
  end if;
  return new;
end;
$$;

create trigger business_members_owner_guard
  before insert or update of role, status on public.business_members
  for each row execute function public.enforce_single_tenant_sanity();

create or replace function public.set_businesses_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger businesses_updated_at
  before update on public.businesses
  for each row execute function public.set_businesses_updated_at();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger business_members_updated_at
  before update on public.business_members
  for each row execute function public.set_updated_at();
