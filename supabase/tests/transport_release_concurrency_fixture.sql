create schema transport_rehearsal;create table transport_rehearsal.fixture(data jsonb);
-- Isolated local database only. Synthetic fixtures and requests roll back.
begin;
do $$
declare u uuid:=gen_random_uuid();code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 c uuid;b uuid;loc uuid;customer uuid;supplier uuid;ar uuid;ap uuid;cost uuid;cash_id uuid;acct uuid;
 trip uuid;trip2 uuid;sales_id uuid;sales2 uuid;rent uuid;rent2 uuid;bill uuid;bill2 uuid;
 result jsonb;again jsonb;payload jsonb;request_id uuid:=gen_random_uuid();payment_id uuid;receipt_id uuid;
 truck_type uuid;from_id uuid;to_id uuid;vehicle uuid;vehicle2 uuid;race_payload jsonb;count_before bigint;rejected boolean;other_bu uuid;other_loc uuid;other_c uuid;v numeric;
begin
 insert into auth.users(id,role,email,created_at,updated_at)
 values(u,'authenticated','service-'||code||'@navilo.test',now(),now());
 insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
 values(u,u,'service-'||code||'@navilo.test','admin','user',true);
 insert into public.companies(name,code,status) values('Service rehearsal','SV'||code,'active') returning id into c;
 select id into strict b from public.business_units where company_id=c and is_default;
 update public.business_units set unit_type='transport' where id=b;
 insert into public.company_memberships(company_id,user_id,role,is_active) values(c,u,'company_owner',true);
 insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
 values(c,b,u,'company_owner',true) on conflict(business_unit_id,user_id) do update set is_active=true;
 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled)
  values(c,b,'sales',true),(c,b,'purchase',true),(c,b,'accounting',true),(c,b,'transport',true),(c,b,'settings',true)
 on conflict(business_unit_id,module_key) do update set enabled=true;
 insert into public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
 values(c,b,'SV','Service branch','branch',true) returning id into loc;
 insert into public.operating_location_memberships(company_id,business_unit_id,operating_location_id,user_id,role,is_active)
 values(c,b,loc,u,'company_owner',true);
 update public.user_profiles set last_company_id=c,last_business_unit_id=b where id=u;
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.company_settings(user_id,company_id,company_name,strn)
 values(u,c,'Service rehearsal','SERVICE-STRN');
 perform public.initialize_default_coa();
 select account_id into ar from public.account_mappings where company_id=c and mapping_key='accounts_receivable';
 select account_id into ap from public.account_mappings where company_id=c and mapping_key='accounts_payable';
 select account_id into cost from public.account_mappings where company_id=c and mapping_key='cogs';
 select account_id into cash_id from public.account_mappings where company_id=c and mapping_key='cash';
 select id into acct from public.chart_of_accounts where company_id=c and type='expense' and is_active and not is_group
  and id<>cost order by id limit 1;
 if acct is null then acct:=cost; end if;
 if ar is null or ap is null or acct is null or cash_id is null then raise exception 'Canonical accounting setup missing'; end if;
 insert into public.customers(user_id,company_id,name,account_id) values(u,c,'Service Customer',ar) returning id into customer;
 insert into public.suppliers(user_id,company_id,name,account_id) values(u,c,'Service Supplier',ap) returning id into supplier;

 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,'A','B',1000,400,'credit') returning id into trip;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,'A','B',1000,300,'credit') returning id into trip2;

 perform public.transport_finalize_customer_rate(trip,1000,'manual');
 perform public.transport_finalize_customer_rate(trip2,1000,'manual');
 rent:=public.transport_add_supplier_rent(trip,supplier,400,'Concurrent rent');
 perform public.transport_finalize_supplier_rent(rent,400);
 insert into public.transport_truck_types(company_id,business_unit_id,name) values(c,b,'Race truck') returning id into truck_type;
 insert into public.transport_locations(company_id,business_unit_id,name) values(c,b,'Race From') returning id into from_id;
 insert into public.transport_locations(company_id,business_unit_id,name) values(c,b,'Race To') returning id into to_id;
 vehicle:=public.transport_create_vehicle_master('RACE-V-'||code,truck_type,'company',null,current_date);
 vehicle2:=public.transport_create_vehicle_master('RACE-W-'||code,truck_type,'company',null,current_date);
 race_payload:=jsonb_build_array(jsonb_build_object('trip_date',current_date,'customer_id',customer,'vehicle_id',vehicle,'truck_type_id',truck_type,'from_location_id',from_id,'to_location_id',to_id,'sale_type','credit','customer_rate',1000,'driver_pay',0));
 insert into transport_rehearsal.fixture values(jsonb_build_object('user',u,'company',c,'unit',b,'location',loc,'trip',trip,'trip2',trip2,'rent',rent,'supplier',supplier,'customer',customer,'account',acct,'cash',cash_id,'date',current_date,'vehicle',vehicle,'vehicle2',vehicle2,'payload',race_payload));
end $$;
commit;
