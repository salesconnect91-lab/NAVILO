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
data jsonb;rent uuid;second_rent uuid;bill uuid;customer_trip uuid;
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

 execute 'set local role authenticated';
 payload:=jsonb_build_array(jsonb_build_object('trip_date',current_date,'customer_id',customer,'vehicle_id',v,'driver_id',d,
 'truck_type_id',tt,'from_location_id',from_id,'to_location_id',to_id,'sale_type','credit','ppr_status','pending','customer_rate',1000,'supplier_rent',300,'po_do_job_no','TEST-1'),
 jsonb_build_object('trip_date',current_date-1,'customer_id',customer,'vehicle_id',company_v,'truck_type_id',tt,
 'from_location_id',from_id,'to_location_id',to_id,'sale_type','cash','ppr_status','pending','customer_rate',1000,'po_do_job_no','TEST-2'));
 result:=public.transport_create_trips(request_id,c,b,payload);trip:=(result->0->>'id')::uuid;customer_trip:=(result->1->>'id')::uuid;
 data:=public.transport_audit_page(1,0,'TEST');
 data:=public.transport_register_query(1,0);
 if (data->>'count')::int<>2 or jsonb_array_length(data->'rows')<>1 or (data->'totals'->>'company_rate')::numeric<>2000 then raise exception 'Page/all totals mismatch: %',data;end if;
 if data->'rows'->0->>'id'<>trip::text then raise exception 'Default ordering failed';end if;
 data:=public.transport_register_query(1,1,'{}','company_rate','asc');
 if (data->'totals'->>'company_rate')::numeric<>2000 then raise exception 'Next page totals failed';end if;
 data:=public.transport_register_query(1,0,jsonb_build_object('columns',jsonb_build_object('job_no',jsonb_build_array('TEST-2'))));
 if (data->>'count')::int<>1 or data->'rows'->0->>'id'<>customer_trip::text then raise exception 'Global column filtering failed';end if;
 data:=public.transport_register_query(1,0,'{}','','asc','job_no','TEST-2');
 if data->'options' is distinct from '["TEST-2"]'::jsonb then raise exception 'Remote option search failed';end if;
 select id into rent from public.transport_trip_supplier_rents where trip_id=trip;
 perform public.transport_post_customer_bill(trip,current_date,false);
 perform public.transport_post_supplier_bill(rent,current_date,acct,false,'Reader test');
 second_rent:=public.transport_add_supplier_rent(trip,supplier,400,'Extra supplier line');
 perform public.transport_finalize_supplier_rent(second_rent,400,'Extra finalized line');
 perform public.transport_adjust_rate(trip,'supplier',0,'Full credit',current_date,rent,'Reader full credit');
 perform public.transport_adjust_rate(trip,'customer',0,'Full credit',current_date,null,'Reader full credit');
 data:=public.transport_bulk_rate_page('supplier',500,0,jsonb_build_object('initialTrip',trip));
 if (data->>'count')::int<>2 or (data->>'amount')::numeric<>400 then raise exception 'Per rent correction totals failed: %',data;end if;
 if not exists(select 1 from jsonb_array_elements(data->'rows') r where r->>'id'=rent::text and (r->>'posted')::boolean and (r->>'supplier_rent')::numeric=0)
 or not exists(select 1 from jsonb_array_elements(data->'rows') r where r->>'id'=second_rent::text and not (r->>'posted')::boolean and (r->>'supplier_rent')::numeric=400)
 then raise exception 'Posted zero/unposted sibling lock failed';end if;
 data:=public.transport_bulk_rate_page('customer',500,0,jsonb_build_object('initialTrip',trip));
 if not (data->'rows'->0->>'posted')::boolean or (data->'rows'->0->>'billed_customer_net')::numeric<>0 then raise exception 'Customer zero-credit lock failed';end if;
 perform public.transport_post_cash_bill_receive(gen_random_uuid(),customer_trip,current_date,cash_id,'cash',false,'Reader cash');
 data:=public.transport_register_query();
 if (data->'totals'->>'company_rate')::numeric<>1000 or (data->'totals'->>'received_company')::numeric<>1000 then raise exception 'Cash canonical totals failed: %',data-'rows';end if;

 -- Additive report and import coverage, including independent side posting,
 -- zero charges, canonical balances, retry stability and historical ownership.
 data:=public.transport_trip_report('supplier',1,0,'{"posting":"posted"}');
 if (data->>'count')::int<>1 or jsonb_array_length(data->'rows')<>1 then raise exception 'Supplier posted filter leaked customer-only Trip';end if;
 data:=public.transport_trip_report('supplier',1,0,'{"posting":"unposted"}');
 if (data->>'count')::int<>1 or data->'rows'->0->>'id'<>customer_trip::text then raise exception 'Supplier unposted filter failed';end if;
 data:=public.transport_trip_report('customer',1,0,'{"posting":"all"}');
 if (data->>'count')::int<>2 or (data->'summary'->>'revenue')::numeric<>1000 then raise exception 'Report page/full-filter totals failed';end if;
 data:=public.transport_document_trip_details('customer');
 if jsonb_array_length(data)<>2 or not exists(select 1 from jsonb_array_elements(data) x where x->>'trip_id'=trip::text and x->>'vehicle_no'='ENTRY-S') then raise exception 'Saved invoice Trip details failed';end if;
 request_id:=gen_random_uuid();payload:=jsonb_build_array(jsonb_build_object('trip_id',trip,'amount',0,'reason','Zero agreed driver charge'));
 data:=public.transport_driver_charge_upload(request_id,payload);
 if data is distinct from public.transport_driver_charge_upload(request_id,payload) then raise exception 'Driver charge retry failed';end if;
 perform pg_temp.entry_rejected(format('select public.transport_driver_charge_upload(%L,%L)',request_id,jsonb_build_array(jsonb_build_object('trip_id',trip,'amount',1,'reason','Changed'))),'mismatch');
 request_id:=gen_random_uuid();payload:=jsonb_build_array(jsonb_build_object('trip_id',trip,'amount',25,'date',current_date,'reference','Vehicle expense rehearsal'));
 data:=public.transport_reviewed_cost_upload(request_id,payload,supplier,acct,'vehicle_expense',false);
 if data is distinct from public.transport_reviewed_cost_upload(request_id,payload,supplier,acct,'vehicle_expense',false) then raise exception 'Expense retry failed';end if;
 if (select count(*) from public.transport_service_cost_links where trip_id=trip and cost_kind='vehicle_expense')<>1 then raise exception 'Expense retry duplicated posting';end if;
 data:=public.accounting_report_balances(current_date-1,current_date,false);
 if (select sum((x->>'debit')::numeric-(x->>'credit')::numeric) from jsonb_array_elements(data) x)<>0 then raise exception 'Aggregated Trial Balance unbalanced';end if;
 data:=public.transport_contribution_summary(current_date-1,current_date);
 if not exists(select 1 from jsonb_array_elements(data) x where x->>'ownership'='company' and (x->>'revenue')::numeric=1000) then raise exception 'Company fleet attribution failed';end if;
 if (select sum((x->>'revenue')::numeric) from jsonb_array_elements(data) x)<>1000 or (select sum((x->>'cost')::numeric) from jsonb_array_elements(data) x)<>25 then raise exception 'Ownership comparison omitted posted sources';end if;
 -- Server file lock prevents another user from importing the same file again.
 perform public.transport_prepare_trip_import(repeat('b',64),'same-workspace.xlsx','[[2]]');
 execute 'reset role';
 -- The faster reporting reader must preserve the exact canonical rows,
 -- including settlement and correction history, for both party sides.
 data:=public.transport_party_report_page('documents');
 if data is distinct from (select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select * from public.transport_party_documents order by side,order_id) q)
 then raise exception 'Reporting documents diverged from canonical view';end if;
 data:=public.transport_party_report_page('movements');
 if data is distinct from (select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select * from public.transport_party_movements order by event_id) q)
 then raise exception 'Reporting movements diverged from canonical history';end if;
 data:=public.transport_party_report_page('canonical');
 if data is distinct from (select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select * from public.transport_canonical_party_movements order by event_id) q)
 then raise exception 'Reporting ledger diverged from canonical view';end if;
 perform pg_temp.entry_rejected('select public.transport_party_report_page(''unknown'')','Invalid report');
 insert into auth.users(id,role,email,created_at,updated_at) values(request_id,'authenticated','other-import-'||code||'@navilo.test',now(),now());
 insert into public.user_profiles(id,user_id,email,role,platform_role,is_active,last_company_id,last_business_unit_id)
 values(request_id,request_id,'other-import-'||code||'@navilo.test','user','user',true,c,b);
 insert into public.company_memberships(company_id,user_id,role,is_active) values(c,request_id,'company_owner',true);
 insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active) values(c,b,request_id,'company_owner',true) on conflict(business_unit_id,user_id) do update set role='company_owner',is_active=true;
 perform set_config('request.jwt.claim.sub',request_id::text,true);
 execute 'set local role authenticated';
 perform pg_temp.entry_rejected('select public.transport_prepare_trip_import(repeat(''b'',64),''duplicate.xlsx'',''[[2]]'')','another user');
 execute 'reset role';perform set_config('request.jwt.claim.sub',u::text,true);
 update public.business_unit_memberships set permissions=jsonb_build_object('transport_actions',jsonb_build_object('trip_create',false)) where business_unit_id=b and user_id=u;
 execute 'set local role authenticated';
 perform pg_temp.entry_rejected('select public.transport_prepare_trip_import(repeat(''a'',64),''denied'',''[[2]]'')','permission');
 execute 'reset role';
 perform set_config('request.jwt.claim.sub','',true);
 perform pg_temp.entry_rejected('select public.transport_register_query()','permission');
 execute 'set local role anon';
 perform pg_temp.entry_rejected('select public.transport_register_query()','permission denied');
 perform pg_temp.entry_rejected('select public.transport_party_report_page(''documents'')','permission denied');
 execute 'reset role';
end $$;
rollback;
