-- Synthetic fixtures in isolated PostgreSQL only; never run on production.
begin;
do $$
declare
 u uuid:=gen_random_uuid();code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 c uuid;b uuid;loc uuid;customer uuid;f uuid;dest uuid;t1 uuid;t2 uuid;t3 uuid;
 made jsonb;payload jsonb;answer jsonb;before_rows jsonb;after_rows jsonb;register jsonb;raw1 jsonb;raw2 jsonb;raw3 jsonb;party uuid;tt uuid;rid uuid;cost numeric;
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
 again:=public.transport_link_opening_invoices();if again->>'already_linked'<>'true' then raise exception 'Linking is not idempotent';end if;
 select id into customer_doc from public.transport_opening_invoice_documents where side='customer';
 select id into supplier_doc from public.transport_opening_invoice_documents where side='supplier';
 if exists(select 1 from public.transport_opening_invoice_documents where original_invoice_date is not null) or (select count(*) from public.transport_opening_invoice_lines)<>4 then raise exception 'Invented invoice date or self supplier invoices';end if;
 select jsonb_build_object('journals',(select jsonb_agg(to_jsonb(x) order by id) from public.journal_entries x where company_id=c),'lines',(select jsonb_agg(to_jsonb(x) order by id) from public.journal_lines x where company_id=c),'ledgers',(select jsonb_agg(to_jsonb(x) order by id) from public.ledgers x where company_id=c)) into after_finance;
 if before_finance is distinct from after_finance then raise exception 'Linking changed posted money';end if;
 args:=jsonb_build_array(jsonb_build_object('document_id',customer_doc,'amount',50));
 answer:=public.transport_settle_opening_invoices(req,'customer',customer,current_date,cash,'cash',args,'Customer partial');
 again:=public.transport_settle_opening_invoices(req,'customer',customer,current_date,cash,'cash',args,'Customer partial');
 if answer is distinct from again then raise exception 'Retry changed settlement';end if;
 receipt:=(answer->'payments'->0->>'journal_entry_id')::uuid;
 if (select current_outstanding_gross from public.transport_opening_invoice_balances where id=customer_doc)<>210
 or (select sum(amount) from public.transport_opening_invoice_allocations where journal_entry_id=receipt)<>50
 or exists(select 1 from public.transport_opening_invoice_allocations where trip_id=t3 and journal_entry_id=receipt) then raise exception 'Partial Trip allocation incorrect';end if;
 if (select sum(credit-debit) from public.journal_lines where entry_id=receipt and account_id=ar)<>50 or (select sum(debit-credit) from public.journal_lines where entry_id=receipt and account_id=cash)<>50 then raise exception 'Customer cash/AR posting incorrect';end if;
 rejected:=false;begin perform public.transport_settle_opening_invoices(gen_random_uuid(),'customer',customer,current_date,cash,'cash',jsonb_build_array(jsonb_build_object('document_id',customer_doc,'amount',211)));exception when others then rejected:=position('exceeds' in sqlerrm)>0;end;if not rejected then raise exception 'Overpayment accepted';end if;
 rejected:=false;begin perform public.transport_settle_opening_invoices(gen_random_uuid(),'customer',gen_random_uuid(),current_date,cash,'cash',args);exception when others then rejected:=true;end;if not rejected then raise exception 'Wrong party accepted';end if;
 answer:=public.transport_settle_opening_invoices(gen_random_uuid(),'supplier',party,current_date,cash,'cash',jsonb_build_array(jsonb_build_object('document_id',supplier_doc,'amount',5)),'Supplier partial');
 if (select current_outstanding_gross from public.transport_opening_invoice_balances where id=supplier_doc)<>15 then raise exception 'Supplier remaining incorrect';end if;
 register:=public.transport_register_query(p_limit=>500);
 if (register->>'count')::int<>3 or (register->'totals'->>'remaining_company')::numeric<>210 or (register->'totals'->>'supplier_balance')::numeric<>15 then raise exception 'Register did not reflect payments %',register;end if;
 if (select count(*) from jsonb_array_elements(register->'rows') x where (x->>'customer_rate_locked')::boolean)<>3 then raise exception 'Linked customer commercial fields not locked';end if;
 register:=public.transport_register_query(p_limit=>1,p_sort=>'supplier_balance',p_direction=>'desc');if register->'rows'->0->>'id'<>t3::text or (register->'totals'->>'supplier_balance')::numeric<>15 then raise exception 'Full-book supplier numeric sort incorrect';end if;
 register:=public.transport_register_query(p_limit=>1,p_sort=>'remaining_company',p_direction=>'asc');if register->'rows'->0->>'id'<>t3::text then raise exception 'Full-book customer numeric sort incorrect';end if;
 register:=public.transport_register_query(p_filters=>jsonb_build_object('columns',jsonb_build_object('supplier_balance',jsonb_build_array('15.00'))));if (register->>'count')::int<>1 or (register->'totals'->>'supplier_balance')::numeric<>15 then raise exception 'Supplier amount filter did not filter page and totals';end if;
 register:=public.transport_register_query(p_filters=>jsonb_build_object('fromDate',to_char(current_date-2,'YYYY-MM-DD'),'toDate',to_char(current_date-2,'YYYY-MM-DD')));if (register->>'count')::int<>1 or register->'rows'->0->>'id'<>t2::text then raise exception 'Trip date range filter incorrect';end if;
 register:=public.transport_register_query(p_filters=>jsonb_build_object('search','INV-100'),p_sort=>'remaining_company',p_direction=>'desc');
 if (register->>'count')::int<>3 or (register->'totals'->>'remaining_company')::numeric<>210 then raise exception 'Invoice filter totals incorrect';end if;
 register:=public.transport_register_query(p_filters=>jsonb_build_object('columns',jsonb_build_object('trip_no',jsonb_build_array('101'))));
 if (register->>'count')::int<>1 then raise exception 'Column filter incorrect';end if;
 if exists(select 1 from public.transport_party_advances where journal_entry_id=receipt) then raise exception 'Opening payment appears as advance';end if;
 rejected:=false;begin update public.transport_trips set customer_rate=999 where id=t1;exception when others then rejected:=position('linked to posted opening' in sqlerrm)>0;end;if not rejected then raise exception 'Linked commercial edit accepted';end if;
 update public.transport_trips set notes='Remark correction allowed' where id=t1;
 rejected:=false;begin perform public.transport_cancel_opening_invoice_settlement(receipt,current_date,'Company owner must be rejected');exception when others then rejected:=position('software owner' in sqlerrm)>0;end;if not rejected then raise exception 'Company owner cancelled posted payment';end if;
 execute 'reset role';update public.user_profiles set platform_role='super_admin' where id=u;execute 'set local role authenticated';
 answer:=public.transport_cancel_opening_invoice_settlement(receipt,current_date,'Isolated test payment correction');
 if answer->>'success'<>'true' or (select current_outstanding_gross from public.transport_opening_invoice_balances where id=customer_doc)<>260 then raise exception 'Reversal did not restore invoice';end if;
 register:=public.transport_register_query(p_filters=>'{}');if (register->'totals'->>'remaining_company')::numeric<>260 then raise exception 'Reversal did not restore Register';end if;
 rejected:=false;begin perform public.transport_cancel_opening_invoice_settlement(receipt,current_date,'Duplicate cancellation must be rejected');exception when others then rejected:=true;end;if not rejected then raise exception 'Duplicate reversal accepted';end if;
 if (select count(*) from public.journal_entries where company_id=c)<>4 or exists(select 1 from public.sales_orders where company_id=c) or exists(select 1 from public.purchase_orders where company_id=c) then raise exception 'Historical turnover/invoices reposted';end if;
 answer:=public.transport_opening_invoice_query('movements','customer','{}');if jsonb_array_length(answer)<>3 then raise exception 'Opening receipt/reversal movements missing';end if;
 -- New native invoices beside the imported book must continue through their
 -- original accounting reader, with complete combined Register totals.
 execute 'reset role';
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,'A','B',200,0,'cash') returning id into t3;
 execute 'set local role authenticated';
 perform public.transport_finalize_customer_rate(t3,200,'manual');
 perform public.transport_post_customer_bill(t3,current_date,false);
 register:=public.transport_register_query(p_limit=>500);
 if (register->>'count')::int<>4 or (register->'totals'->>'remaining_company')::numeric<>460 then raise exception 'Native plus imported Register totals incorrect %',register;end if;
 if has_function_privilege('anon','public.transport_settle_opening_invoices(uuid,text,uuid,date,uuid,text,jsonb,text)','execute') or has_function_privilege('authenticated','public._transport_opening_register_rows(uuid,uuid,uuid)','execute') or has_table_privilege('authenticated','public.transport_opening_invoice_documents','insert') then raise exception 'Opening authorization grants unsafe';end if;
 execute 'reset role';perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);execute 'set local role authenticated';
 if exists(select 1 from public.transport_opening_invoice_documents) then raise exception 'Cross tenant opening data leak';end if;
 rejected:=false;begin perform public.transport_opening_invoice_query('documents','customer','{}');exception when others then rejected:=true;end;if not rejected then raise exception 'Foreign actor read accepted';end if;
 execute 'reset role';
end $$;
rollback;
select 'opening invoice linking/payments/reversal/filters PASS' result;
