-- ---------------------------------------------------------------------------
-- 019_rpcs_admin_and_counts.sql
-- Settings & administration:
--   * update_business      - edit business name / locale (settings.manage)
--   * invite_member        - add an existing user to a business (users.manage)
--   * create_stock_count   - open a draft stock count from counted quantities
--                           (inventory.write); confirm_stock_count applies it.
-- ---------------------------------------------------------------------------

-- Status 'pending' is used by invite_member before the invite is activated.
alter table public.business_members
  drop constraint business_members_status_check,
  add constraint business_members_status_check
    check (status in ('active', 'pending', 'suspended', 'removed'));

-- ============================ update_business =============================
create or replace function public.update_business(
  p_business_id uuid,
  p_name text default null,
  p_locale text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name   text := nullif(trim(coalesce(p_name, '')), '');
  v_locale text := coalesce(p_locale, null);
begin
  perform public.app_assert_can(p_business_id, 'settings.manage');

  if v_name is not null and char_length(v_name) > 160 then
    raise exception 'INVALID_NAME: name must be at most 160 characters';
  end if;
  if v_locale is not null and v_locale not in ('bn', 'en') then
    raise exception 'INVALID_LOCALE: %', v_locale;
  end if;

  update public.businesses
     set name   = coalesce(v_name, name),
         locale = coalesce(v_locale, locale)
   where id = p_business_id
     and is_active;

  if not found then
    raise exception 'UNKNOWN_BUSINESS: %', p_business_id;
  end if;

  perform public.write_audit(p_business_id, 'business.updated', 'businesses', p_business_id,
    jsonb_build_object('name', v_name, 'locale', v_locale), null);

  return jsonb_build_object('business_id', p_business_id, 'updated', true);
end;
$$;

-- ============================ invite_member ===============================
create or replace function public.invite_member(
  p_business_id uuid,
  p_email text,
  p_role text default 'staff'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid;
  v_member  uuid;
  v_status  text;
  v_email   text := lower(nullif(trim(p_email), ''));
  v_dupe_name text;
begin
  perform public.app_assert_can(p_business_id, 'users.manage');

  if v_email is null then
    raise exception 'INVALID_PAYLOAD: email required';
  end if;
  if p_role not in ('owner', 'manager', 'staff') then
    raise exception 'INVALID_ROLE: %', p_role;
  end if;

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is null then
    raise exception 'USER_NOT_FOUND: no account exists for %', v_email;
  end if;

  select id, status into v_member, v_status
    from public.business_members
   where business_id = p_business_id and user_id = v_user;
  if found then
    if v_status = 'removed' then
      update public.business_members
         set role = p_role, status = 'pending',
             invited_by = public.app_user_id(), updated_at = now()
       where id = v_member;
      return jsonb_build_object('member_id', v_member, 'user_id', v_user,
        'email', v_email, 'status', 'pending', 'reactivated', true);
    end if;
    raise exception 'ALREADY_MEMBER: user is already a % member (status %)', v_status, v_status;
  end if;

  begin
    insert into public.business_members
      (business_id, user_id, role, status, invited_by)
    values
      (p_business_id, v_user, p_role, 'pending', public.app_user_id())
    returning id into v_member;
  exception when unique_violation then
    raise exception 'ALREADY_MEMBER: user already belongs to this business';
  end;

  select name into v_dupe_name from public.businesses where id = p_business_id;

  perform public.write_audit(p_business_id, 'member.invited', 'business_members', v_member,
    jsonb_build_object('user_id', v_user, 'email', v_email, 'role', p_role), null);

  return jsonb_build_object('member_id', v_member, 'user_id', v_user,
    'email', v_email, 'role', p_role, 'status', 'pending', 'reactivated', false);
end;
$$;

-- =========================== create_stock_count ===========================
create or replace function public.create_stock_count(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_date     date := coalesce(nullif(p_payload->>'count_date', '')::date, current_date);
  v_notes    text := p_payload->>'notes';
  v_items    jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  v_count    uuid;
  v_lines    jsonb := '[]'::jsonb;
  e          record;
  v_product  uuid;
  v_counted  numeric;
  v_system   numeric;
  v_pkey     integer := 0;
begin
  perform public.app_assert_can(v_business, 'inventory.write');

  if jsonb_array_length(v_items) = 0 then
    raise exception 'INVALID_PAYLOAD: at least one item is required';
  end if;

  for e in select elem from jsonb_array_elements(v_items) as t(elem)
  loop
    v_product := (e.elem->>'product_id')::uuid;
    v_counted := (e.elem->>'counted_qty')::numeric;
    if v_product is null or v_counted is null or v_counted < 0 then
      raise exception 'INVALID_PAYLOAD: product_id and counted_qty >= 0 required';
    end if;
    perform 1 from public.products
     where id = v_product and business_id = v_business;
    if not found then
      raise exception 'UNKNOWN_PRODUCT: %', v_product;
    end if;

    select qty into v_system from public.inventory_balances
     where business_id = v_business and product_id = v_product for update;
    v_system := coalesce(v_system, 0);

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'idx', v_pkey,
      'product_id', v_product,
      'counted_qty', v_counted,
      'system_qty', v_system,
      'diff_qty', round(v_counted - v_system, 3)
    ));
    v_pkey := v_pkey + 1;
  end loop;

  begin
    insert into public.stock_counts
      (business_id, count_date, notes, status, created_by)
    values
      (v_business, v_date, v_notes, 'draft', public.app_user_id())
    returning id into v_count;
  exception when unique_violation then
    raise exception 'DUPLICATE_COUNT: a draft count already exists for this date';
  end;

  for e in select elem from jsonb_array_elements(v_lines) as t(elem)
  loop
    insert into public.stock_count_items
      (count_id, product_id, counted_qty, system_qty, notes)
    values
      (v_count, (e.elem->>'product_id')::uuid,
       (e.elem->>'counted_qty')::numeric,
       (e.elem->>'system_qty')::numeric,
       nullif(p_payload->>'notes', '')::text);
  end loop;

  perform public.write_audit(v_business, 'inventory.count_created', 'stock_counts', v_count,
    jsonb_build_object('lines', v_pkey), jsonb_build_object('notes', v_notes));

  return jsonb_build_object('count_id', v_count, 'items', v_lines);
end;
$$;

grant execute on function public.update_business(uuid, text, text) to authenticated;
grant execute on function public.invite_member(uuid, text, text) to authenticated;
grant execute on function public.create_stock_count(jsonb) to authenticated;