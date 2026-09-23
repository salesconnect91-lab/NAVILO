begin;

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.last_company_id
      from public.user_profiles p
      join public.companies c on c.id = p.last_company_id
      where p.id = auth.uid()
        and p.is_active = true
        and c.status in ('trial','active')
        and (c.subscription_expires_at is null or c.subscription_expires_at > now())
        and (
          p.platform_role = 'super_admin'
          or exists (
            select 1 from public.company_memberships m
            where m.company_id = c.id
              and m.user_id = p.id
              and m.is_active = true
          )
        )
    ),
    (
      select c.id
      from public.companies c
      join public.user_profiles p on p.id = auth.uid() and p.is_active = true
      left join public.company_memberships m
        on m.company_id = c.id and m.user_id = p.id and m.is_active = true
      where c.status in ('trial','active')
        and (c.subscription_expires_at is null or c.subscription_expires_at > now())
        and (p.platform_role = 'super_admin' or m.id is not null)
      order by case when m.id is null then 1 else 0 end, coalesce(m.created_at, c.created_at) asc
      limit 1
    )
  );
$$;

create or replace function public.set_current_company(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
begin
  if v_uid is null then raise exception 'Authentication required.'; end if;

  select (p.platform_role = 'super_admin' and p.is_active)
    into v_is_owner
  from public.user_profiles p
  where p.id = v_uid;

  if coalesce(v_is_owner, false) then
    if not exists (
      select 1 from public.companies c
      where c.id = p_company_id
        and c.status in ('trial','active')
        and (c.subscription_expires_at is null or c.subscription_expires_at > now())
    ) then
      raise exception 'Company is not available for operational access.';
    end if;
  else
    if not exists (
      select 1
      from public.company_memberships m
      join public.companies c on c.id = m.company_id
      join public.user_profiles p on p.id = m.user_id
      where m.company_id = p_company_id
        and m.user_id = v_uid
        and m.is_active = true
        and p.is_active = true
        and c.status in ('trial','active')
        and (c.subscription_expires_at is null or c.subscription_expires_at > now())
    ) then
      raise exception 'You do not have access to this company.';
    end if;
  end if;

  update public.user_profiles
  set last_company_id = p_company_id, updated_at = now()
  where id = v_uid;

  return p_company_id;
end;
$$;

create or replace function public.has_module_permission(p_company_id uuid, p_module text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_permissions jsonb;
  v_override jsonb;
  v_current_company uuid;
begin
  v_current_company := public.current_company_id();
  if p_company_id is null or v_current_company is null or p_company_id <> v_current_company then
    return false;
  end if;

  if public.is_platform_owner() then return true; end if;
  if not public.has_company_access(p_company_id) then return false; end if;

  select m.role, m.permissions into v_role, v_permissions
  from public.company_memberships m
  where m.company_id = p_company_id and m.user_id = auth.uid() and m.is_active = true
  limit 1;

  v_override := v_permissions #> array[p_module, p_action];
  if v_override is not null then return (v_override #>> '{}')::boolean; end if;

  if v_role in ('company_owner','admin') then return true; end if;

  if p_action = 'view' then
    return case v_role
      when 'accounts' then p_module in ('accounting','reports','master')
      when 'sales' then p_module in ('sales','reports','master','inventory')
      when 'purchase' then p_module in ('purchase','reports','master','inventory')
      when 'store' then p_module in ('inventory','reports','master')
      when 'production' then p_module in ('production','inventory','reports','master')
      when 'viewer' then p_module in ('reports')
      else false end;
  end if;

  if p_action in ('create','edit') then
    return case v_role
      when 'accounts' then p_module = 'accounting'
      when 'sales' then p_module = 'sales'
      when 'purchase' then p_module = 'purchase'
      when 'store' then p_module = 'inventory'
      when 'production' then p_module = 'production'
      else false end;
  end if;

  if p_action = 'delete' then return false; end if;
  if p_action = 'post' then
    return case v_role
      when 'accounts' then p_module = 'accounting'
      when 'sales' then p_module = 'sales'
      when 'purchase' then p_module = 'purchase'
      when 'store' then p_module = 'inventory'
      when 'production' then p_module = 'production'
      else false end;
  end if;
  if p_action = 'print' then return p_module in ('accounting','sales','purchase','inventory','production','reports'); end if;
  return false;
end;
$$;

create or replace function public.assert_module_permission(p_module text, p_action text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if v_company is null then raise exception 'No active company selected.'; end if;
  if not public.has_module_permission(v_company, p_module, p_action) then
    raise exception 'Permission denied for % %.', p_module, p_action;
  end if;
end;
$$;

create or replace function public.company_legacy_owner_id(p_company_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select c.created_by from public.companies c where c.id = p_company_id),
    (select m.user_id from public.company_memberships m where m.company_id = p_company_id and m.role='company_owner' order by m.created_at asc limit 1),
    (select m.user_id from public.company_memberships m where m.company_id = p_company_id order by m.created_at asc limit 1)
  );
$$;

create or replace function public.legacy_data_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.company_legacy_owner_id(public.current_company_id());
$$;

create or replace function public.get_my_access_context()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'profile_active', coalesce(p.is_active, false),
    'platform_role', coalesce(p.platform_role, 'user'),
    'is_platform_owner', coalesce(p.platform_role = 'super_admin' and p.is_active, false),
    'current_company_id', public.current_company_id(),
    'companies', coalesce((
      select jsonb_agg(x.obj order by x.company_name)
      from (
        select c.name as company_name,
          jsonb_build_object(
            'company_id', c.id,
            'company_name', c.name,
            'company_code', c.code,
            'company_status', c.status,
            'subscription_expires_at', c.subscription_expires_at,
            'membership_role', coalesce(m.role, case when p.platform_role='super_admin' then 'company_owner' else null end),
            'membership_active', coalesce(m.is_active, p.platform_role='super_admin'),
            'permissions', coalesce(m.permissions, '{}'::jsonb),
            'access_allowed', (p.is_active and c.status in ('trial','active') and (c.subscription_expires_at is null or c.subscription_expires_at > now()) and (p.platform_role='super_admin' or coalesce(m.is_active,false)))
          ) as obj
        from public.companies c
        left join public.company_memberships m on m.company_id=c.id and m.user_id=auth.uid()
        where p.platform_role='super_admin' or m.user_id is not null
      ) x
    ), '[]'::jsonb)
  )
  from public.user_profiles p
  where p.id = auth.uid();
$$;

create or replace function public.tenant_stamp_company_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := public.current_company_id();
  v_owner uuid;
begin
  if v_company is null then raise exception 'No active company selected.'; end if;
  if new.company_id is null then new.company_id := v_company; end if;
  if new.company_id <> v_company then raise exception 'Cross-company write denied.'; end if;
  if not public.has_company_access(new.company_id) then raise exception 'Company access denied.'; end if;
  v_owner := public.company_legacy_owner_id(new.company_id);
  if v_owner is null then v_owner := auth.uid(); end if;
  new.user_id := v_owner;
  return new;
end;
$$;

create or replace function public.tenant_stamp_company_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := public.current_company_id();
begin
  if v_company is null then raise exception 'No active company selected.'; end if;
  if new.company_id is null then new.company_id := v_company; end if;
  if new.company_id <> v_company then raise exception 'Cross-company write denied.'; end if;
  if not public.has_company_access(new.company_id) then raise exception 'Company access denied.'; end if;
  return new;
end;
$$;

do $$
declare r record; v_has_user boolean;
begin
  for r in
    select m.table_name
    from public.tenant_table_modules m
    join information_schema.tables t
      on t.table_schema='public'
     and t.table_name=m.table_name
     and t.table_type='BASE TABLE'
  loop
    select exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=r.table_name and c.column_name='user_id') into v_has_user;
    execute format('drop trigger if exists tenant_context_stamp on public.%I', r.table_name);
    if v_has_user then
      execute format('create trigger tenant_context_stamp before insert or update on public.%I for each row execute function public.tenant_stamp_company_user()', r.table_name);
    else
      execute format('create trigger tenant_context_stamp before insert or update on public.%I for each row execute function public.tenant_stamp_company_only()', r.table_name);
    end if;
  end loop;
end $$;

alter table public.chart_of_accounts drop constraint if exists chart_of_accounts_user_code_key;
alter table public.account_mappings drop constraint if exists account_mappings_user_id_mapping_key_key;
create unique index if not exists ux_chart_of_accounts_company_code on public.chart_of_accounts(company_id, code) where company_id is not null;
create unique index if not exists ux_account_mappings_company_key on public.account_mappings(company_id, mapping_key) where company_id is not null;
create unique index if not exists ux_sales_orders_company_order_no on public.sales_orders(company_id, order_no) where company_id is not null and order_no is not null;
create unique index if not exists ux_journal_entries_company_entry_no on public.journal_entries(company_id, entry_no) where company_id is not null and entry_no is not null;
create unique index if not exists ux_warehouse_stock_company_location on public.warehouse_stock(company_id, item_id, warehouse_id, godown_id) where company_id is not null;

revoke all on function public.set_current_company(uuid) from public, anon;
grant execute on function public.set_current_company(uuid) to authenticated;
revoke all on function public.assert_module_permission(text,text) from public, anon;
grant execute on function public.assert_module_permission(text,text) to authenticated;
revoke all on function public.legacy_data_user_id() from public, anon;
grant execute on function public.legacy_data_user_id() to authenticated;

commit;