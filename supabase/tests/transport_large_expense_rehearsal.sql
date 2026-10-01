-- Isolated local database only. Synthetic fixtures and requests roll back.
begin;
do $$
declare u uuid:=gen_random_uuid();code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 c uuid;b uuid;loc uuid;customer uuid;supplier uuid;ar uuid;ap uuid;cost uuid;cash_id uuid;acct uuid;
 trip uuid;trip2 uuid;sales_id uuid;sales2 uuid;rent uuid;rent2 uuid;bill uuid;bill2 uuid;
 result jsonb;again jsonb;payload jsonb;request_id uuid:=gen_random_uuid();payment_id uuid;receipt_id uuid;
 employee uuid;path text; count_before bigint;rejected boolean;other_bu uuid;other_loc uuid;other_c uuid;v numeric;
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

 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,sale_type)
 values(c,b,'',current_date,customer,'A','B','credit') returning id into trip;
 select jsonb_agg(jsonb_build_object('trip_id',trip,'amount',1,'date',current_date,'reference','BATCH-'||n)) into payload from generate_series(1,500) n;
 result:=public.transport_post_cost_chunk(request_id,payload,supplier,acct,false);
 if jsonb_array_length(result->'documents')<>500 then raise exception '500-row batch truncated';end if;
 if (select count(*) from public.transport_service_cost_links where trip_id=trip)<>500 then raise exception 'Expense evidence count incorrect';end if;
 if (select sum(b.outstanding_gross) from public.transport_service_cost_links l join public.transport_service_document_balances b on b.order_id=l.purchase_order_id and b.side='supplier' where l.trip_id=trip)<>500 then raise exception '500-row expense AP balance incorrect';end if;
 if (select sum(jl.credit-jl.debit) from public.journal_lines jl join public.transport_service_cost_links l on l.journal_entry_id=jl.entry_id where l.trip_id=trip and jl.account_id=ap)<>500 then raise exception 'Expense balance differs from canonical AP';end if;
 again:=public.transport_post_cost_chunk(request_id,payload,supplier,acct,false);
 if again<>result or (select count(*) from public.transport_service_cost_links where trip_id=trip)<>500 then raise exception 'Retry duplicated expenses';end if;
 rejected:=false;begin perform public.transport_post_cost_chunk(request_id,payload,supplier,acct,true);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Request reused with changed VAT accepted';end if;
 rejected:=false;begin perform public.transport_post_cost_chunk(gen_random_uuid(),jsonb_build_array(jsonb_build_object('trip_id',trip,'amount',2,'date',current_date)),gen_random_uuid(),acct,false);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Invalid supplier accepted';end if;
 rejected:=false;begin perform public.transport_post_cost_chunk(gen_random_uuid(),jsonb_build_array(jsonb_build_object('trip_id',trip,'amount',2,'date',current_date)),supplier,gen_random_uuid(),false);exception when others then rejected:=true;end;
 if not rejected or (select count(*) from public.transport_service_cost_links where trip_id=trip)<>500 then raise exception 'Invalid account accepted or partial posting persisted';end if;
 raise notice 'PASS 500 expenses, canonical AP=500, idempotent retry, changed-payload and invalid supplier/account rejection';
end $$;
rollback;
