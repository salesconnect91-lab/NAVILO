-- Synthetic fixtures in isolated PostgreSQL only; never run on production.
begin;
do $$
declare
 u uuid:=gen_random_uuid();code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 c uuid;b uuid;loc uuid;customer uuid;f uuid;dest uuid;t1 uuid;t2 uuid;
 made jsonb;payload jsonb;answer jsonb;before_rows jsonb;after_rows jsonb;register jsonb;
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
 made:=public.transport_create_trips(gen_random_uuid(),c,b,jsonb_build_array(
 jsonb_build_object('trip_date',current_date-1,'customer_id',customer,'from_location_id',f,'to_location_id',dest,'notes','Legacy CSV Trip 101; Original identity'),
 jsonb_build_object('trip_date',current_date-2,'customer_id',customer,'from_location_id',f,'to_location_id',dest,'notes','Legacy CSV Trip 102; Original identity')));
 t1:=(made->0->>'id')::uuid;t2:=(made->1->>'id')::uuid;
 select jsonb_agg(to_jsonb(t) order by id) into before_rows from transport_trips t where company_id=c;
 payload:=jsonb_build_array(
 jsonb_build_object('trip_id',t1,'source_company','Original CSV','source_trip_id','101','source_file_hash',source_hash,'source_row',2,'source_trip_date',current_date-1,
 'driver_name_snapshot','ALI-501055189','vehicle_no_snapshot','2490','owner_name_snapshot','Owner A','truck_type_snapshot','FLATBED'),
 jsonb_build_object('trip_id',t2,'source_company','Original CSV','source_trip_id','102','source_file_hash',source_hash,'source_row',3,'source_trip_date',current_date-2,
 'driver_name_snapshot','Driver B','vehicle_no_snapshot','2490','owner_name_snapshot','Owner B','truck_type_snapshot','LOWBED'));
 execute 'set local role authenticated';
 answer:=public.transport_attach_historical_trip_identity(payload);
 if answer<>jsonb_build_object('attached',2,'skipped',0) then raise exception 'FAIL attach';end if;
 answer:=public.transport_attach_historical_trip_identity(payload);
 if answer<>jsonb_build_object('attached',0,'skipped',2) then raise exception 'FAIL resume';end if;
 if (select vehicle_no from public.transport_trip_register where id=t1)<>'2490'
 or (select driver_name from public.transport_trip_register where id=t1)<>'ALI-501055189'
 or (select driver_name from public.transport_financial_register where id=t2)<>'Driver B'
 or (select owner_name from public.transport_financial_register where id=t1)<>'Owner A'
 or (select owner_name from public.transport_financial_register where id=t2)<>'Owner B'
 then raise exception 'FAIL Register snapshot display';end if;
 register:=public.transport_register_query(p_filters=>jsonb_build_object('search','ALI-501055189'),p_sort=>'driver');
 if (register->>'count')::integer<>1 or register->'rows'->0->>'driver_name'<>'ALI-501055189'
 or register->'rows'->0->>'vehicle_no'<>'2490' then raise exception 'FAIL Register search';end if;
 register:=public.transport_register_query(p_filters=>jsonb_build_object('vehicle','2490'),p_sort=>'driver');
 if (register->>'count')::integer<>2 then raise exception 'FAIL Plate filter';end if;
 rejected:=false;
 begin perform public.transport_attach_historical_trip_identity(jsonb_build_array((payload->0)||jsonb_build_object('vehicle_no_snapshot','WRONG')));
 exception when others then rejected:=position('different source evidence' in sqlerrm)>0;end;
 if not rejected then raise exception 'FAIL changed payload accepted';end if;
 rejected:=false;
 begin perform public.transport_attach_historical_trip_identity(jsonb_build_array((payload->0)||jsonb_build_object('trip_id',gen_random_uuid())));
 exception when others then rejected:=position('outside active workspace' in sqlerrm)>0;end;
 if not rejected then raise exception 'FAIL foreign Trip accepted';end if;
 rejected:=false;
 begin update public.transport_historical_trip_identity set driver_name_snapshot='Wrong' where trip_id=t1;
 exception when others then rejected:=sqlstate='42501';end;
 if not rejected then raise exception 'FAIL direct evidence mutation';end if;
 select jsonb_agg(to_jsonb(t) order by id) into after_rows from transport_trips t where company_id=c;
 if before_rows is distinct from after_rows then raise exception 'FAIL operational/financial Trip fields changed';end if;
 if exists(select 1 from transport_vehicles where company_id=c)
 or exists(select 1 from transport_drivers where company_id=c)
 or exists(select 1 from transport_vehicle_ownership where company_id=c)
 or exists(select 1 from journal_entries where company_id=c)
 then raise exception 'FAIL invented master/ownership/posting';end if;
 if has_function_privilege('anon','public.transport_attach_historical_trip_identity(jsonb)','execute')
 or has_table_privilege('authenticated','public.transport_historical_trip_identity','update')
 then raise exception 'FAIL excessive grants';end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 execute 'set local role authenticated';
 if exists(select 1 from public.transport_historical_trip_identity) then raise exception 'FAIL cross-tenant RLS';end if;
 rejected:=false;
 begin perform public.transport_attach_historical_trip_identity(payload);exception when others then rejected:=true;end;
 if not rejected then raise exception 'FAIL foreign caller accepted';end if;
 execute 'reset role';
 raise notice 'PASS historical identity: display, Register search/filter, idempotency, immutable evidence, scope, RLS, grants, no Trip changes, no false ownership or accounting';
end $$;
rollback;
