-- Isolated local database only. Synthetic fixtures and requests roll back.
begin;
do $$
declare u uuid:=gen_random_uuid();code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 c uuid;b uuid;loc uuid;customer uuid;supplier uuid;ar uuid;ap uuid;cost uuid;cash_id uuid;acct uuid;
 trip uuid;trip2 uuid;sales_id uuid;sales2 uuid;rent uuid;rent2 uuid;bill uuid;bill2 uuid;
 result jsonb;again jsonb;payload jsonb;request_id uuid:=gen_random_uuid();payment_id uuid;receipt_id uuid;
 employee uuid;path text;vehicle uuid;vehicle2 uuid; count_before bigint;rejected boolean;other_bu uuid;other_loc uuid;other_c uuid;v numeric;
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

 insert into public.transport_vehicles(company_id,business_unit_id,vehicle_no) values(c,b,'Original') returning id into vehicle;
 insert into public.transport_vehicles(company_id,business_unit_id,vehicle_no) values(c,b,'Replacement') returning id into vehicle2;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,vehicle_id,from_location,to_location,sale_type)
 values(c,b,'',current_date,customer,vehicle,'A','B','credit') returning id into trip;
 rejected:=false;begin perform public.transport_finalize_initial_customer_rate(trip,100.123);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Fractional cent rate accepted';end if;
 perform public.transport_finalize_initial_customer_rate(trip,1000);
 rejected:=false;begin perform public.transport_finalize_initial_customer_rate(trip,2000);exception when others then rejected:=true;end;
 if not rejected or (select customer_rate from public.transport_trips where id=trip)<>1000 then raise exception 'One-time rate overwritten';end if;
 if (select count(*) from public.transport_trip_audit where trip_id=trip and action='customer_rate_finalize')<>1 then raise exception 'Initial rate audit count incorrect';end if;
 result:=public.transport_post_customer_bill(trip,current_date,false);
 perform public.transport_replace_trip_assignment(trip,vehicle2,null,'Vehicle breakdown');
 if (select vehicle_id from public.transport_trips where id=trip)<>vehicle2 then raise exception 'Replacement did not apply';end if;
 if exists(select 1 from public.transport_vehicle_account_movements where trip_ids=array[trip] and account_id<>vehicle) or not exists(select 1 from public.transport_vehicle_account_movements where trip_ids=array[trip] and account_id=vehicle) then raise exception 'Historical bill moved to replacement vehicle';end if;
 if (select sum(vc.revenue-vc.cost) from public.transport_vehicle_contributions vc where trip_id=trip and account_id=vehicle)<>1000 then raise exception 'Vehicle contribution differs from posted revenue';end if;
 execute 'set local role authenticated';
 if (select sum(vc.revenue-vc.cost) from public.transport_vehicle_contributions vc where trip_id=trip)<>1000 then raise exception 'Authenticated historical contribution missing';end if;
 execute 'reset role';
 -- Simulate an assignment first recorded after an older bill (isolated fixture only).
 insert into public.transport_action_gate(transaction_id,trip_id,action) values(txid_current(),trip,'assignment_replace');
 update public.transport_trip_assignments set created_at=clock_timestamp()+interval '1 day' where trip_id=trip;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=trip;
 if exists(select 1 from public.transport_vehicle_account_movements where trip_ids=array[trip]) or exists(select 1 from public.transport_vehicle_contributions where trip_id=trip) then raise exception 'Pre-history bill guessed a later recorded assignment';end if;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,vehicle_id,from_location,to_location,sale_type)
 values(c,b,'',current_date,customer,vehicle,'A','B','credit') returning id into trip2;
 update public.business_unit_memberships set permissions=jsonb_set(coalesce(permissions,'{}'),'{transport_actions}',jsonb_build_object('customer_rate_finalize',false),true) where company_id=c and business_unit_id=b and user_id=u;
 execute 'set local role authenticated';
 rejected:=false;begin perform public.transport_finalize_initial_customer_rate(trip2,999);exception when others then if sqlerrm not like 'Rate finalization permission required%' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'Explicit rate permission denial ignored';end if;
 if (select customer_rate_state from public.transport_trips where id=trip2)<>'pending' then raise exception 'Denied rate altered Trip';end if;
 execute 'reset role';
 if has_function_privilege('anon','public.transport_finalize_initial_customer_rate(uuid,numeric)','EXECUTE') then raise exception 'Anonymous initial rate execution granted';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 rejected:=false;begin perform public.transport_finalize_initial_customer_rate(trip2,999);exception when others then if sqlerrm not like 'Trip outside active business%' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'Out-of-scope rate accepted';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 raise notice 'PASS initial finalize, repeat rejection, audit, historical vehicle, net contribution, authenticated reads';
end $$;
rollback;
