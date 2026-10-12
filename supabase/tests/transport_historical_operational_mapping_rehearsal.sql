-- Synthetic fixtures in isolated PostgreSQL only; never run on production.
begin;
do $$
declare
 u uuid:=gen_random_uuid();code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 c uuid;b uuid;loc uuid;customer uuid;f uuid;dest uuid;t1 uuid;t2 uuid;t3 uuid;
 made jsonb;payload jsonb;answer jsonb;before_rows jsonb;after_rows jsonb;register jsonb;raw1 jsonb;raw2 jsonb;raw3 jsonb;party uuid;tt uuid;rid uuid;cost numeric;
 rejected boolean;source_hash text:=repeat('a',64);
begin
 insert into auth.users(id,role,email,created_at,updated_at) values(u,'authenticated','identity-'||code||'@navilo.test',now(),now());
 insert into public.user_profiles(id,user_id,email,role,platform_role,is_active) values(u,u,'identity-'||code||'@navilo.test','admin','user',true);
 insert into public.companies(name,code,status) values('Identity rehearsal','ID'||code,'active') returning id into c;
 select id into strict b from public.business_units where company_id=c and is_default;
 update public.business_units set unit_type='transport' where id=b;
 insert into public.company_memberships(company_id,user_id,role,is_active) values(c,u,'company_owner',true);
 insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active) values(c,b,u,'company_owner',true)
 on conflict(business_unit_id,user_id) do update set is_active=true;
 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled)
 values(c,b,'transport',true),(c,b,'master',true),(c,b,'sales',true),(c,b,'purchase',true),(c,b,'accounting',true),(c,b,'settings',true)
 on conflict(business_unit_id,module_key) do update set enabled=true;
 insert into public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
 values(c,b,'ID','Identity branch','branch',true) returning id into loc;
 insert into public.operating_location_memberships(company_id,business_unit_id,operating_location_id,user_id,role,is_active)
 values(c,b,loc,u,'company_owner',true);
 update public.user_profiles set last_company_id=c,last_business_unit_id=b where id=u;
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.customers(user_id,company_id,name) values(u,c,'Identity Customer') returning id into customer;
 perform public.transport_set_party_billing_mode('customer',customer,'Cash');
 insert into public.transport_locations(company_id,business_unit_id,name) values(c,b,'Identity From') returning id into f;
 insert into public.transport_locations(company_id,business_unit_id,name) values(c,b,'Identity To') returning id into dest;

 insert into public.suppliers(user_id,company_id,name) values(u,c,'Source Supplier');
 insert into public.suppliers(user_id,company_id,name) values(u,c,'TWAKKAL') returning id into party;
 insert into public.transport_truck_types(company_id,business_unit_id,name) values(c,b,'FLATBED') returning id into tt;
 made:=public.transport_create_trips(gen_random_uuid(),c,b,jsonb_build_array(
 jsonb_build_object('trip_date',current_date-1,'customer_id',customer,'truck_type_id',tt,'from_location_id',f,'to_location_id',dest,'customer_rate',200,'source_invoice_no','INV-ORIGINAL','notes','Legacy CSV Trip 101; Original source'),
 jsonb_build_object('trip_date',current_date-2,'customer_id',customer,'truck_type_id',tt,'from_location_id',f,'to_location_id',dest,'customer_rate',200,'notes','Legacy CSV Trip 102; Original source'),
 jsonb_build_object('trip_date',current_date-3,'customer_id',customer,'truck_type_id',tt,'from_location_id',f,'to_location_id',dest,'customer_rate',200,'notes','Legacy CSV Trip 103; Original source')));
 t1:=(made->0->>'id')::uuid;t2:=(made->1->>'id')::uuid;t3:=(made->2->>'id')::uuid;
 rid:=public.transport_add_supplier_rent(t1,party,125,'Original unposted source rent');
 perform public.transport_attach_historical_trip_identity(jsonb_build_array(
 jsonb_build_object('trip_id',t1,'source_company','Original CSV','source_trip_id','101','source_file_hash',source_hash,'source_row',2,'source_trip_date',current_date-1,
 'driver_name_snapshot','Company Driver','vehicle_no_snapshot','2490','owner_name_snapshot','TWAKKAL','truck_type_snapshot','FLATBED'),
 jsonb_build_object('trip_id',t2,'source_company','Original CSV','source_trip_id','102','source_file_hash',source_hash,'source_row',3,'source_trip_date',current_date-2,
 'driver_name_snapshot','Company Driver','vehicle_no_snapshot','0','owner_name_snapshot','TWAKKAL','truck_type_snapshot','FLATBED'),
 jsonb_build_object('trip_id',t3,'source_company','Original CSV','source_trip_id','103','source_file_hash',source_hash,'source_row',4,'source_trip_date',current_date-3,
 'driver_name_snapshot','Supplier Driver','vehicle_no_snapshot','2490','owner_name_snapshot','Source Supplier','truck_type_snapshot','FLATBED')));
 raw1:=jsonb_build_array('101',to_char(current_date-1,'DD-Mon-YY'),'FLATBED','','INV-ORIGINAL','Identity Customer','Company Driver','TWAKKAL','2490','Identity From','Identity To','Original Receiver','','SUP-ORIGINAL','125','125','','125','0','','200','15','30','230','0','230','','0','0','75','Cash','');
 raw2:=jsonb_build_array('102',to_char(current_date-2,'DD-Mon-YY'),'FLATBED','','','Identity Customer','Company Driver','TWAKKAL','0','Identity From','Identity To','No Paper','','','0','0','','0','0','','200','15','30','230','0','230','','0','0','200','Cash','');
 raw3:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(raw2,'{0}',to_jsonb('103'::text)),'{1}',to_jsonb(to_char(current_date-3,'DD-Mon-YY'))),'{6}',to_jsonb('Supplier Driver'::text)),'{7}',to_jsonb('Source Supplier'::text)),'{8}',to_jsonb('2490'::text));
 payload:=jsonb_build_array(jsonb_build_object('trip_id',t1,'raw_source',raw1),jsonb_build_object('trip_id',t2,'raw_source',raw2),jsonb_build_object('trip_id',t3,'raw_source',raw3));
 select jsonb_agg(to_jsonb(t)-array['driver_id','vehicle_id','owner_supplier_id','owner_name_snapshot','ppr_status','ppr_received_by_name','ppr_received_date','ppr_received_by','updated_at'] order by id) into before_rows from public.transport_trips t where company_id=c;
 execute 'set local role authenticated';
 answer:=public.transport_complete_historical_operational_mapping(payload);
 if answer<>jsonb_build_object('mapped',3,'skipped',0) then raise exception 'FAIL mapping result %',answer;end if;
 answer:=public.transport_complete_historical_operational_mapping(payload);
 if answer<>jsonb_build_object('mapped',0,'skipped',3) then raise exception 'FAIL idempotency';end if;
 perform set_config('plan_cache_mode','force_generic_plan',true);
 register:=public.transport_register_query(p_filters=>jsonb_build_object('search','INV-ORIGINAL'));
 if current_setting('plan_cache_mode')<>'force_generic_plan' or not exists(select 1 from pg_proc where oid='public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure and 'plan_cache_mode=force_custom_plan'=any(proconfig))
 then raise exception 'FAIL Register scoped read plan or caller setting leak';end if;
 perform set_config('plan_cache_mode','auto',true);
 if (register->>'count')::integer<>1 or register->'rows'->0->>'invoice_no'<>'INV-ORIGINAL'
 or (register->'rows'->0->>'invoiced')::boolean or (register->'rows'->0->>'supplier_rent')::numeric<>125
 or register->'rows'->0->>'driver_name'<>'Company Driver' or register->'rows'->0->>'vehicle_no'<>'2490'
 then raise exception 'FAIL historical Register display %',register;end if;
 if (select ppr_received_date from public.transport_trips where id=t1) is not null
 or (select ppr_received_by_name from public.transport_trips where id=t1)<>'Original Receiver'
 or (select ppr_status from public.transport_trips where id=t1)<>'received'
 or (select ppr_status from public.transport_trips where id=t2)<>'pending'
 or (select vehicle_id from public.transport_trips where id=t2) is not null
 then raise exception 'FAIL paper evidence or placeholder plate';end if;
 rejected:=false;
 begin perform public.transport_complete_historical_operational_mapping(jsonb_build_array(jsonb_build_object('trip_id',t1,'raw_source',jsonb_set(raw1,'{14}','"999"'))));
 exception when others then rejected:=position('Different operational source' in sqlerrm)>0;end;
 if not rejected then raise exception 'FAIL source modification accepted';end if;
 rejected:=false;
 begin update public.transport_trips set ppr_received_date=current_date where id=t1;
 exception when others then rejected:=position('requires employee and date' in sqlerrm)>0;end;
 if not rejected then raise exception 'FAIL invented paper date accepted';end if;
 if has_table_privilege('authenticated','public.transport_historical_mapping_gate','insert')
 or has_table_privilege('authenticated','public.transport_historical_operational_mapping','update')
 or has_function_privilege('anon','public.transport_complete_historical_operational_mapping(jsonb)','execute')
 then raise exception 'FAIL source mapping privileges';end if;
 execute 'reset role';
 select jsonb_agg(to_jsonb(t)-array['driver_id','vehicle_id','owner_supplier_id','owner_name_snapshot','ppr_status','ppr_received_by_name','ppr_received_date','ppr_received_by','updated_at'] order by id) into after_rows from public.transport_trips t where company_id=c;
 if before_rows is distinct from after_rows then raise exception 'FAIL commercial values changed before=% after=%',before_rows,after_rows;end if;
 if exists(select 1 from public.transport_trip_supplier_rents where trip_id=t1)
 or (select archived_supplier_rent->>'id' from public.transport_historical_operational_mapping where trip_id=t1)<>rid::text
 or exists(select 1 from public.transport_vehicle_ownership where company_id=c)
 or exists(select 1 from public.journal_entries where company_id=c)
 or exists(select 1 from public.employees where company_id=c)
 or exists(select 1 from public.transport_historical_mapping_gate)
 or (select count(*) from public.transport_drivers where company_id=c and driver_type='company' and employee_id is null)<>1
 or (select count(*) from public.transport_drivers where company_id=c and driver_type='supplier' and supplier_id is not null and employee_id is null)<>1
 or (select ownership_type from public.transport_vehicles where company_id=c and vehicle_no='2490') is not null
 then raise exception 'FAIL archived cost or fabricated financial/employment/history evidence';end if;
 update public.business_unit_memberships set permissions=jsonb_build_object('transport_actions',jsonb_build_object('supplier_finance_view',false)) where company_id=c and business_unit_id=b and user_id=u;
 execute 'set local role authenticated';
 if exists(select 1 from public.transport_historical_operational_mapping) or exists(select 1 from public.transport_historical_trip_identity)
 then raise exception 'FAIL denied financial evidence permission';end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 execute 'set local role authenticated';
 if exists(select 1 from public.transport_historical_operational_mapping) then raise exception 'FAIL cross-company evidence access';end if;
 rejected:=false;
 begin perform public.transport_complete_historical_operational_mapping(payload);
 exception when others then rejected:=position('Authorized source operational import' in sqlerrm)>0;end;
 if not rejected then raise exception 'FAIL foreign actor import';end if;
 execute 'reset role';
end $$;
rollback;
select 'historical operational mapping PASS' as result;
