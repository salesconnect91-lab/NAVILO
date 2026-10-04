-- Isolated local database only. Synthetic fixtures and requests roll back.
begin;
do $$
declare u uuid:=gen_random_uuid();code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 c uuid;b uuid;loc uuid;customer uuid;supplier uuid;ar uuid;ap uuid;cost uuid;cash_id uuid;acct uuid;
 trip uuid;trip2 uuid;sales_id uuid;sales2 uuid;rent uuid;rent2 uuid;bill uuid;bill2 uuid;
 result jsonb;again jsonb;payload jsonb;request_id uuid:=gen_random_uuid();payment_id uuid;receipt_id uuid;
 count_before bigint;rejected boolean;other_bu uuid;other_loc uuid;other_c uuid;v numeric;
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

 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,'A','B',1000,400,'credit') returning id into trip;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,'A','B',1000,300,'credit') returning id into trip2;
 perform public.transport_finalize_customer_rate(trip,1000,'manual');
 result:=public.transport_post_customer_bill(trip,current_date,false);sales_id:=(result->>'document_id')::uuid;
 perform public.transport_finalize_customer_rate(trip2,1000,'manual');
 result:=public.transport_post_customer_bill(trip2,current_date,false);sales2:=(result->>'document_id')::uuid;
 rent:=public.transport_add_supplier_rent(trip,supplier,400,'Report rent');
 rent2:=public.transport_add_supplier_rent(trip2,supplier,300,'Report second rent');
 perform public.transport_finalize_supplier_rent(rent,400);
 result:=public.transport_post_supplier_bill(rent,current_date,acct,false);bill:=(result->>'document_id')::uuid;
 perform public.transport_finalize_supplier_rent(rent2,300);
 result:=public.transport_post_supplier_bill(rent2,current_date,acct,false);bill2:=(result->>'document_id')::uuid;
 payload:=jsonb_build_array(jsonb_build_object('document_id',bill,'amount',100),jsonb_build_object('document_id',bill2,'amount',50));
 execute 'set local role authenticated';
 result:=public.transport_settle_reviewed_documents(request_id,'supplier',supplier,current_date,cash_id,'cash',payload,'Bulk-report-test');
 again:=public.transport_settle_reviewed_documents(request_id,'supplier',supplier,current_date,cash_id,'cash',payload,'Bulk-report-test');
 if result is distinct from again then raise exception 'Retry result changed';end if;
 if (select count(*) from public.purchase_payment_allocations where purchase_order_id in(bill,bill2))<>2 then raise exception 'Bulk retry duplicated payment';end if;
 payment_id:=(result->'payments'->0->>'journal_entry_id')::uuid;
 rejected:=false;begin perform public.transport_settle_reviewed_documents(request_id,'supplier',supplier,current_date,cash_id,'cash',jsonb_build_array(jsonb_build_object('document_id',bill,'amount',10)),'Bulk-report-test');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Request payload reuse accepted';end if;
 select count(*) into count_before from public.purchase_payment_allocations;
 rejected:=false;begin perform public.transport_settle_reviewed_documents(gen_random_uuid(),'supplier',supplier,current_date,cash_id,'cash',jsonb_build_array(jsonb_build_object('document_id',bill,'amount',10),jsonb_build_object('document_id',bill2,'amount',9999)));exception when others then rejected:=true;end;
 if not rejected or (select count(*) from public.purchase_payment_allocations)<>count_before then raise exception 'Invalid bulk partly posted';end if;
 result:=public.transport_settle_reviewed_documents(gen_random_uuid(),'customer',customer,current_date,cash_id,'cash',jsonb_build_array(jsonb_build_object('document_id',sales_id,'amount',300),jsonb_build_object('document_id',sales2,'amount',200)));
 receipt_id:=(result->>'journal_entry_id')::uuid;
 if (select count(distinct journal_entry_id) from public.transport_party_movements where event_type='receipt')<>1
 or (select sum(-amount) from public.transport_party_movements where event_type='receipt')<>500 then raise exception 'Grouped receipt allocation report must show one voucher and 500 total';end if;
 if (select sum(amount) from public.transport_party_movements where side='customer')<>1500
 or (select sum(amount) from public.transport_party_movements where side='supplier')<>550 then raise exception 'Partial statement mismatch';end if;
 if (select sum(amount) from public.transport_canonical_party_movements where side='customer')<>1500
 or (select sum(amount) from public.transport_canonical_party_movements where side='supplier')<>550 then raise exception 'Canonical ledger mismatch';end if;
 perform public.transport_adjust_rate(trip,'customer',900,'Report credit');
 perform public.transport_adjust_rate(trip,'supplier',350,'Report supplier correction',current_date,rent);
 if (select sum(amount) from public.transport_party_movements where side='customer')<>1400
 or (select sum(amount) from public.transport_party_movements where side='supplier')<>500 then raise exception 'Credit statement mismatch: customer %, supplier %, notes %, events %', (select sum(amount) from public.transport_party_movements where side='customer'),(select sum(amount) from public.transport_party_movements where side='supplier'),(select count(*) from public.return_notes),(select count(*) from public.transport_party_movements where event_type='credit_note');end if;
 execute 'reset role';
 -- Reversal is a dated opposite movement, not deletion of historical payments.
 perform public.reverse_payment_voucher(receipt_id,current_date+1,'Report dated reversal');
 if (select sum(amount) from public.transport_party_movements where side='customer' and event_date<=current_date)<>1400
 or (select sum(amount) from public.transport_party_movements where side='customer')<>1900 then raise exception 'Historical reversal mismatch today %, all %, status %, reversal %', (select sum(amount) from public.transport_party_movements where side='customer' and event_date<=current_date),(select sum(amount) from public.transport_party_movements where side='customer'),(select status from public.journal_entries where id=receipt_id),(select count(*) from public.journal_entries where reversal_of_entry_id=receipt_id and status='posted');end if;
 if (select sum(amount) from public.transport_canonical_party_movements where side='customer')<>1900 then raise exception 'Reversal canonical mismatch';end if;
 if exists(select 1 from public.transport_party_documents d left join lateral(select sum(amount) balance from public.transport_party_movements m where m.side=d.side and m.order_id=d.order_id) m on true
 where abs(coalesce(m.balance,0)-coalesce(d.current_outstanding_gross,0)+coalesce(d.current_credit_gross,0))>0.005) then raise exception 'Document reconciliation mismatch';end if;
 execute 'set local role authenticated';
 rejected:=false;begin insert into public.transport_settlement_requests(company_id,business_unit_id,operating_location_id,request_id,created_by,payload) values(c,b,loc,gen_random_uuid(),u,'{}');exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Direct request write allowed';end if;
 execute 'reset role';
 -- A second active branch must not read the first branch, even for the same party.
 insert into public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
 values(c,b,'RP2','Report second branch','branch',true) returning id into other_loc;
 insert into public.operating_location_memberships(company_id,business_unit_id,operating_location_id,user_id,role,is_active) values(c,b,other_loc,u,'company_owner',true);
 update public.user_profiles set locked_operating_location_id=other_loc where id=u;
 execute 'set local role authenticated';
 if exists(select 1 from public.transport_party_documents) or exists(select 1 from public.transport_party_movements) or exists(select 1 from public.transport_canonical_party_movements) then raise exception 'Cross-branch report leak';end if;
 rejected:=false;begin perform public.transport_settle_reviewed_documents(gen_random_uuid(),'supplier',supplier,current_date,cash_id,'cash',payload);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Cross-branch allocation accepted';end if;
 execute 'reset role';
 update public.user_profiles set locked_operating_location_id=loc where id=u;
 insert into public.business_units(company_id,name,code,unit_type,is_active) values(c,'Other Report BU','RP-'||code,'transport',true) returning id into other_bu;
 insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active) values(c,other_bu,u,'company_owner',true);
 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled) values(c,other_bu,'transport',true),(c,other_bu,'accounting',true);
 update public.user_profiles set last_business_unit_id=other_bu where id=u;
 execute 'set local role authenticated';
 if exists(select 1 from public.transport_party_documents) or exists(select 1 from public.transport_party_movements) or exists(select 1 from public.transport_canonical_party_movements) then raise exception 'Cross-BU report leak';end if;
 execute 'reset role';
 insert into public.companies(name,code,status) values('Other report company','RC-'||code,'active') returning id into other_c;
 select id into other_bu from public.business_units where company_id=other_c and is_default;
 insert into public.company_memberships(company_id,user_id,role,is_active) values(other_c,u,'company_owner',true);
 insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active) values(other_c,other_bu,u,'company_owner',true) on conflict(business_unit_id,user_id) do update set is_active=true;
 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled) values(other_c,other_bu,'transport',true),(other_c,other_bu,'accounting',true) on conflict(business_unit_id,module_key) do update set enabled=true;
 update public.user_profiles set last_company_id=other_c,last_business_unit_id=other_bu where id=u;
 execute 'set local role authenticated';
 if exists(select 1 from public.transport_party_documents) or exists(select 1 from public.transport_party_movements) or exists(select 1 from public.transport_canonical_party_movements) then raise exception 'Cross-company report leak';end if;
 execute 'reset role';
 update public.user_profiles set last_company_id=c,last_business_unit_id=b,locked_operating_location_id=loc where id=u;
 perform public.transport_set_financial_permission(u,'settlement',false);
 execute 'set local role authenticated';
 rejected:=false;begin perform public.transport_settle_reviewed_documents(gen_random_uuid(),'supplier',supplier,current_date,cash_id,'cash',payload);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Denied settlement permission ignored';end if;
 execute 'reset role';
 raise notice 'PASS: Transport party reports, canonical reconciliation, partial grouped settlement, safe retry, dated reversal and scope protection';
end $$;
rollback;
