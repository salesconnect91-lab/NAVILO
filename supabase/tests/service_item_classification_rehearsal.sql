-- Non-stock Service item classification regression.
-- Isolated database only; all synthetic rows roll back.
begin;

do $$
declare
  v_user uuid:=gen_random_uuid();
  c uuid;
  v_bu uuid;
  v_loc uuid;
  v_service uuid;
  v_code text:=substr(replace(gen_random_uuid()::text,'-',''),1,10);
begin
  insert into auth.users(id,role,email,created_at,updated_at)
  values(v_user,'authenticated','service-item-'||v_code||'@navilo.test',now(),now());

  insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
  values(v_user,v_user,'service-item-'||v_code||'@navilo.test','admin','user',true);

  insert into public.companies(name,code,status)
  values('Service Item Test','SIT_'||v_code,'active')
  returning id into c;

  select id into strict v_bu
  from public.business_units
  where company_id=c and is_default;

  insert into public.company_memberships(company_id,user_id,role,is_active)
  values(c,v_user,'company_owner',true);

  insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
  values(c,v_bu,v_user,'company_owner',true)
  on conflict(business_unit_id,user_id) do update set role='company_owner',is_active=true;

  insert into public.operating_locations(company_id,business_unit_id,code,name,is_active)
  values(c,v_bu,'SVC-'||v_code,'Service Item Branch',true)
  returning id into v_loc;

  insert into public.operating_location_memberships
    (company_id,business_unit_id,operating_location_id,user_id,role,is_active)
  values(c,v_bu,v_loc,v_user,'company_owner',true);

  update public.user_profiles
  set last_company_id=c,last_business_unit_id=v_bu,locked_operating_location_id=v_loc
  where id=v_user;

  perform set_config('request.jwt.claim.sub',v_user::text,true);

  if public.current_company_id() is distinct from c then
    raise exception 'Service fixture failed to establish active company';
  end if;

  insert into public.items(user_id,company_id,sku,name,type,grade,size,cost,price,is_stock_item)
  values(v_user,c,'SVC-'||v_code,'Transport Freight','service','SHOULD CLEAR','SHOULD CLEAR',0,0,true)
  returning id into v_service;

  if not exists(
    select 1 from public.items
    where id=v_service and type='service' and is_stock_item=false
      and grade is null and size is null and warehouse_id is null and weight_per_piece is null
  ) then
    raise exception 'Service classification did not enforce non-stock semantics';
  end if;

  if exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='items'
      and column_name in ('revenue_account_id','expense_account_id','sales_account_id','purchase_account_id')
  ) then
    raise exception 'Service classification unexpectedly introduced item-level account mapping';
  end if;

  raise notice 'PASS: Service item is non-stock and no item-level COA mapping was introduced';
end $$;

rollback;
