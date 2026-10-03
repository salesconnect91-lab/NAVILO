-- Isolated database only. Authenticated API rehearsals; all synthetic fixtures roll back.
begin;
create function pg_temp.entry_rejected(statement text, expected text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
  if sqlerrm not ilike '%'||expected||'%' then raise exception 'Unexpected rejection [%]: %',expected,sqlerrm;end if;
  return;
 end;
 raise exception 'Expected rejection missing: %',expected;
end $$;
do $$
declare u uuid:=gen_random_uuid();c uuid;b uuid;loc uuid;ar uuid;ap uuid;cost uuid;cash_id uuid;acct uuid;
 code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 customer uuid;supplier uuid;tt uuid;tt2 uuid;from_id uuid;to_id uuid;v uuid;company_v uuid;d uuid;company_d uuid;employee uuid;
 ownership uuid;rate uuid;result jsonb;payload jsonb;supplier_payload jsonb;trip uuid;trip2 uuid;request_id uuid:=gen_random_uuid();number text;
 other_bu uuid;foreign_v uuid;other_c uuid;other_customer uuid;before_count bigint;canonical public.customers;canonical_supplier public.suppliers;
job jsonb;job_id uuid;manifest jsonb;batch_no integer;data jsonb;first_page jsonb;last_page jsonb;batch_payload jsonb;started timestamptz;
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
  values(c,b,'sales',true),(c,b,'purchase',true),(c,b,'accounting',true),(c,b,'transport',true),(c,b,'settings',true),(c,b,'master',true)
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

 -- Quick-add uses canonical party RPCs, never separate Transport customers/suppliers.
 execute 'set local role authenticated';
 canonical:=public.create_customer_with_ar('Entry Customer',null,'123',null);customer:=canonical.id;
 canonical_supplier:=public.create_supplier_with_ap('Entry Supplier',null,'456',null);supplier:=canonical_supplier.id;
 if canonical.company_id is distinct from c or canonical.account_id is distinct from ar or canonical_supplier.account_id is distinct from ap then raise exception 'Canonical party mapping/scope missing';end if;
 perform pg_temp.entry_rejected('select public.create_customer_with_ar('' entry  customer '',null,null,null)','Duplicate canonical');
 perform pg_temp.entry_rejected('select public.create_supplier_with_ap('' ENTRY SUPPLIER '',null,null,null)','Duplicate canonical');
 insert into public.transport_truck_types(company_id,business_unit_id,name) values(c,b,'Entry Flatbed') returning id into tt;
 insert into public.transport_truck_types(company_id,business_unit_id,name) values(c,b,'Entry Tanker') returning id into tt2;
 insert into public.transport_locations(company_id,business_unit_id,name) values(c,b,'Entry From') returning id into from_id;
 insert into public.transport_locations(company_id,business_unit_id,name) values(c,b,'Entry To') returning id into to_id;
 insert into public.transport_drivers(company_id,business_unit_id,driver_name,driver_type,driver_code,mobile) values(c,b,'Company Driver','company','C-1','100') returning id into company_d;
 insert into public.transport_drivers(company_id,business_unit_id,driver_name,driver_type,supplier_id,driver_code,mobile,identity_no,driving_licence_no,licence_expiry)
 values(c,b,'Supplier Driver','supplier',supplier,'S-1','200','ID-1','LIC-1',current_date+100) returning id into d;
 perform pg_temp.entry_rejected(format('insert into public.transport_drivers(company_id,business_unit_id,driver_name,driver_code,driver_type) values(%L,%L,''Other Driver'','' s-1 '',''company'')',c,b),'Driver Code already exists');
 perform pg_temp.entry_rejected(format('insert into public.transport_truck_types(company_id,business_unit_id,name) values(%L,%L,''entry flatbed'')',c,b),'Duplicate');
 perform pg_temp.entry_rejected(format('insert into public.transport_locations(company_id,business_unit_id,name) values(%L,%L,''entry   to'')',c,b),'Duplicate');
 v:=public.transport_create_vehicle_master('ENTRY-S',tt,'supplier',supplier,current_date-30);
 company_v:=public.transport_create_vehicle_master('ENTRY-C',tt,'company',null,current_date-30);
 select id into ownership from public.transport_vehicle_ownership where vehicle_id=v;
 if (select count(*) from public.transport_vehicle_ownership where vehicle_id in (v,company_v))<>2 then raise exception 'Atomic initial history missing';end if;
 perform pg_temp.entry_rejected(format('select public.transport_create_vehicle_master(''entry-s'',%L,''supplier'',%L,%L)',tt,supplier,current_date),'Duplicate');
 insert into public.transport_customer_rates(company_id,business_unit_id,customer_id,truck_type_id,from_location_id,to_location_id,effective_from,amount)
 values(c,b,customer,tt,from_id,to_id,current_date-30,1000) returning id into rate;
 execute 'reset role';
 insert into public.employees(company_id,user_id,name,is_active) values(c,u,'Entry Receiver',true) returning id into employee;
 insert into public.business_units(company_id,code,name,unit_type,is_active) values(c,'OTHER','Other BU','transport',true) returning id into other_bu;
 insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active) values(c,other_bu,u,'company_owner',true);
 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled) values(c,other_bu,'transport',true),(c,other_bu,'master',true);
 update public.user_profiles set last_business_unit_id=other_bu where id=u;
 insert into public.transport_vehicles(company_id,business_unit_id,vehicle_no) values(c,other_bu,'FOREIGN-BU') returning id into foreign_v;
 update public.user_profiles set last_business_unit_id=b where id=u;
 insert into public.companies(name,code,status) values('Steel entry isolation','SE'||code,'active') returning id into other_c;
 insert into public.company_memberships(company_id,user_id,role,is_active) values(other_c,u,'company_owner',true);
 -- Trusted fixture seeding of the second company; no production data involved.
 update public.user_profiles set last_company_id=other_c,last_business_unit_id=(select id from public.business_units where company_id=other_c and is_default) where id=u;
 insert into public.customers(company_id,user_id,name) values(other_c,u,'Other Customer') returning id into other_customer;
 update public.user_profiles set last_company_id=c,last_business_unit_id=b where id=u;


 started:=clock_timestamp();
 alter table public.transport_trips disable trigger user;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,customer_name_snapshot,
 from_location_id,to_location_id,from_location,to_location,customer_rate,po_do_job_no,sale_type)
 select c,b,'SCALE-'||i,current_date-(i%2),customer,'Entry Customer',from_id,to_id,'Entry From','Entry To',20,'SCALE-'||i,'credit'
 from generate_series(1,50000) i;
 alter table public.transport_trips enable trigger user;
 raise notice '50,000 synthetic fixture ms: %',extract(epoch from clock_timestamp()-started)*1000;
 analyze public.transport_trips;
 execute 'set local role authenticated';
 started:=clock_timestamp();data:=public.transport_register_query();
 if (data->>'count')::int<>50000 or jsonb_array_length(data->'rows')<>500 or (data->'totals'->>'company_rate')::numeric<>1000000 then raise exception '50k first page mismatch';end if;
 raise notice '50,000 first page ms: %',extract(epoch from clock_timestamp()-started)*1000;
 first_page:=data;started:=clock_timestamp();data:=public.transport_register_query(500,49500);
 if data->'totals' is distinct from first_page->'totals' or jsonb_array_length(data->'rows')<>500 then raise exception '50k last page/totals mismatch';end if;
 raise notice '50,000 last page ms: %',extract(epoch from clock_timestamp()-started)*1000;
 started:=clock_timestamp();data:=public.transport_bulk_rate_page('customer');
 if (data->>'count')::int<>50000 or (data->>'amount')::numeric<>1000000 then raise exception '50k customer mismatch';end if;
 raise notice '50,000 customer bulk ms: %',extract(epoch from clock_timestamp()-started)*1000;
 started:=clock_timestamp();data:=public.transport_bulk_rate_page('supplier');
 if (data->>'count')::int<>50000 then raise exception '50k supplier mismatch';end if;
 raise notice '50,000 supplier bulk ms: %',extract(epoch from clock_timestamp()-started)*1000;
 started:=clock_timestamp();data:=public.transport_trip_report('customer',500,0,'{"posting":"all"}');
 if (data->>'count')::int<>50000 or jsonb_array_length(data->'rows')<>500 then raise exception '50k reporting page failed';end if;
 raise notice '50,000 trip report with full filtered totals ms: %',extract(epoch from clock_timestamp()-started)*1000;
 data:=public.transport_trip_report('customer',500,49500,'{"posting":"all"}');
 if jsonb_array_length(data->'rows')<>500 then raise exception '50k reporting last page failed';end if;
 execute 'reset role';
end $$;
rollback;
