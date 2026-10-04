-- LOCAL / ISOLATED DATABASE ONLY. Synthetic fixture rolls back.
begin;

do $$
declare
  u uuid:=gen_random_uuid(); c uuid; b uuid; customer uuid; trip uuid; ar uuid; revenue uuid; cm uuid; other_c uuid; other_cm uuid;
  code text:=substr(replace(gen_random_uuid()::text,'-',''),1,10);
  result jsonb; rejected boolean;
begin
  insert into auth.users(id,role,email,created_at,updated_at)
  values(u,'authenticated','charge-guard-'||code||'@navilo.test',now(),now());
  insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
  values(u,u,'charge-guard-'||code||'@navilo.test','admin','user',true);
  insert into public.companies(name,code,status) values('Charge guard','CG'||code,'active') returning id into c;
  select id into strict b from public.business_units where company_id=c and is_default;
  update public.business_units set unit_type='transport' where id=b;
  insert into public.company_memberships(company_id,user_id,role,is_active) values(c,u,'company_owner',true);
  insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
  values(c,b,u,'company_owner',true) on conflict(business_unit_id,user_id) do update set is_active=true;
  insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled)
  values(c,b,'transport',true),(c,b,'sales',true),(c,b,'accounting',true)
  on conflict(business_unit_id,module_key) do update set enabled=true;
  update public.user_profiles set last_company_id=c,last_business_unit_id=b where id=u;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform public.initialize_default_coa();

  select account_id into ar from public.account_mappings where company_id=c and mapping_key='accounts_receivable';
  select id into revenue from public.chart_of_accounts where company_id=c and type='income' and is_active and not is_group order by id limit 1;
  if ar is null or revenue is null then raise exception 'Accounting fixture missing'; end if;

  insert into public.customers(user_id,company_id,name,account_id) values(u,c,'Guard Customer',ar) returning id into customer;
  insert into public.charge_master(user_id,company_id,charge_key,charge_name,applies_to,tax_applicable,revenue_account_id,is_active)
  values(u,c,'wait-'||code,'Waiting','sales',true,revenue,true) returning id into cm;
  insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
  values(c,b,'',current_date,customer,'A','B',1000,0,'credit') returning id into trip;

  result:=public.transport_replace_trip_customer_charges(
    trip,
    jsonb_build_array(jsonb_build_object('charge_master_id',cm,'amount',600)),
    'Canonical guard rehearsal'
  );
  if (result->>'charges_total')::numeric<>600 or (result->>'final_rate')::numeric<>1600 then
    raise exception 'Canonical customer charge total mismatch: %',result;
  end if;
  if not exists(select 1 from public.transport_trip_customer_charges where trip_id=trip and charge_master_id=cm and charge_type_id is null and amount=600) then
    raise exception 'Canonical customer charge row not stored correctly';
  end if;

  insert into public.companies(name,code,status) values('Other charge company','OC'||code,'active') returning id into other_c;
  insert into public.charge_master(user_id,company_id,charge_key,charge_name,applies_to,tax_applicable,revenue_account_id,is_active)
  values(u,other_c,'bad-'||code,'Wrong company','sales',false,null,true) returning id into other_cm;
  rejected:=false;
  begin
    perform public.transport_replace_trip_customer_charges(trip,jsonb_build_array(jsonb_build_object('charge_master_id',other_cm,'amount',1)),'Reject cross-company');
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Cross-company Charge Master accepted'; end if;

  raise notice 'PASS: canonical customer Charge Master guard accepts valid rows, preserves totals and rejects cross-company master';
end $$;

rollback;
