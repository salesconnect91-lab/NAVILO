-- Isolated local database only. Synthetic fixtures and requests roll back.
begin;
do $$
declare u uuid:=gen_random_uuid();code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 c uuid;b uuid;loc uuid;customer uuid;supplier uuid;ar uuid;ap uuid;cost uuid;cash_id uuid;acct uuid;
 trip uuid;trip2 uuid;sales_id uuid;sales2 uuid;rent uuid;rent2 uuid;bill uuid;bill2 uuid;
 result jsonb;again jsonb;payload jsonb;request_id uuid:=gen_random_uuid();payment_id uuid;receipt_id uuid;
 history_job jsonb;history_manifest jsonb;history_settings jsonb;history_rows jsonb;history_id uuid;f uuid;dest uuid;history_vehicle uuid;bad jsonb;history_status jsonb;employee uuid;path text;vehicle uuid;vehicle2 uuid; count_before bigint;rejected boolean;other_bu uuid;other_loc uuid;other_c uuid;v numeric;
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


 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled) values(c,b,'master',true) on conflict(business_unit_id,module_key) do update set enabled=true;
 insert into public.transport_locations(company_id,business_unit_id,name) values(c,b,'History From') returning id into f;
 insert into public.transport_locations(company_id,business_unit_id,name) values(c,b,'History To') returning id into dest;
 history_vehicle:=public.transport_create_vehicle_master('HIST-S',null,'supplier',supplier,current_date-30);

 history_manifest:=(select jsonb_agg(ids order by batch) from (select (i-1)/25 batch,jsonb_agg('SCALE-'||i order by i) ids from generate_series(1, NAVILO_HISTORY_COUNT) i group by (i-1)/25) a);
 history_settings:=jsonb_build_object('cutoff',current_date,'cost_account',acct,'opening_reviewed',true);
 payload:=jsonb_build_object('source_id','OLD-1','trip',jsonb_build_object('trip_date',current_date-2,'customer_id',customer,'vehicle_id',history_vehicle,'from_location_id',f,'to_location_id',dest,'ppr_status','pending','sale_type','credit','customer_rate',2000,'supplier_rent',1700,'source_invoice_no','SOURCE-SHARED'),
 'customer_posted',true,'supplier_posted',true,'customer_date',current_date-2,'supplier_date',current_date-2,'customer_vat',false,'supplier_vat',false,
 'customer_gross',2000,'supplier_gross',1700,'received',600,'paid',1000,'customer_remaining',1400,'supplier_remaining',700,
 'payments',jsonb_build_array(jsonb_build_object('side','customer','date',current_date-1,'amount',600,'account_id',cash_id,'method','cash','reference','RCPT-SHARED'),
 jsonb_build_object('side','supplier','date',current_date-1,'amount',500,'account_id',cash_id,'method','cash','reference','PAY-SHARED'),
 jsonb_build_object('side','supplier','date',current_date-1,'amount',500,'account_id',cash_id,'method','cash','reference','PAY-SHARED')));

 payload:=jsonb_set(payload,'{trip,source_invoice_no}','null');
 execute 'set local role authenticated';
 history_job:=public.transport_prepare_history_import(repeat('b',64),'history-scale.xlsx',history_manifest,history_settings);history_id:=(history_job->>'id')::uuid;
 execute 'reset role';
 create temp table navilo_history_scale_context as select c company_id,b business_unit_id,u user_id,history_id job_id,payload row_template;
 grant select on navilo_history_scale_context to authenticated;
end $$;
create function pg_temp.history_scale_batch(n integer) returns void language plpgsql as $$
declare ctx navilo_history_scale_context;rows jsonb;result jsonb;
begin
 select * into ctx from navilo_history_scale_context;
 perform set_config('request.jwt.claim.sub',ctx.user_id::text,true);execute 'set local role authenticated';
 select jsonb_agg(jsonb_set(ctx.row_template,'{source_id}',to_jsonb('SCALE-'||i)) order by i) into rows from generate_series(n*25+1,(n+1)*25) i;
 result:=public.transport_import_history_batch(ctx.job_id,n,rows);
 if jsonb_array_length(result)<>25 then raise exception 'Scale batch missing outcomes';end if;
 execute 'reset role';
end $$;
commit;
-- NAVILO_HISTORY_BATCHES
begin;
 do $$
 declare ctx navilo_history_scale_context;ar uuid;ap uuid;cash_id uuid;s jsonb;
 begin
 select * into ctx from navilo_history_scale_context;
 perform set_config('request.jwt.claim.sub',ctx.user_id::text,true);
 s:=public.transport_history_import_status();
 if (s->'totals'->>'trips')::integer<>NAVILO_HISTORY_COUNT or (s->'totals'->>'received')::numeric<>NAVILO_HISTORY_COUNT*600
 or (s->'totals'->>'paid')::numeric<>NAVILO_HISTORY_COUNT*1000 then raise exception 'Historical scale control totals wrong';end if;
 select account_id into ar from public.account_mappings where company_id=ctx.company_id and mapping_key='accounts_receivable';
 select account_id into ap from public.account_mappings where company_id=ctx.company_id and mapping_key='accounts_payable';
 select account_id into cash_id from public.account_mappings where company_id=ctx.company_id and mapping_key='cash';
 if (select count(*) from public.transport_trips where company_id=ctx.company_id)<>NAVILO_HISTORY_COUNT then raise exception 'Historical Trip scale mismatch';end if;
 if (select sum(jl.debit-jl.credit) from public.journal_lines jl join public.journal_entries j on j.id=jl.entry_id where j.company_id=ctx.company_id and j.status='posted' and jl.account_id=ar)<>NAVILO_HISTORY_COUNT*1400 then raise exception 'Historical scale AR mismatch';end if;
 if (select sum(jl.credit-jl.debit) from public.journal_lines jl join public.journal_entries j on j.id=jl.entry_id where j.company_id=ctx.company_id and j.status='posted' and jl.account_id=ap)<>NAVILO_HISTORY_COUNT*700 then raise exception 'Historical scale AP mismatch';end if;
 if (select sum(jl.debit-jl.credit) from public.journal_lines jl join public.journal_entries j on j.id=jl.entry_id where j.company_id=ctx.company_id and j.status='posted' and jl.account_id=cash_id)<>NAVILO_HISTORY_COUNT*(-400) then raise exception 'Historical scale cash mismatch';end if;
 end $$;
rollback;
