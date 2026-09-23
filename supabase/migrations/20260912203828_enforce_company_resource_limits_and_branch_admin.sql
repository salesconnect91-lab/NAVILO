create or replace function public.is_company_admin(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path=public,pg_temp
as $$
  select public.is_platform_owner() or exists (
    select 1 from public.company_memberships cm
    join public.user_profiles up on up.id=cm.user_id
    where cm.company_id=p_company_id
      and cm.user_id=auth.uid()
      and cm.is_active=true
      and cm.role in ('company_owner','admin')
      and up.is_active=true
  )
$$;
revoke all on function public.is_company_admin(uuid) from public,anon;
grant execute on function public.is_company_admin(uuid) to authenticated,service_role;

create or replace function public.company_resource_limits(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path=public,pg_temp
as $$
declare v jsonb;
begin
  if not (public.is_platform_owner() or public.has_company_access(p_company_id)) then
    raise exception 'Company access denied';
  end if;
  with s as (
    select sp.max_users,sp.max_business_units,sp.max_branches,sp.max_godowns
    from public.company_subscriptions cs
    join public.subscription_plans sp on sp.id=cs.plan_id
    where cs.company_id=p_company_id and cs.status in ('trial','active')
      and (cs.expires_at is null or cs.expires_at>now())
    order by cs.starts_at desc nulls last,cs.created_at desc limit 1
  ), c as (
    select max_users,max_business_units,max_branches,max_godowns from public.companies where id=p_company_id
  )
  select jsonb_build_object(
    'max_users',coalesce(c.max_users,s.max_users),
    'max_business_units',coalesce(c.max_business_units,s.max_business_units),
    'max_branches',coalesce(c.max_branches,s.max_branches),
    'max_godowns',coalesce(c.max_godowns,s.max_godowns)
  ) into v from c left join s on true;
  return coalesce(v,'{}'::jsonb);
end$$;

create or replace function public.enforce_company_resource_limit()
returns trigger
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare v_limit integer; v_count integer; v_company uuid; v_resource text; v_active boolean := true;
begin
  if tg_table_name='company_memberships' then v_company:=new.company_id; v_resource:='max_users'; v_active:=coalesce(new.is_active,true);
  elsif tg_table_name='business_units' then v_company:=new.company_id; v_resource:='max_business_units'; v_active:=coalesce(new.is_active,true);
  elsif tg_table_name='operating_locations' then v_company:=new.company_id; v_resource:='max_branches'; v_active:=coalesce(new.is_active,true);
  elsif tg_table_name='godowns' then v_company:=new.company_id; v_resource:='max_godowns'; v_active:=true;
  else return new; end if;
  if not v_active then return new; end if;

  select case v_resource
    when 'max_users' then coalesce(c.max_users,sp.max_users)
    when 'max_business_units' then coalesce(c.max_business_units,sp.max_business_units)
    when 'max_branches' then coalesce(c.max_branches,sp.max_branches)
    when 'max_godowns' then coalesce(c.max_godowns,sp.max_godowns)
  end into v_limit
  from public.companies c
  left join lateral (
    select p.max_users,p.max_business_units,p.max_branches,p.max_godowns
    from public.company_subscriptions s join public.subscription_plans p on p.id=s.plan_id
    where s.company_id=c.id and s.status in ('trial','active') and (s.expires_at is null or s.expires_at>now())
    order by s.starts_at desc nulls last,s.created_at desc limit 1
  ) sp on true where c.id=v_company;

  if v_limit is null then return new; end if;

  if tg_table_name='company_memberships' then
    select count(*) into v_count from public.company_memberships x where x.company_id=v_company and x.is_active=true and (tg_op='INSERT' or x.id<>new.id);
  elsif tg_table_name='business_units' then
    select count(*) into v_count from public.business_units x where x.company_id=v_company and x.is_active=true and (tg_op='INSERT' or x.id<>new.id);
  elsif tg_table_name='operating_locations' then
    select count(*) into v_count from public.operating_locations x where x.company_id=v_company and x.is_active=true and (tg_op='INSERT' or x.id<>new.id);
  else
    select count(*) into v_count from public.godowns x where x.company_id=v_company and (tg_op='INSERT' or x.id<>new.id);
  end if;

  if v_count >= v_limit then
    raise exception '% limit reached for this company (% allowed)', replace(v_resource,'max_',''), v_limit using errcode='P0001';
  end if;
  return new;
end$$;

drop trigger if exists trg_limit_company_memberships on public.company_memberships;
create trigger trg_limit_company_memberships before insert or update of is_active,company_id on public.company_memberships for each row execute function public.enforce_company_resource_limit();
drop trigger if exists trg_limit_business_units on public.business_units;
create trigger trg_limit_business_units before insert or update of is_active,company_id on public.business_units for each row execute function public.enforce_company_resource_limit();
drop trigger if exists trg_limit_operating_locations on public.operating_locations;
create trigger trg_limit_operating_locations before insert or update of is_active,company_id on public.operating_locations for each row execute function public.enforce_company_resource_limit();
drop trigger if exists trg_limit_godowns on public.godowns;
create trigger trg_limit_godowns before insert or update of company_id on public.godowns for each row execute function public.enforce_company_resource_limit();

drop policy if exists operating_locations_scope on public.operating_locations;
create policy operating_locations_select on public.operating_locations for select to authenticated using (public.is_platform_owner() or public.has_company_access(company_id));
create policy operating_locations_insert on public.operating_locations for insert to authenticated with check (company_id=public.current_company_id() and public.is_company_admin(company_id));
create policy operating_locations_update on public.operating_locations for update to authenticated using (public.is_company_admin(company_id)) with check (company_id=public.current_company_id() and public.is_company_admin(company_id));
create policy operating_locations_delete on public.operating_locations for delete to authenticated using (public.is_platform_owner());
