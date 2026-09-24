-- Deny direct RPC access when the active BU lacks membership or module entitlement.
create or replace function public.has_module_permission(p_company_id uuid,p_module text,p_action text)
returns boolean
language plpgsql stable security definer
set search_path=public,pg_temp
as $$
declare
  v_role text;
  v_permissions jsonb;
  v_override jsonb;
  v_action text:=coalesce(nullif(p_action,''),'view');
  v_bu uuid:=public.current_business_unit_id();
begin
  if p_company_id is null or p_company_id<>public.current_company_id() then return false; end if;
  if not public.company_module_enabled(p_company_id,p_module) and p_module<>'dashboard' then return false; end if;
  if public.is_platform_owner() then return true; end if;
  if not public.has_company_access(p_company_id) then return false; end if;
  if v_bu is null and p_module<>'dashboard' then return false; end if;
  if v_bu is not null and not exists (
    select 1 from public.business_unit_modules bum
    join public.business_units bu on bu.id=bum.business_unit_id
    where bum.company_id=p_company_id and bum.business_unit_id=v_bu
      and bu.company_id=p_company_id and bu.is_active
      and bum.module_key=p_module and bum.enabled
  ) and p_module<>'dashboard' then return false; end if;

  if v_bu is not null then
    select bm.role,bm.permissions into v_role,v_permissions
    from public.business_unit_memberships bm
    join public.business_units bu on bu.id=bm.business_unit_id and bu.company_id=bm.company_id and bu.is_active
    where bm.company_id=p_company_id and bm.business_unit_id=v_bu and bm.user_id=auth.uid() and bm.is_active limit 1;
  end if;
  if v_bu is not null and v_role is null then return false; end if;
  if v_role is null then
    select cm.role,cm.permissions into v_role,v_permissions from public.company_memberships cm
    where cm.company_id=p_company_id and cm.user_id=auth.uid() and cm.is_active limit 1;
  end if;
  if v_role is null then return false; end if;
  v_override:=v_permissions#>array[p_module,v_action];
  if v_override is not null then return (v_override#>>'{}')::boolean; end if;
  if v_role in ('company_owner','admin') then return true; end if;

  if v_action in ('view','print','export') then
    return case v_role
      when 'accounts' then p_module in ('dashboard','accounting','reports','master')
      when 'sales' then p_module in ('dashboard','sales','reports','master','inventory')
      when 'purchase' then p_module in ('dashboard','purchase','reports','master','inventory')
      when 'store' then p_module in ('dashboard','inventory','reports','master')
      when 'production' then p_module in ('dashboard','production','inventory','reports','master')
      when 'transport' then p_module in ('dashboard','transport','accounting','reports','master','settings')
      when 'viewer' then p_module in ('dashboard','reports')
      else false end;
  end if;
  if v_action='delete' then return false; end if;
  if v_action in ('create','edit','post') then
    return case v_role
      when 'accounts' then p_module='accounting'
      when 'sales' then p_module='sales'
      when 'purchase' then p_module='purchase'
      when 'store' then p_module='inventory'
      when 'production' then p_module='production'
      when 'transport' then p_module='transport'
      else false end;
  end if;
  return false;
end$$;
revoke all on function public.has_module_permission(uuid,text,text) from public,anon;
grant execute on function public.has_module_permission(uuid,text,text) to authenticated,service_role;
