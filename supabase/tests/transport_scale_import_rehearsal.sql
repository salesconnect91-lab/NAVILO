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
 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled)
 select other_c,id,'transport',true from public.business_units where company_id=other_c and is_default
 on conflict(business_unit_id,module_key) do update set enabled=true;
 insert into public.customers(company_id,user_id,name) values(other_c,u,'Other Customer') returning id into other_customer;
 update public.user_profiles set last_company_id=c,last_business_unit_id=b where id=u;


 create temp table navilo_scale_context as select c company_id,b business_unit_id,u user_id,customer customer_id,tt truck_type_id,from_id from_location_id,to_id to_location_id,other_c other_company_id,null::uuid job_id;
 grant all on navilo_scale_context to authenticated;
 execute 'set local role authenticated';
 select jsonb_agg(rows order by chunk) into manifest from (
  select (i-1)/100 chunk,jsonb_agg(i+1 order by i) rows from generate_series(1,20000) i group by (i-1)/100) s;
 job:=public.transport_prepare_trip_import(repeat('a',64),'synthetic-20000.xlsx',manifest);job_id:=(job->>'id')::uuid;
 update navilo_scale_context set job_id=(job->>'id')::uuid;
 perform pg_temp.entry_rejected('select * from public.transport_trip_import_jobs','permission denied');
 perform pg_temp.entry_rejected(format('select public.transport_import_trip_batch(%L,1,''[]'')',job_id),'Invalid batch');
 execute 'reset role';
end $$;
create function pg_temp.navilo_scale_batch(batch_no integer) returns void language plpgsql as $$
declare ctx navilo_scale_context;batch_payload jsonb;result jsonb;
begin
 select * into ctx from navilo_scale_context;
 perform set_config('request.jwt.claim.sub',ctx.user_id::text,true);execute 'set local role authenticated';
 select jsonb_agg(jsonb_build_object('trip_date',current_date,'customer_id',ctx.customer_id,'truck_type_id',ctx.truck_type_id,
  'from_location_id',ctx.from_location_id,'to_location_id',ctx.to_location_id,'sale_type',case when i%2=0 then 'cash' else 'credit' end,
  'ppr_status','pending','customer_rate',10,'po_do_job_no','IMPORT-'||i) order by i) into batch_payload
  from generate_series(batch_no*100+1,(batch_no+1)*100) i;
 if batch_no=1 then
  perform pg_temp.entry_rejected(format('select public.transport_import_trip_batch(%L,1,%L::jsonb)',ctx.job_id,jsonb_set(batch_payload,'{99,sale_type}','"bad"')),'Cash or Credit');
  if (select count(*) from public.transport_trips where company_id=ctx.company_id)<>100 then raise exception 'Invalid batch partially saved';end if;
 end if;
 result:=public.transport_import_trip_batch(ctx.job_id,batch_no,batch_payload);
 if jsonb_array_length(result)<>100 then raise exception 'Missing batch results';end if;
 if batch_no=0 then
  if result is distinct from public.transport_import_trip_batch(ctx.job_id,0,batch_payload) then raise exception 'Lost-response retry changed result';end if;
  if (select count(*) from public.transport_trips where company_id=ctx.company_id)<>100 then raise exception 'Replay duplicated Trips';end if;
  perform pg_temp.entry_rejected(format('select public.transport_import_trip_batch(%L,0,%L::jsonb)',ctx.job_id,jsonb_set(batch_payload,'{0,customer_rate}','12')),'another payload');
 end if;
end $$;
commit;
-- NAVILO_SCALE_BATCHES: runner executes 200 independently committed calls here.
begin;
do $$
declare c uuid;b uuid;u uuid;other_c uuid;job_id uuid;customer uuid;from_id uuid;to_id uuid;manifest jsonb;job jsonb;data jsonb;first_page jsonb;last_page jsonb;started timestamptz;batch_payload jsonb:='[]';
begin
 select company_id,business_unit_id,user_id,other_company_id,navilo_scale_context.job_id,customer_id,from_location_id,to_location_id
 into c,b,u,other_c,job_id,customer,from_id,to_id from navilo_scale_context;
 perform set_config('request.jwt.claim.sub',u::text,true);execute 'set local role authenticated';
 select jsonb_agg(rows order by chunk) into manifest from (
  select (i-1)/100 chunk,jsonb_agg(i+1 order by i) rows from generate_series(1,20000) i group by (i-1)/100) s;
 if (select count(*) from public.transport_trips where company_id=c)<>20000 then raise exception '20,000 import count mismatch';end if;
 job:=public.transport_prepare_trip_import(repeat('a',64),'same-file.xlsx',manifest);
 if (job->>'id')::uuid<>job_id or (job->>'completed')::int<>200 then raise exception 'Resume state not durable';end if;
 perform pg_temp.entry_rejected(format('select public.transport_prepare_trip_import(%L,''changed'',%L::jsonb)',repeat('a',64),jsonb_build_array(manifest->0)),'different import selection');
 if exists(select 1 from public.transport_customer_document_trips where company_id=c) or exists(select 1 from public.transport_supplier_documents where company_id=c)
 then raise exception 'Operational upload posted accounting';end if;

 execute 'reset role';
 -- Trusted synthetic scale fixture: no production content, isolated transaction only.
 alter table public.transport_trips disable trigger user;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,customer_name_snapshot,
  from_location_id,to_location_id,from_location,to_location,customer_rate,po_do_job_no,sale_type)
 select c,b,'SCALE-'||i,current_date-1,customer,'Entry Customer',from_id,to_id,'Entry From','Entry To',20,'SCALE-'||i,'credit'
 from generate_series(20001,50000) i;
 alter table public.transport_trips enable trigger user;
 analyze public.transport_trips;
 execute 'set local role authenticated';
 started:=clock_timestamp();
 data:=public.transport_register_query();first_page:=data;
 if (data->>'count')::integer<>50000 or jsonb_array_length(data->'rows')<>500 or (data->'totals'->>'company_rate')::numeric<>800000
 then raise exception '50k first page/totals failed: %',data-'rows';end if;
 raise notice '50,000 first page + full totals ms: %',extract(epoch from clock_timestamp()-started)*1000;
 started:=clock_timestamp();
 data:=public.transport_register_query(500,49500);last_page:=data;
 if (data->>'count')::integer<>50000 or jsonb_array_length(data->'rows')<>500 or data->'totals' is distinct from first_page->'totals'
 then raise exception 'Last page changed filtered totals';end if;
 if exists(select 1 from jsonb_array_elements(first_page->'rows') a join jsonb_array_elements(last_page->'rows') z on a->>'id'=z->>'id') then raise exception 'First/last pages overlap';end if;
 raise notice '50,000 last page ms: %',extract(epoch from clock_timestamp()-started)*1000;
 data:=public.transport_register_query(500,0,jsonb_build_object('fromDate',current_date,'toDate',current_date));
 if (data->>'count')::integer<>20000 or (data->'totals'->>'company_rate')::numeric<>200000 then raise exception 'Date filter whole totals failed';end if;
 data:=public.transport_register_query(500,0,jsonb_build_object('search','IMPORT-20000'));
 if (data->>'count')::integer<>1 then raise exception 'Search did not find off-page Trip';end if;
 data:=public.transport_register_query(500,0,jsonb_build_object('columns',jsonb_build_object('company_rate',jsonb_build_array('20.00'))),'company_rate','desc');
 if (data->>'count')::integer<>30000 or (data->'totals'->>'company_rate')::numeric<>600000 then raise exception 'Column filter totals failed';end if;
 data:=public.transport_register_query(500,0,'{}','company_rate','desc');
 if (data->'rows'->0->>'customer_rate')::numeric<>20 then raise exception 'Global numeric sorting failed';end if;
 data:=public.transport_register_query(500,0,jsonb_build_object('columns',jsonb_build_object('job_no',jsonb_build_array('absent'))),'','asc','job_no','IMPORT-20000');
 if data->'options' is distinct from '["IMPORT-20000"]'::jsonb then raise exception 'Cascading option search failed';end if;
 data:=public.transport_bulk_rate_page('customer',500,19500,jsonb_build_object('search','IMPORT-'));
 if (data->>'count')::integer<>20000 or jsonb_array_length(data->'rows')<>500 or (data->>'amount')::numeric<>200000 then raise exception 'Bulk Customer full totals/page failed';end if;
 data:=public.transport_bulk_rate_page('supplier',500,49500);
 if (data->>'count')::integer<>50000 or jsonb_array_length(data->'rows')<>500 then raise exception 'Bulk Supplier pagination failed';end if;
 execute 'reset role';
 update public.user_profiles set last_company_id=other_c,last_business_unit_id=(select id from public.business_units where company_id=other_c and is_default) where id=u;
 execute 'set local role authenticated';
 data:=public.transport_register_query();if (data->>'count')::integer<>0 then raise exception 'Reader leaked another tenant';end if;
 perform pg_temp.entry_rejected(format('select public.transport_import_trip_batch(%L,0,%L::jsonb)',job_id,batch_payload),'does not belong');
 execute 'reset role';perform set_config('request.jwt.claim.sub','',true);
 perform pg_temp.entry_rejected('select public.transport_register_query()','permission');
 execute 'set local role anon';
 perform pg_temp.entry_rejected('select public.transport_register_query()','permission denied');
 execute 'reset role';
end $$;
rollback;
