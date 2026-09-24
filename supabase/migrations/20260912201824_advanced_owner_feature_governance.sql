create table if not exists public.platform_features (
  feature_key text primary key,
  module_key text not null,
  label text not null,
  category text not null default 'feature',
  route_pattern text,
  description text,
  supported_actions text[] not null default array['view']::text[],
  business_unit_types text[],
  default_enabled boolean not null default true,
  core_locked boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  source text not null default 'registry',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_feature_entitlements (
  company_id uuid not null references public.companies(id) on delete cascade,
  feature_key text not null references public.platform_features(feature_key) on delete cascade,
  enabled boolean not null default true,
  action_overrides jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (company_id, feature_key),
  constraint company_feature_action_overrides_object check (jsonb_typeof(action_overrides)='object')
);

create table if not exists public.business_unit_feature_entitlements (
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  feature_key text not null references public.platform_features(feature_key) on delete cascade,
  enabled boolean not null default true,
  action_overrides jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (business_unit_id, feature_key),
  constraint business_unit_feature_action_overrides_object check (jsonb_typeof(action_overrides)='object')
);

create index if not exists idx_company_feature_entitlements_company on public.company_feature_entitlements(company_id);
create index if not exists idx_business_unit_feature_entitlements_unit on public.business_unit_feature_entitlements(business_unit_id);

alter table public.platform_features enable row level security;
alter table public.company_feature_entitlements enable row level security;
alter table public.business_unit_feature_entitlements enable row level security;

drop policy if exists platform_features_read on public.platform_features;
create policy platform_features_read on public.platform_features for select to authenticated using (true);
drop policy if exists platform_features_owner_write on public.platform_features;
create policy platform_features_owner_write on public.platform_features for all to authenticated using (public.is_platform_owner()) with check (public.is_platform_owner());

drop policy if exists company_feature_entitlements_read on public.company_feature_entitlements;
create policy company_feature_entitlements_read on public.company_feature_entitlements for select to authenticated using (public.is_platform_owner() or public.has_company_access(company_id));
drop policy if exists company_feature_entitlements_owner_write on public.company_feature_entitlements;
create policy company_feature_entitlements_owner_write on public.company_feature_entitlements for all to authenticated using (public.is_platform_owner()) with check (public.is_platform_owner());

drop policy if exists business_unit_feature_entitlements_read on public.business_unit_feature_entitlements;
create policy business_unit_feature_entitlements_read on public.business_unit_feature_entitlements for select to authenticated using (
  public.is_platform_owner() or exists (
    select 1 from public.business_unit_memberships bm
    where bm.business_unit_id=business_unit_feature_entitlements.business_unit_id
      and bm.user_id=auth.uid() and bm.is_active
  )
);
drop policy if exists business_unit_feature_entitlements_owner_write on public.business_unit_feature_entitlements;
create policy business_unit_feature_entitlements_owner_write on public.business_unit_feature_entitlements for all to authenticated using (public.is_platform_owner()) with check (public.is_platform_owner());

grant select on public.platform_features, public.company_feature_entitlements, public.business_unit_feature_entitlements to authenticated;
grant insert,update,delete on public.platform_features, public.company_feature_entitlements, public.business_unit_feature_entitlements to authenticated;

create or replace function public.sync_platform_feature_catalog(p_features jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_item jsonb; v_count integer:=0;
begin
  if not public.is_platform_owner() then raise exception 'Platform Owner access required.'; end if;
  if p_features is null or jsonb_typeof(p_features)<>'array' then raise exception 'Feature catalog must be an array.'; end if;
  for v_item in select value from jsonb_array_elements(p_features) loop
    if coalesce(trim(v_item->>'feature_key'),'')='' or coalesce(trim(v_item->>'module_key'),'')='' then raise exception 'Feature key and module key are required.'; end if;
    insert into public.platform_features(feature_key,module_key,label,category,route_pattern,description,supported_actions,business_unit_types,default_enabled,core_locked,sort_order,is_active,source,updated_at)
    values(
      trim(v_item->>'feature_key'), trim(v_item->>'module_key'), coalesce(nullif(trim(v_item->>'label'),''),trim(v_item->>'feature_key')),
      coalesce(nullif(trim(v_item->>'category'),''),'feature'), nullif(trim(v_item->>'route_pattern'),''), nullif(trim(v_item->>'description'),''),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'supported_actions','["view"]'::jsonb))),array['view']::text[]),
      case when jsonb_typeof(v_item->'business_unit_types')='array' then array(select jsonb_array_elements_text(v_item->'business_unit_types')) else null end,
      coalesce((v_item->>'default_enabled')::boolean,true), coalesce((v_item->>'core_locked')::boolean,false), coalesce((v_item->>'sort_order')::integer,0), true,'registry',now()
    )
    on conflict(feature_key) do update set module_key=excluded.module_key,label=excluded.label,category=excluded.category,route_pattern=excluded.route_pattern,description=excluded.description,supported_actions=excluded.supported_actions,business_unit_types=excluded.business_unit_types,default_enabled=excluded.default_enabled,core_locked=excluded.core_locked,sort_order=excluded.sort_order,is_active=true,source='registry',updated_at=now();
    v_count:=v_count+1;
  end loop;
  return v_count;
end
$function$;

create or replace function public.set_feature_entitlement(
  p_company_id uuid,
  p_business_unit_id uuid,
  p_feature_key text,
  p_enabled boolean,
  p_action_overrides jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_feature public.platform_features%rowtype;
begin
  if not public.is_platform_owner() then raise exception 'Platform Owner access required.'; end if;
  select * into v_feature from public.platform_features where feature_key=p_feature_key and is_active;
  if not found then raise exception 'Unknown feature: %',p_feature_key; end if;
  if v_feature.core_locked and not coalesce(p_enabled,false) then raise exception 'Core feature % cannot be disabled.',p_feature_key; end if;
  if not exists(select 1 from public.companies where id=p_company_id) then raise exception 'Company not found.'; end if;
  if p_action_overrides is null or jsonb_typeof(p_action_overrides)<>'object' then raise exception 'Action overrides must be an object.'; end if;
  if p_business_unit_id is null then
    insert into public.company_feature_entitlements(company_id,feature_key,enabled,action_overrides,updated_by,updated_at)
    values(p_company_id,p_feature_key,p_enabled,p_action_overrides,auth.uid(),now())
    on conflict(company_id,feature_key) do update set enabled=excluded.enabled,action_overrides=excluded.action_overrides,updated_by=auth.uid(),updated_at=now();
  else
    if not exists(select 1 from public.business_units where id=p_business_unit_id and company_id=p_company_id) then raise exception 'Business unit does not belong to company.'; end if;
    insert into public.business_unit_feature_entitlements(business_unit_id,company_id,feature_key,enabled,action_overrides,updated_by,updated_at)
    values(p_business_unit_id,p_company_id,p_feature_key,p_enabled,p_action_overrides,auth.uid(),now())
    on conflict(business_unit_id,feature_key) do update set enabled=excluded.enabled,action_overrides=excluded.action_overrides,updated_by=auth.uid(),updated_at=now();
  end if;
end
$function$;

create or replace function public.has_feature_access(p_feature_key text,p_action text default 'view')
returns boolean
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_company uuid:=public.current_company_id();
  v_unit uuid:=public.current_business_unit_id();
  v_feature public.platform_features%rowtype;
  v_company_enabled boolean;
  v_unit_enabled boolean;
  v_company_actions jsonb;
  v_unit_actions jsonb;
  v_unit_type text;
  v_action text:=coalesce(nullif(p_action,''),'view');
begin
  if public.is_platform_owner() then return true; end if;
  if v_company is null or not public.has_company_access(v_company) then return false; end if;
  select * into v_feature from public.platform_features where feature_key=p_feature_key and is_active;
  if not found then return false; end if;
  if not (v_action=any(v_feature.supported_actions)) then return false; end if;
  if v_feature.module_key<>'dashboard' and not public.company_module_enabled(v_company,v_feature.module_key) then return false; end if;
  if not public.has_module_permission(v_company,v_feature.module_key,case when v_action='export' then 'print' else v_action end) then return false; end if;
  select enabled,action_overrides into v_company_enabled,v_company_actions from public.company_feature_entitlements where company_id=v_company and feature_key=p_feature_key;
  if coalesce(v_company_enabled,v_feature.default_enabled)=false then return false; end if;
  if v_company_actions ? v_action and coalesce((v_company_actions->>v_action)::boolean,false)=false then return false; end if;
  if v_unit is not null then
    if not exists(select 1 from public.business_unit_modules where business_unit_id=v_unit and module_key=v_feature.module_key and enabled) and v_feature.module_key<>'dashboard' then return false; end if;
    select unit_type into v_unit_type from public.business_units where id=v_unit and company_id=v_company and is_active;
    if v_unit_type is null then return false; end if;
    if v_feature.business_unit_types is not null and not (v_unit_type=any(v_feature.business_unit_types)) then return false; end if;
    select enabled,action_overrides into v_unit_enabled,v_unit_actions from public.business_unit_feature_entitlements where business_unit_id=v_unit and feature_key=p_feature_key;
    if coalesce(v_unit_enabled,true)=false then return false; end if;
    if v_unit_actions ? v_action and coalesce((v_unit_actions->>v_action)::boolean,false)=false then return false; end if;
  end if;
  return true;
end
$function$;

grant execute on function public.sync_platform_feature_catalog(jsonb) to authenticated;
grant execute on function public.set_feature_entitlement(uuid,uuid,text,boolean,jsonb) to authenticated;
grant execute on function public.has_feature_access(text,text) to authenticated;

create or replace function public.has_module_permission(p_company_id uuid, p_module text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_role text;v_permissions jsonb;v_override jsonb;v_action text:=coalesce(nullif(p_action,''),'view');
begin
 if p_company_id is null or p_company_id<>public.current_company_id() then return false;end if;
 if not public.company_module_enabled(p_company_id,p_module) and p_module<>'dashboard' then return false;end if;
 if public.is_platform_owner() then return true;end if;
 if not public.has_company_access(p_company_id) then return false;end if;
 select role,permissions into v_role,v_permissions from public.company_memberships where company_id=p_company_id and user_id=auth.uid() and is_active=true limit 1;
 v_override:=v_permissions#>array[p_module,v_action];
 if v_override is not null then return(v_override#>>'{}')::boolean;end if;
 if v_role in('company_owner','admin') then return true;end if;
 if v_action in('view','print','export') then return case v_role when 'accounts' then p_module in('accounting','reports','master') when 'sales' then p_module in('sales','reports','master','inventory') when 'purchase' then p_module in('purchase','reports','master','inventory') when 'store' then p_module in('inventory','reports','master') when 'production' then p_module in('production','inventory','reports','master') when 'transport' then p_module in('transport','accounting','reports','master','settings') when 'viewer' then p_module in('dashboard','reports') else false end;end if;
 if v_action='delete' then return false;end if;
 if v_action in('create','edit','post') then return case v_role when 'accounts' then p_module='accounting' when 'sales' then p_module='sales' when 'purchase' then p_module='purchase' when 'store' then p_module='inventory' when 'production' then p_module='production' when 'transport' then p_module='transport' else false end;end if;
 return false;
end
$function$;

