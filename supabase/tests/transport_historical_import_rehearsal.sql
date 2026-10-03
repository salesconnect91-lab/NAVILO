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
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status) values(u,c,b,loc,'CR-9999',current_date,'Counter threshold fixture','draft'),(u,c,b,loc,'SP-9999',current_date,'Counter threshold fixture','draft');
 history_manifest:='[["OLD-1","OLD-2"],["OLD-3"],["OLD-4"]]'::jsonb;
 history_settings:=jsonb_build_object('cutoff',current_date,'cost_account',acct,'opening_reviewed',true);
 payload:=jsonb_build_object('source_id','OLD-1','trip',jsonb_build_object('trip_date',current_date-2,'customer_id',customer,'vehicle_id',history_vehicle,'from_location_id',f,'to_location_id',dest,'ppr_status','pending','sale_type','credit','customer_rate',2000,'supplier_rent',1700,'source_invoice_no','SOURCE-SHARED'),
 'customer_posted',true,'supplier_posted',true,'customer_date',current_date-2,'supplier_date',current_date-2,'customer_vat',false,'supplier_vat',false,
 'customer_gross',2000,'supplier_gross',1700,'received',600,'paid',1000,'customer_remaining',1400,'supplier_remaining',700,
 'payments',jsonb_build_array(jsonb_build_object('side','customer','date',current_date-1,'amount',600,'account_id',cash_id,'method','cash','reference','RCPT-SHARED'),
 jsonb_build_object('side','supplier','date',current_date-1,'amount',500,'account_id',cash_id,'method','cash','reference','PAY-SHARED'),
 jsonb_build_object('side','supplier','date',current_date-1,'amount',500,'account_id',cash_id,'method','cash','reference','PAY-SHARED')));
 history_rows:=jsonb_build_array(payload,jsonb_set(payload,'{source_id}','"OLD-2"'));
 execute 'set local role authenticated';
 history_job:=public.transport_prepare_history_import(repeat('b',64),'history.xlsx',history_manifest,history_settings);history_id:=(history_job->>'id')::uuid;
 perform public.transport_cancel_empty_history_import(history_id);
 history_job:=public.transport_prepare_history_import(repeat('b',64),'history.xlsx',history_manifest,history_settings);history_id:=(history_job->>'id')::uuid;
 rejected:=false;begin perform public.transport_import_history_batch(history_id,1,'[]');exception when others then rejected:=true;end;
 if not rejected then raise exception 'History skipped next batch guard';end if;
 bad:=jsonb_set(history_rows,'{1,payments,0,account_id}',to_jsonb(gen_random_uuid()::text));
 rejected:=false;begin perform public.transport_import_history_batch(history_id,0,bad);exception when others then rejected:=true;end;
 if not rejected then raise exception 'History accepted foreign cash account';end if;
 if (select count(*) from public.transport_trips where company_id=c)<>0 then raise exception 'Historical failed batch partially saved Trip';end if;
 result:=public.transport_import_history_batch(history_id,0,history_rows);
 again:=public.transport_import_history_batch(history_id,0,history_rows);
 if result<>again then raise exception 'History retry changed answer';end if;
 rejected:=false;begin perform public.transport_cancel_empty_history_import(history_id);exception when others then rejected:=true;end;
 if not rejected then raise exception 'History allowed cancelling saved accounting';end if;
 if (select count(*) from public.transport_trips where company_id=c)<>2 then raise exception 'Same-date distinct sources missing/duplicated';end if;
 bad:=jsonb_set(history_rows,'{0,received}','601');
 rejected:=false;begin perform public.transport_import_history_batch(history_id,0,bad);exception when others then rejected:=true;end;
 if not rejected then raise exception 'History changed payload accepted';end if;
 rejected:=false;begin perform public.transport_prepare_history_import(repeat('c',64),'history-copy.xlsx',history_manifest,history_settings);exception when others then rejected:=true;end;
 if not rejected then raise exception 'One-time history accepted second dataset';end if;
 payload:=jsonb_build_object('source_id','OLD-3','trip',jsonb_build_object('trip_date',current_date-2,'customer_id',customer,'from_location_id',f,'to_location_id',dest,'ppr_status','pending','sale_type','cash','customer_rate',2000),
 'customer_posted',false,'supplier_posted',false,'customer_date','','supplier_date','','customer_vat',false,'supplier_vat',false,
 'customer_gross',0,'supplier_gross',0,'received',0,'paid',0,'customer_remaining',0,'supplier_remaining',0,'payments','[]'::jsonb);
 perform public.transport_import_history_batch(history_id,1,jsonb_build_array(payload));
 history_status:=public.transport_history_import_status();
 if (history_status->>'completed')::integer<>2 or (history_status->'totals'->>'trips')::integer<>3
 or (history_status->'totals'->>'received')::numeric<>1200 or (history_status->'totals'->>'paid')::numeric<>2000
 or (history_status->'totals'->>'customer_remaining')::numeric<>2800 or (history_status->'totals'->>'supplier_remaining')::numeric<>1400 then raise exception 'History control totals incorrect %',history_status;end if;
 execute 'reset role';
 insert into public.tax_rates(user_id,company_id,name,rate,applies_to,is_fixed,is_active,effective_from) values(u,c,'Historical VAT',18,'both',true,true,current_date-3);
 payload:=jsonb_build_object('source_id','OLD-4','trip',jsonb_build_object('trip_date',current_date-2,'customer_id',customer,'vehicle_id',history_vehicle,'from_location_id',f,'to_location_id',dest,'ppr_status','pending','sale_type','credit','customer_rate',100,'supplier_rent',100),
 'customer_posted',true,'supplier_posted',true,'customer_date',current_date-2,'supplier_date',current_date-2,'customer_vat',true,'supplier_vat',true,
 'customer_gross',118,'supplier_gross',118,'received',50,'paid',50,'customer_remaining',68,'supplier_remaining',68,
 'payments',jsonb_build_array(jsonb_build_object('side','customer','date',current_date-1,'amount',50,'account_id',cash_id,'method','cash','reference','VAT-R'),jsonb_build_object('side','supplier','date',current_date-1,'amount',50,'account_id',cash_id,'method','cash','reference','VAT-P')));
 execute 'set local role authenticated';
 bad:=jsonb_set(jsonb_set(payload,'{customer_gross}','117'),'{customer_remaining}','67');
 rejected:=false;begin perform public.transport_import_history_batch(history_id,2,jsonb_build_array(bad));exception when others then rejected:=true;end;
 if not rejected or (select count(*) from public.transport_trips where company_id=c)<>3 then raise exception 'VAT mismatch did not roll back all history evidence';end if;
 bad:=jsonb_set(payload,'{payments,0,date}',to_jsonb((current_date+1)::text));
 rejected:=false;begin perform public.transport_import_history_batch(history_id,2,jsonb_build_array(bad));exception when others then rejected:=true;end;
 if not rejected then raise exception 'History accepted payment beyond cutoff';end if;
 perform public.transport_import_history_batch(history_id,2,jsonb_build_array(payload));
 history_status:=public.transport_history_import_status();
 if (history_status->>'completed')::integer<>3 or (history_status->'totals'->>'trips')::integer<>4 then raise exception 'Historical VAT batch incomplete';end if;
 execute 'reset role';
 if not exists(select 1 from public.journal_entries where company_id=c and entry_no='CR-10000' and status='posted') or not exists(select 1 from public.journal_entries where company_id=c and entry_no='SP-10000' and status='posted') then raise exception 'Canonical payment number truncated past 9,999';end if;
 if (select count(*) from public.sales_orders where company_id=c and status='posted')<>3
 or (select count(*) from public.purchase_orders where company_id=c and status='posted')<>3 then raise exception 'Posted/unposted history invoice count mismatch';end if;
 if (select sum(jl.debit-jl.credit) from public.journal_lines jl join public.journal_entries j on j.id=jl.entry_id where j.company_id=c and j.business_unit_id=b and j.status='posted' and jl.account_id=ar)<>2868 then raise exception 'Canonical historical AR mismatch';end if;
 if (select sum(jl.credit-jl.debit) from public.journal_lines jl join public.journal_entries j on j.id=jl.entry_id where j.company_id=c and j.business_unit_id=b and j.status='posted' and jl.account_id=ap)<>1468 then raise exception 'Canonical historical AP mismatch';end if;
 if (select sum(jl.debit-jl.credit) from public.journal_lines jl join public.journal_entries j on j.id=jl.entry_id where j.company_id=c and j.business_unit_id=b and j.status='posted' and jl.account_id=cash_id)<>-800 then raise exception 'Canonical historical cash mismatch';end if;
 if (select sum(amount) from public.invoice_payment_allocations where company_id=c)<>1250 then raise exception 'Receipt retry duplicated allocation';end if;
 if (select sum(amount) from public.purchase_payment_allocations where company_id=c)<>2050 then raise exception 'Identical split supplier payments merged/duplicated';end if;
 if exists(select 1 from public.journal_lines jl join public.journal_entries j on j.id=jl.entry_id where j.company_id=c and j.status='posted' group by j.id having sum(jl.debit)<>sum(jl.credit)) then raise exception 'History journal is unbalanced';end if;
 perform set_config('request.jwt.claim.sub','',true);
 rejected:=false;begin perform public.transport_history_import_status();exception when others then rejected:=true;end;
 if not rejected then raise exception 'History accepted missing auth';end if;
 raise notice 'PASS historical same-date repeat trips, partial receipts/rent payments, identical split payments, unposted exclusion, batch rollback/retry, one-time guard, canonical AR/AP/cash reconciliation';
end $$;
rollback;
