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
 payload:=jsonb_build_array(jsonb_build_object('trip_date',current_date-10,'customer_id',customer,'truck_type_id',tt,
  'vehicle_id',v,'driver_id',d,'from_location_id',from_id,'to_location_id',to_id,'sale_type','credit',
  'ppr_status','received','ppr_received_by_employee_id',employee,'ppr_received_date',current_date-9,
  'customer_rate',1000,'supplier_rent',300,'driver_pay',50));
 supplier_payload:=payload;
 execute 'set local role authenticated';
 result:=public.transport_create_trips(request_id,c,b,payload);trip:=(result->0->>'id')::uuid;number:=result->0->>'trip_no';
 if result is distinct from public.transport_create_trips(request_id,c,b,payload) then raise exception 'Retry is not idempotent';end if;
 if (select ownership_id from public.transport_trips where id=trip) is distinct from ownership or
 (select owner_supplier_id from public.transport_trips where id=trip) is distinct from supplier then raise exception 'Historical owner resolution failed';end if;
 if not exists(select 1 from public.transport_trips where id=trip and customer_rate_snapshot=1000 and customer_rate_reference_id=rate and customer_rate_source='agreed' and owner_rent=0 and driver_pay=50)
 then raise exception 'Rate/Driver Pay snapshots or legacy rent zero missing';end if;
 if not exists(select 1 from public.transport_trip_supplier_rents where trip_id=trip and supplier_id=supplier and finalized_amount_snapshot=300 and state='finalized') then raise exception 'Supplier rent separate snapshot missing';end if;
 if not exists(select 1 from public.transport_trip_assignments where trip_id=trip and driver_supplier_id_snapshot=supplier and driver_mobile_snapshot='200') then raise exception 'Driver assignment relationship/mobile snapshot missing';end if;
 if exists(select 1 from public.transport_customer_document_trips where trip_id=trip) then raise exception 'Trip creation posted billing';end if;
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',request_id,c,b,jsonb_set(payload,'{0,customer_rate}','999')),'Request ID already used');
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),other_c,b,payload),'active Company/Business Unit');
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,other_bu,payload),'active Company/Business Unit');
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,jsonb_set(payload,'{0,customer_id}',to_jsonb(other_customer))),'same-company Customer');
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,jsonb_set(payload,'{0,vehicle_id}',to_jsonb(foreign_v))),'same-workspace Vehicle');
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,jsonb_set(payload,'{0,truck_type_id}',to_jsonb(tt2))),'does not match Truck Type');
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,jsonb_set(payload,'{0,trip_date}',to_jsonb(current_date-40))),'Ownership History');
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,jsonb_set(payload,'{0,ppr_received_date}','null')),'Employee and Date');
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,jsonb_set(payload,'{0,ppr_received_by_employee_id}','null')),'Employee and Date');
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,jsonb_set(payload,'{0,sale_type}','"other"')),'Cash or Credit');
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,jsonb_set(payload,'{0,customer_rate}','"NaN"')),'Amounts');
 perform pg_temp.entry_rejected(format('insert into public.transport_trips(company_id,business_unit_id,trip_no,from_location,to_location) values(%L,%L,'''',''From'',''To'')',c,b),'canonical Transport New Trip');
 -- Bulk import is one transaction; invalid later row cannot leave the first row saved.
 select count(*) into before_count from public.transport_trips where company_id=c;
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,payload||jsonb_set(payload,'{0,sale_type}','"bad"')),'Cash or Credit');
 if (select count(*) from public.transport_trips where company_id=c)<>before_count then raise exception 'Bulk statement partially committed';end if;
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,jsonb_set(payload,'{0,owner_name_snapshot}','"fake owner"')),'Unsupported Trip fields');
 -- Company-owned Cash, PPR Pending: no supplier rent fabricated, no receipt details required.
 payload:=jsonb_build_array(jsonb_build_object('trip_date',current_date,'customer_id',customer,'truck_type_id',tt,'vehicle_id',company_v,
 'driver_id',company_d,'from_location_id',from_id,'to_location_id',to_id,'sale_type','cash','ppr_status','pending'));
 result:=public.transport_create_trips(gen_random_uuid(),c,b,payload);trip2:=(result->0->>'id')::uuid;
 if not exists(select 1 from public.transport_trips where id=trip2 and owner_supplier_id is null and customer_rate_state='pending' and sale_type='cash') or
 exists(select 1 from public.transport_trip_supplier_rents where trip_id=trip2) then raise exception 'Company-owned pending semantics failed';end if;
 if number=(result->0->>'trip_no') then raise exception 'Trip number reused';end if;
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,jsonb_set(payload,'{0,supplier_rent}','1')),'Supplier Owned Vehicle');
 update public.transport_drivers set mobile='999' where id=d;
 update public.transport_customer_rates set amount=2000 where id=rate;
 update public.transport_vehicle_ownership set effective_to=current_date-1,change_reason='Actual handover' where id=ownership;
 insert into public.transport_vehicle_ownership(company_id,business_unit_id,vehicle_id,owner_type,effective_from) values(c,b,v,'company',current_date);
 if not exists(select 1 from public.transport_trips where id=trip and ownership_id=ownership and owner_name_snapshot='Entry Supplier' and customer_rate_snapshot=1000) or
 not exists(select 1 from public.transport_trip_assignments where trip_id=trip and driver_mobile_snapshot='200') then raise exception 'Historical Trip/driver/rate rewritten';end if;
 execute 'reset role';
 -- Active masters are checked again on the server, after any spreadsheet preview.
 execute 'set local role authenticated';
 update public.customers set is_active=false where id=customer;
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,payload),'same-company Customer');
 update public.customers set is_active=true where id=customer;
 update public.transport_truck_types set is_active=false where id=tt;
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,payload),'same-workspace Truck Type');
 update public.transport_truck_types set is_active=true where id=tt;
 update public.transport_drivers set is_active=false where id=company_d;
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,payload),'same-workspace Driver');
 update public.transport_drivers set is_active=true where id=company_d;
 update public.transport_locations set is_active=false where id=from_id;
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,payload),'same-workspace From');
 update public.transport_locations set is_active=true where id=from_id;
 update public.transport_locations set is_active=false where id=to_id;
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,payload),'same-workspace To');
 update public.transport_locations set is_active=true where id=to_id;
 update public.transport_vehicles set is_active=false where id=company_v;
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,payload),'same-workspace Vehicle');
 update public.transport_vehicles set is_active=true where id=company_v;
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,payload||payload),'Duplicate Trip row');
 execute 'reset role';
 update public.business_unit_memberships set permissions=jsonb_build_object('transport_actions',jsonb_build_object('vehicle_owner_change',false)) where business_unit_id=b and user_id=u;
 execute 'set local role authenticated';
 perform pg_temp.entry_rejected(format('select public.transport_create_vehicle_master(''Denied Owner'',%L,''company'',null,%L)',tt,current_date),'permissions required');
 execute 'reset role';
 update public.business_unit_memberships set permissions=jsonb_build_object('transport_actions',jsonb_build_object('rent_finalize',false)) where business_unit_id=b and user_id=u;
 execute 'set local role authenticated';
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,supplier_payload),'Rent finalization permission');
 execute 'reset role';
 update public.business_unit_memberships set permissions='{}' where business_unit_id=b and user_id=u;
 insert into public.transport_financial_permissions(company_id,business_unit_id,user_id,action,allowed,updated_by) values(c,b,u,'driver',false,u);
 execute 'set local role authenticated';
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,supplier_payload),'driver permission');
 execute 'reset role';
 update public.transport_financial_permissions set allowed=true where company_id=c and business_unit_id=b and user_id=u and action='driver';
 -- Each server permission denial is tested even if the UI hides its action.
 update public.business_unit_memberships set permissions=jsonb_build_object(
   'transport_actions',jsonb_build_object('master_manage',false),
   'transport',jsonb_build_object('create',false)
 ) where business_unit_id=b and user_id=u;
 execute 'set local role authenticated';
 perform pg_temp.entry_rejected('select public.create_customer_with_ar(''Denied Customer'',null,null,null)','master permission');
 perform pg_temp.entry_rejected('select public.create_supplier_with_ap(''Denied Supplier'',null,null,null)','master permission');
 perform pg_temp.entry_rejected(format('select public.transport_create_vehicle_master(''Denied Vehicle'',%L,''company'',null,%L)',tt,current_date),'permissions required');
 perform pg_temp.entry_rejected(format('insert into public.transport_drivers(company_id,business_unit_id,driver_name,driver_type) values(%L,%L,''Denied Driver'',''company'')',c,b),'master permission');
 perform pg_temp.entry_rejected(format('insert into public.transport_truck_types(company_id,business_unit_id,name) values(%L,%L,''Denied Type'')',c,b),'permission');
 perform pg_temp.entry_rejected(format('insert into public.transport_locations(company_id,business_unit_id,name) values(%L,%L,''Denied Place'')',c,b),'permission');
 execute 'reset role';
 update public.business_unit_memberships set permissions=jsonb_build_object('transport_actions',jsonb_build_object('trip_create',false)) where business_unit_id=b and user_id=u;
 execute 'set local role authenticated';
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,payload),'Trip create permission');
 execute 'reset role';
 update public.business_unit_memberships set permissions=jsonb_build_object('transport_actions',jsonb_build_object('customer_rate_finalize',false)) where business_unit_id=b and user_id=u;
 execute 'set local role authenticated';
 perform pg_temp.entry_rejected(format('select public.transport_create_trips(%L,%L,%L,%L::jsonb)',gen_random_uuid(),c,b,jsonb_set(payload,'{0,customer_rate}','100')),'rate finalization permission');
 execute 'reset role';
 if has_function_privilege('anon','public.transport_create_trips(uuid,uuid,uuid,jsonb)','EXECUTE') or has_table_privilege('authenticated','public.transport_trip_entry_requests','INSERT')
 then raise exception 'Entry privileged state exposed';end if;
end $$;
rollback;
