-- Isolated local PostgreSQL only. Synthetic data rolls back; never use production.
begin;
create function pg_temp.expect_rejected(statement text, expected text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
   if sqlerrm not ilike '%'||expected||'%' then raise exception 'Unexpected failure [%]: %',expected,sqlerrm;end if;
   return;
 end;
 raise exception 'Expected rejection missing: %',expected;
end $$;
do $$
declare u uuid:=gen_random_uuid(); token text:=substr(replace(gen_random_uuid()::text,'-',''),1,10);
 c uuid;b uuid;c2 uuid;b2 uuid;other_bu uuid;s uuid;s2 uuid;tt uuid;v uuid;d uuid;expense uuid;
 ownership uuid;tr uuid;customer uuid;warehouse uuid;tbl text;count_rows bigint; fields jsonb; column_names text;
begin
 insert into auth.users(id,role,email,created_at,updated_at) values(u,'authenticated','master-'||token||'@navilo.test',now(),now());
 insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
 values(u,u,'master-'||token||'@navilo.test','admin','user',true);
 insert into public.companies(name,code,status) values('Transport master fixture','TM'||token,'active') returning id into c;
 insert into public.companies(name,code,status) values('Unrelated steel fixture','SM'||token,'active') returning id into c2;
 select id into b from public.business_units where company_id=c and is_default;
 select id into b2 from public.business_units where company_id=c2 and is_default;
 update public.business_units set unit_type='transport' where id=b;
 insert into public.business_units(company_id,code,name,unit_type,is_active) values(c,'TM2','Other Transport BU','transport',true) returning id into other_bu;
 insert into public.company_memberships(company_id,user_id,role,is_active) values(c,u,'company_owner',true),(c2,u,'company_owner',true);
 insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
 values(c,b,u,'company_owner',true),(c2,b2,u,'company_owner',true),(c,other_bu,u,'company_owner',true)
 on conflict(business_unit_id,user_id) do update set is_active=true;
 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled)
 select c,b,m,true from unnest(array['master','transport','sales','purchase','inventory','accounting']) m
 on conflict(business_unit_id,module_key) do update set enabled=true;
 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled)
 select c,other_bu,m,true from unnest(array['master','transport','sales','purchase','inventory','accounting']) m
 on conflict(business_unit_id,module_key) do update set enabled=true;
 update public.user_profiles set last_company_id=c,last_business_unit_id=b where id=u;
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.suppliers(user_id,company_id,name) values(u,c,'Owner One') returning id into s;
 insert into public.customers(user_id,company_id,name) values(u,c,'Transport Customer') returning id into customer;
 insert into public.transport_truck_types(company_id,business_unit_id,name) values(c,b,' Flatbed ') returning id into tt;
 perform pg_temp.expect_rejected(format('insert into public.transport_truck_types(company_id,business_unit_id,name) values(%L,%L,%L)',c,b,'flatbed'),'duplicate');
 insert into public.transport_locations(company_id,business_unit_id,name,city_area) values(c,b,'Jeddah  Port','Jeddah');
 perform pg_temp.expect_rejected(format('insert into public.transport_locations(company_id,business_unit_id,name) values(%L,%L,%L)',c,b,' jeddah port '),'Duplicate');
 insert into public.transport_vehicle_expense_types(company_id,business_unit_id,name,expense_scope) values(c,b,'Workshop Labour','vehicle') returning id into expense;
 update public.transport_vehicle_expense_types set expense_scope='both' where id=expense;
 perform pg_temp.expect_rejected(format('update public.transport_vehicle_expense_types set expense_scope=%L where id=%L','invalid',expense),'transport_expense_scope_check');
 -- Legacy values stay unclassified; no ownership/driver/expense guessing.
 insert into public.transport_drivers(company_id,business_unit_id,driver_name,owner_name) values(c,b,'Legacy Driver','Historical Sponsor');
 if exists(select 1 from public.transport_drivers where company_id=c and driver_name='Legacy Driver' and (driver_type is not null or supplier_id is not null)) then raise exception 'Legacy Driver classification fabricated';end if;
 insert into public.transport_drivers(company_id,business_unit_id,driver_name,driver_code,driver_type,supplier_id,identity_no,driving_licence_no,licence_expiry)
 values(c,b,'Supplier Driver','D-1','supplier',s,'ID-1','LIC-1',current_date+365) returning id into d;
 perform pg_temp.expect_rejected(format('insert into public.transport_drivers(company_id,business_unit_id,driver_name,driver_type) values(%L,%L,%L,%L)',c,b,'Missing Supplier','supplier'),'Supplier is required');
 perform pg_temp.expect_rejected(format('insert into public.transport_drivers(company_id,business_unit_id,driver_name,driver_code,driver_type) values(%L,%L,%L,%L,%L)',c,b,'Another Driver',' d-1 ','company'),'Driver Code already exists');
 v:=public.transport_create_vehicle_master('  Plate-01  ',tt,'supplier',s,current_date-1);
 select id into ownership from public.transport_vehicle_ownership where vehicle_id=v;
 if ownership is null or (select owner_name from public.transport_vehicles where id=v)<>'Owner One' then raise exception 'Vehicle and owner history not created together';end if;
 perform pg_temp.expect_rejected(format('select public.transport_create_vehicle_master(%L,%L,%L,%L,%L)','plate-01',tt,'supplier',s,current_date),'Duplicate');
 perform pg_temp.expect_rejected(format('select public.transport_create_vehicle_master(%L,%L,%L,null,%L)','No supplier',tt,'supplier',current_date),'active Supplier');
 perform pg_temp.expect_rejected(format('select public.transport_create_vehicle_master(%L,%L,%L,%L,null)','No date',tt,'supplier',s),'Effective From');
 perform pg_temp.expect_rejected(format('update public.transport_vehicles set supplier_id=null,ownership_type=%L where id=%L','company',v),'Vehicle Ownership History');
 perform pg_temp.expect_rejected(format('insert into public.transport_vehicle_ownership(company_id,business_unit_id,vehicle_id,owner_type,effective_from) values(%L,%L,%L,%L,%L)',c,b,v,'company',current_date),'overlap');
 perform pg_temp.expect_rejected(format('update public.transport_vehicle_ownership set owner_type=%L,supplier_id=null where id=%L','company',ownership),'immutable');
 perform pg_temp.expect_rejected(format('update public.transport_vehicle_ownership set effective_to=%L where id=%L',current_date,ownership),'requires a reason');
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,vehicle_id,from_location,to_location)
 values(c,b,'',current_date,customer,v,'A','B') returning id into tr;
 if (select ownership_id from public.transport_trips where id=tr) is distinct from ownership then raise exception 'Trip failed to retain dated ownership';end if;
 perform pg_temp.expect_rejected(format('update public.transport_vehicle_ownership set effective_to=%L,change_reason=%L where id=%L',current_date-1,'Bad history correction',ownership),'historical Trips');
 update public.transport_vehicle_ownership set effective_to=current_date,change_reason='Owner contract ends' where id=ownership;
 insert into public.transport_vehicle_ownership(company_id,business_unit_id,vehicle_id,owner_type,effective_from)
 values(c,b,v,'company',current_date+1);
 if (select ownership_id from public.transport_trips where id=tr) is distinct from ownership or
 (select owner_name_snapshot from public.transport_trips where id=tr)<>'Owner One' then raise exception 'Old Trip ownership rewritten';end if;
 -- Current owner projection changes only from an explicitly dated period.
 v:=public.transport_create_vehicle_master('Projection',tt,'company',null,current_date-2);
 update public.transport_vehicle_ownership set effective_to=current_date-1,change_reason='Owner handover' where vehicle_id=v;
 insert into public.transport_vehicle_ownership(company_id,business_unit_id,vehicle_id,owner_type,supplier_id,owner_name_snapshot,effective_from)
 values(c,b,v,'third_party',s,'Untrusted free-text owner',current_date);
 if (select owner_name_snapshot from public.transport_vehicle_ownership where vehicle_id=v and effective_from=current_date)<>'Owner One' then raise exception 'Authoritative ownership name accepted free text';end if;
 if (select supplier_id from public.transport_vehicles where id=v) is distinct from s then raise exception 'Current owner projection failed';end if;
 if has_function_privilege('anon','public.transport_create_vehicle_master(text,uuid,text,uuid,date)','EXECUTE')
 or has_table_privilege('authenticated','public.transport_master_owner_gate','INSERT') then raise exception 'Master privileged gate exposed';end if;
 -- Denied master_manage also denies direct status updates and RPC creation.
 update public.business_unit_memberships set permissions=jsonb_build_object('transport_actions',jsonb_build_object('master_manage',false)) where business_unit_id=b and user_id=u;
 execute 'set local role authenticated';
 perform pg_temp.expect_rejected(format('update public.transport_drivers set is_active=false where id=%L',d),'master permission');
 perform pg_temp.expect_rejected(format('select public.transport_create_vehicle_master(%L,%L,%L,null,%L)','Denied',tt,'company',current_date),'permissions required');
 execute 'reset role';
 update public.business_unit_memberships set permissions='{}' where business_unit_id=b and user_id=u;
 -- Same names are allowed in another Transport BU, but invisible from the selected BU.
 update public.user_profiles set last_business_unit_id=other_bu where id=u;
 insert into public.transport_truck_types(company_id,business_unit_id,name) values(c,other_bu,'Flatbed');
 insert into public.transport_vehicles(company_id,business_unit_id,vehicle_no) values(c,other_bu,'Plate-01');
 update public.user_profiles set last_company_id=c2,last_business_unit_id=b2 where id=u;
 insert into public.suppliers(user_id,company_id,name) values(u,c2,'Steel Supplier') returning id into s2;
 foreach tbl in array array['items','categories','uom','warehouses','godowns','employees','customers'] loop
   if tbl='items' then fields:=jsonb_build_object('company_id',c2,'user_id',u,'name','Steel item','sku','ST-'||token);
   elsif tbl='uom' then fields:=jsonb_build_object('company_id',c2,'name','Steel UOM','symbol','ST'||token);
   elsif tbl='godowns' then
     select id into warehouse from public.warehouses where company_id=c2 order by id limit 1;
     fields:=jsonb_build_object('company_id',c2,'name','Steel Godown','warehouse_id',warehouse);
   elsif tbl='employees' then fields:=jsonb_build_object('company_id',c2,'user_id',u,'name','Steel Employee');
   else fields:=jsonb_build_object('company_id',c2,'name','Steel '||tbl);end if;
   select string_agg(quote_ident(key),',') into column_names from jsonb_object_keys(fields) key;
   execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1)',tbl,column_names,column_names,tbl) using fields;
 end loop;
 insert into public.charge_master(company_id,user_id,charge_key,charge_name) values(c2,u,'ST'||token,'Steel Charge');
 update public.user_profiles set last_company_id=c,last_business_unit_id=b where id=u;
 perform pg_temp.expect_rejected(format('insert into public.transport_drivers(company_id,business_unit_id,driver_name,driver_type,supplier_id) values(%L,%L,%L,%L,%L)',c,b,'Foreign driver','supplier',s2),'same company');
 perform pg_temp.expect_rejected(format('insert into public.transport_vehicle_ownership(company_id,business_unit_id,vehicle_id,owner_type,supplier_id,effective_from) values(%L,%L,%L,%L,%L,%L)',c,b,v,'third_party',s2,current_date+10),'company mismatch');
 execute 'set local role authenticated';
 foreach tbl in array array['items','categories','uom','customers','suppliers','employees','warehouses','godowns','charge_master'] loop
   execute format('select count(*) from public.%I where company_id=$1',tbl) into count_rows using c2;
   if count_rows<>0 then raise exception 'Cross-company RLS leak: %',tbl;end if;
 end loop;
 foreach tbl in array array['transport_vehicles','transport_drivers','transport_truck_types','transport_locations','transport_vehicle_expense_types','transport_vehicle_ownership'] loop
   execute format('select count(*) from public.%I where company_id=$1 and business_unit_id=$2',tbl) into count_rows using c,other_bu;
   if count_rows<>0 then raise exception 'Cross-BU RLS leak: %',tbl;end if;
 end loop;
 update public.suppliers set name='Forbidden' where id=s2;
 get diagnostics count_rows=row_count;if count_rows<>0 then raise exception 'Cross-company Supplier update accepted';end if;
 update public.transport_drivers set mobile='Forbidden' where business_unit_id=other_bu;
 get diagnostics count_rows=row_count;if count_rows<>0 then raise exception 'Cross-BU Driver update accepted';end if;
 execute 'reset role';
 if (select name from public.suppliers where id=s2)<>'Steel Supplier' then raise exception 'Unrelated supplier changed';end if;
end $$;
rollback;
