-- Synthetic fixtures in isolated PostgreSQL only; never run on production.
begin;
do $$
declare
 u uuid:=gen_random_uuid();code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 c uuid;b uuid;loc uuid;customer uuid;f uuid;dest uuid;t1 uuid;t2 uuid;t3 uuid;
 made jsonb;payload jsonb;answer jsonb;before_rows jsonb;after_rows jsonb;register jsonb;raw1 jsonb;raw2 jsonb;raw3 jsonb;party uuid;tt uuid;rid uuid;cost numeric;native_cost uuid;
 ar uuid;ap uuid;cash uuid;equity uuid;j uuid;customer_doc uuid;supplier_doc uuid;receipt uuid;req uuid:=gen_random_uuid();args jsonb;again jsonb;before_finance jsonb;after_finance jsonb;
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
 jsonb_build_object('trip_date',current_date-1,'customer_id',customer,'truck_type_id',tt,'from_location_id',f,'to_location_id',dest,'customer_rate',200,'source_invoice_no','INV-100','notes','Legacy CSV Trip 101; Original source'),
 jsonb_build_object('trip_date',current_date-2,'customer_id',customer,'truck_type_id',tt,'from_location_id',f,'to_location_id',dest,'customer_rate',200,'source_invoice_no','INV-100','notes','Legacy CSV Trip 102; Original source'),
 jsonb_build_object('trip_date',current_date-3,'customer_id',customer,'truck_type_id',tt,'from_location_id',f,'to_location_id',dest,'customer_rate',200,'source_invoice_no','INV-100','notes','Legacy CSV Trip 103; Original source')));
 t1:=(made->0->>'id')::uuid;t2:=(made->1->>'id')::uuid;t3:=(made->2->>'id')::uuid;
 rid:=public.transport_add_supplier_rent(t1,party,125,'Original unposted source rent');
 perform public.transport_attach_historical_trip_identity(jsonb_build_array(
 jsonb_build_object('trip_id',t1,'source_company','Original CSV','source_trip_id','101','source_file_hash',source_hash,'source_row',2,'source_trip_date',current_date-1,
 'driver_name_snapshot','Company Driver','vehicle_no_snapshot','2490','owner_name_snapshot','TWAKKAL','truck_type_snapshot','FLATBED'),
 jsonb_build_object('trip_id',t2,'source_company','Original CSV','source_trip_id','102','source_file_hash',source_hash,'source_row',3,'source_trip_date',current_date-2,
 'driver_name_snapshot','Company Driver','vehicle_no_snapshot','0','owner_name_snapshot','TWAKKAL','truck_type_snapshot','FLATBED'),
 jsonb_build_object('trip_id',t3,'source_company','Original CSV','source_trip_id','103','source_file_hash',source_hash,'source_row',4,'source_trip_date',current_date-3,
 'driver_name_snapshot','Supplier Driver','vehicle_no_snapshot','2490','owner_name_snapshot','Source Supplier','truck_type_snapshot','FLATBED')));
 raw1:=jsonb_build_array('101',to_char(current_date-1,'DD-Mon-YY'),'FLATBED','','INV-100','Identity Customer','Company Driver','TWAKKAL','2490','Identity From','Identity To','Original Receiver','','SUP-ORIGINAL','125','125','','125','0','','200','15','30','230','0','100','','0','0','75','Cash','');
 raw2:=jsonb_build_array('102',to_char(current_date-2,'DD-Mon-YY'),'FLATBED','','INV-100','Identity Customer','Company Driver','TWAKKAL','0','Identity From','Identity To','No Paper','','','0','0','','0','0','','200','15','30','230','0','160','','0','0','200','Cash','');
 raw3:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(raw2,'{0}',to_jsonb('103'::text)),'{1}',to_jsonb(to_char(current_date-3,'DD-Mon-YY'))),'{6}',to_jsonb('Supplier Driver'::text)),'{7}',to_jsonb('Source Supplier'::text)),'{8}',to_jsonb('2490'::text));
 payload:=jsonb_build_array(jsonb_build_object('trip_id',t1,'raw_source',raw1),jsonb_build_object('trip_id',t2,'raw_source',raw2),jsonb_build_object('trip_id',t3,'raw_source',raw3));

 raw3:=jsonb_set(raw3,'{4}','"INV-100"');raw3:=jsonb_set(raw3,'{13}','"SUP-200"');
 raw3:=jsonb_set(raw3,'{14}','"120"');raw3:=jsonb_set(raw3,'{15}','"120"');raw3:=jsonb_set(raw3,'{17}','"120"');raw3:=jsonb_set(raw3,'{18}','"20"');raw3:=jsonb_set(raw3,'{25}','"0"');raw3:=jsonb_set(raw3,'{27}','"100"');
 payload:=jsonb_build_array(jsonb_build_object('trip_id',t1,'raw_source',raw1),jsonb_build_object('trip_id',t2,'raw_source',raw2),jsonb_build_object('trip_id',t3,'raw_source',raw3));
 perform public.transport_complete_historical_operational_mapping(payload);
 insert into public.company_settings(user_id,company_id,company_name) values(u,c,'Opening rehearsal');
 perform public.initialize_default_coa();
 select account_id into ar from public.account_mappings where company_id=c and mapping_key='accounts_receivable';
 select account_id into ap from public.account_mappings where company_id=c and mapping_key='accounts_payable';
 select account_id into cash from public.account_mappings where company_id=c and mapping_key='cash';
 select id into equity from public.chart_of_accounts where company_id=c and type='equity' and is_active and not is_group limit 1;
 if equity is null then insert into public.chart_of_accounts(user_id,company_id,code,name,type,normal_balance,detail_type,is_active,is_group,allow_manual_entries) values(u,c,'OPEN-EQ','Opening equity','equity','credit','Retained Earnings',true,false,true) returning id into equity;end if;

 select id into native_cost from public.chart_of_accounts where company_id=c and type='expense' and not is_group and is_active limit 1;
 insert into public.account_mappings(user_id,company_id,mapping_key,account_id) values(u,c,'transport_expense',native_cost) on conflict do nothing;
 update public.customers set account_id=ar where id=customer;
 update public.suppliers set account_id=ap where company_id=c;
 select id into party from public.suppliers where company_id=c and name='Source Supplier';
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type,source_document_type)
 values(u,c,b,loc,'COB-OPENING-TEST',current_date,'Source remaining only','draft','General','cutover_opening_balances') returning id into j;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name)
 select u,c,b,loc,j,ar,coa.code||' - '||coa.name,260,0,'customer',customer,'Identity Customer' from public.chart_of_accounts coa where coa.id=ar;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name)
 select u,c,b,loc,j,ap,coa.code||' - '||coa.name,0,20,'supplier',party,'Source Supplier' from public.chart_of_accounts coa where coa.id=ap;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit)
 select u,c,b,loc,j,equity,coa.code||' - '||coa.name,0,240 from public.chart_of_accounts coa where coa.id=equity;
 perform public.post_journal_entry(j);
 select jsonb_build_object('journals',(select jsonb_agg(to_jsonb(x) order by id) from public.journal_entries x where company_id=c),'lines',(select jsonb_agg(to_jsonb(x) order by id) from public.journal_lines x where company_id=c),'ledgers',(select jsonb_agg(to_jsonb(x) order by id) from public.ledgers x where company_id=c)) into before_finance;
 execute 'set local role authenticated';
 answer:=public.transport_link_opening_invoices();
 if (answer->>'linked')::int<>2 or (answer->>'financial_postings')::int<>0 then raise exception 'Wrong opening linking result %',answer;end if;

 answer:=public.transport_prepare_register_invoice_conversion(repeat('b',64),'[]','[]','Owner approved conversion of all historical register invoices using supplied dates');
 if (answer->>'prepared')::int<>2 then raise exception 'Expected two source documents: %',answer;end if;
 answer:=public.transport_convert_register_invoice_batch('customer',100);
 if (answer->>'posted')::int<>0 or (answer->>'blocked')::int<>1 then raise exception 'VAT should require genuine STRN: %',answer;end if;
 if (select count(*) from public.sales_orders where company_id=c and status='draft')<>1 or (select count(*) from public.journal_entries where company_id=c)<>1 then raise exception 'Failed VAT posting leaked finance or failed to retain draft';end if;
 answer:=public.transport_convert_register_invoice_batch('supplier',100);
 if (answer->>'posted')::int<>1 or (answer->>'blocked')::int<>0 then raise exception 'Supplier conversion failed: %',answer;end if;
 if (select count(*) from public.purchase_orders where company_id=c and status='posted')<>1 then raise exception 'Posted supplier invoice missing';end if;
 if (select sum(amount) from public.purchase_payment_allocations where company_id=c)<>100 then raise exception 'Historical supplier settlement missing';end if;
 if (select sum(credit-debit) from public.party_ledgers where company_id=c and party_type='supplier')<>20 then raise exception 'Supplier opening was counted twice';end if;
 if (select sum(debit-credit) from public.party_ledgers where company_id=c and party_type='customer')<>260 then raise exception 'Customer control changed or doubled';end if;
 if (select coalesce(sum(l.debit-l.credit),0) from public.ledgers l where l.company_id=c and l.account_id=cash)<>0 then raise exception 'Invented cash movement';end if;
 if exists(select 1 from public.transport_opening_invoice_balances where company_id=c and side='supplier' and opening_remaining>0) then raise exception 'Converted supplier still offered as opening invoice';end if;
 again:=public.transport_convert_register_invoice_batch('supplier',100);
 if (again->>'posted')::int<>0 then raise exception 'Repeated supplier conversion created duplicates';end if;
 if has_table_privilege('authenticated','public.transport_register_conversion_gates','insert') or has_function_privilege('authenticated','public.transport_register_conversion_allowed(uuid,text)','execute') then raise exception 'Private conversion authority exposed';end if;
 update public.company_settings set strn='300000000000003' where company_id=c;
 answer:=public.transport_convert_register_invoice_batch('customer',100,true);
 if (answer->>'posted')::int<>1 or (answer->>'blocked')::int<>0 then raise exception 'Tax invoice should post after valid company registration: %',answer;end if;
 if (select sum(debit-credit) from public.party_ledgers where company_id=c and party_type='customer')<>260 then raise exception 'Tax retry changed closing AR';end if;
 answer:=public.transport_register_query(500,0,'{}');
 if (answer->'totals'->>'received_company')::numeric<>(select sum(historical_settled) from public.transport_register_invoice_conversions where company_id=c and side='customer') then raise exception 'Register customer received excludes VAT';end if;
 if (answer->'totals'->>'supplier_paid')::numeric<>(answer->'totals'->>'amount')::numeric then raise exception 'Register supplier payment cells mix net and gross';end if;
 execute 'reset role';
 if exists(select 1 from public.transport_conversion_balance_queue) then raise exception 'Balance queue was not flushed';end if;
 execute 'set local role authenticated';
 if exists(select 1 from (select balance,sum(debit-credit) over(partition by user_id,business_unit_id,party_type,party_id order by entry_date,created_at,id rows between unbounded preceding and current row) expected from public.party_ledgers where company_id=c) q where balance is distinct from expected) then raise exception 'Running ledger balances differ after conversion';end if;
 execute 'reset role';perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);execute 'set local role authenticated';
 rejected:=false;begin perform public.transport_convert_register_invoice_batch('supplier',100);exception when others then rejected:=true;end;if not rejected then raise exception 'Foreign conversion accepted';end if;
 execute 'reset role';
end $$;
rollback;
select 'native conversion Tax draft, STRN protection, no duplicate AP/cash PASS' result;
