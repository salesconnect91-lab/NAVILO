-- Isolated local PostgreSQL/Supabase only. Synthetic fixture rolls back.
begin;
do $$
declare u uuid:=gen_random_uuid();c uuid;b uuid;loc uuid;customer uuid;supplier uuid;supplier2 uuid;
 cash_id uuid;acct uuid;cost uuid;ar uuid;ap uuid;normal_rev uuid;vehicle_rev uuid;normal_doc uuid;code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 trip uuid;trip2 uuid;cash_trip uuid;driver uuid;vehicle uuid;rent uuid;rent2 uuid;bill uuid;bill2 uuid;sales_id uuid;sales2 uuid;cashbill uuid;
 original_journal jsonb;original_lines jsonb;original_bill jsonb;result jsonb;rejected boolean;j uuid;original jsonb;newer jsonb;paid_j uuid;initial_alloc jsonb;
 charge_id uuid;auth_trip uuid;employee uuid;accrual uuid;salary uuid;salary2 uuid;salary_ac uuid;payable uuid;driver_trip uuid;vat_trip uuid;vat_bill uuid;vat_rent uuid;vat_purchase uuid;other_bu uuid;other_c uuid;old_bu uuid;member uuid;reversal uuid;request_id uuid:=gen_random_uuid();st text;v numeric;payload jsonb;
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

 insert into public.suppliers(user_id,company_id,name,account_id) values(u,c,'Second Supplier',ap) returning id into supplier2;
 -- Initial non-VAT service examples use Cash-mode masters, not unconfigured Credit bills.
 perform public.transport_set_party_billing_mode('customer',customer,'Cash');
 perform public.transport_set_party_billing_mode('supplier',supplier,'Cash');
 perform public.transport_set_party_billing_mode('supplier',supplier2,'Cash');



 -- New company vehicle must carry an explicit Revenue COA before its Trip is billed.
 insert into public.chart_of_accounts(user_id,company_id,code,name,type,detail_type,is_group,allow_manual_entries,is_active,normal_balance)
 values(u,c,'VREV-'||code,'FIN-V vehicle income','revenue','service_income',false,true,true,'credit')
 returning id into vehicle_rev;
 insert into public.transport_vehicles(company_id,business_unit_id,vehicle_no,revenue_account_id,ownership_type)
 values(c,b,'FIN-V',vehicle_rev,'company') returning id into vehicle;
 insert into public.transport_drivers(company_id,business_unit_id,driver_name) values(c,b,'Financial Driver') returning id into driver;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,vehicle_id,driver_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,vehicle,driver,'A','B',1000,400,'cash') returning id into trip;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,'A','B',200,0,'cash') returning id into trip2;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,'A','B',100,0,'cash') returning id into cash_trip;
 perform public.transport_finalize_customer_rate(trip,1000,'manual');
 perform public.transport_finalize_customer_rate(trip2,200,'manual');
 perform public.transport_finalize_customer_rate(cash_trip,100,'manual');
 update public.customers set account_id=null where id=customer;
 result:=public.transport_register_query(500,0,'{}','','asc','company_rate',' 1000 ');
 if not (result->'options') @> '["1,000.00"]'::jsonb then raise exception 'Numeric register dropdown search failed';end if;
 result:=public.transport_bulk_rate_page('customer',1,0,jsonb_build_object('columns',jsonb_build_object('rate','1,000')));
 if (result->>'count')::integer<>1 then raise exception 'Comma amount header filter failed';end if;
 result:=public.transport_bulk_rate_page('customer',1,0,jsonb_build_object('search','  FIN-V  ','columns',jsonb_build_object('route','A → B','driver','Financial Driver')));
 if (result->>'count')::integer<>1 then raise exception 'Trimmed search, route or Driver header filter failed';end if;
 result:=public.transport_post_customer_bill_described(trip,current_date,false,'  CUSTOM-S-'||code||'  ','  Customer delivery instructions  ');sales_id:=(result->>'document_id')::uuid;
 if not exists(select 1 from public.sales_service_lines where order_id=sales_id and description like 'Customer delivery instructions%' and description like '%Vehicle: FIN-V%') then raise exception 'Customer description or automatic Trip detail missing';end if;
 if not exists(select 1 from public.sales_service_lines where order_id=sales_id
     and revenue_account_id=(select account_id from public.account_mappings where company_id=c and mapping_key='service_revenue') and amount=1000)
   or not exists(select 1 from public.journal_lines l join public.journal_entries j on j.id=l.entry_id
     where j.source_document_id=sales_id
       and l.account_id=(select account_id from public.account_mappings where company_id=c and mapping_key='service_revenue') and l.credit=1000)
   or exists(select 1 from public.journal_lines l join public.journal_entries j on j.id=l.entry_id
     where j.source_document_id=sales_id and l.account_id=vehicle_rev)
 then raise exception 'Company vehicle Trip must credit common Service Revenue only once';end if;
 rejected:=false;begin perform public.transport_post_customer_bill_described(trip2,current_date,false,null,repeat('X',2001));exception when others then rejected:=true;end;
 if not rejected or exists(select 1 from public.transport_customer_document_trips where trip_id=trip2) then raise exception 'Overlong description accepted or partial invoice created';end if;
 if (select account_id from public.customers where id=customer) is distinct from ar then raise exception 'Blank Customer AR was not resolved to the valid company mapping';end if;
 if (select order_no from public.sales_orders where id=sales_id)<>'CUSTOM-S-'||code then raise exception 'Custom sales number not preserved';end if;
 rejected:=false;begin perform public.transport_post_customer_bill_numbered(trip2,current_date,false,'custom-s-'||code);exception when others then rejected:=true;end;
 if not rejected or exists(select 1 from public.transport_customer_document_trips where trip_id=trip2) then raise exception 'Duplicate sales number accepted or left partial posting';end if;
 rejected:=false;begin perform public.transport_post_customer_bill_numbered(trip2,current_date,false,repeat('X',81));exception when others then rejected:=true;end;
 if not rejected then raise exception 'Overlong invoice number accepted';end if;

 update public.customers set account_id=cash_id where id=customer;
 rejected:=false;begin perform public.transport_post_customer_bill(trip2,current_date,false);exception when others then rejected:=true;end;
 if not rejected or exists(select 1 from public.transport_customer_document_trips where trip_id=trip2) then raise exception 'Explicit wrong AR accepted or left partial posting';end if;
 update public.customers set account_id=null where id=customer;
 result:=public.transport_post_customer_bill(trip2,current_date,false);sales2:=(result->>'document_id')::uuid;
 result:=public.transport_post_customer_bill(cash_trip,current_date,false);cashbill:=(result->>'document_id')::uuid;
 if not exists(select 1 from public.transport_customer_documents where sales_order_id=cashbill and document_kind='cash_hand_bill') then raise exception 'Cash bill subtype missing';end if;

 -- Company owner without a BU Admin assignment must be denied.
 rejected:=false;BEGIN
  perform public.transport_admin_delete_posted_invoice('customer',cashbill,'Synthetic owner permission rejection');
 EXCEPTION WHEN OTHERS THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Owner-only account was allowed to permanently delete';END IF;
 update public.company_memberships set role='admin' where company_id=c and user_id=u;
 update public.business_unit_memberships set role='admin' where business_unit_id=b and user_id=u;
 update public.operating_location_memberships set role='admin' where operating_location_id=loc and user_id=u;
 SET LOCAL ROLE authenticated;
 IF NOT public.transport_posted_invoice_admin_access() THEN RAISE EXCEPTION 'Fixture Admin access failed';END IF;
 select journal_entry_id into j from public.transport_customer_documents where sales_order_id=sales_id;
 select to_jsonb(z) into original from public.journal_entries z where id=j;
 perform public.transport_admin_delete_posted_invoice('customer',cashbill,'Synthetic disposable cash invoice deletion');
 IF EXISTS(select 1 from public.sales_orders where id=cashbill) OR NOT EXISTS(select 1 from public.transport_trips where id=cash_trip) THEN RAISE EXCEPTION 'Deletion did not preserve Trip';END IF;
 result:=public.transport_admin_edit_posted_invoice('customer',sales_id,array[trip,cash_trip],current_date,'Synthetic multi-trip in-place correction',jsonb_build_object(trip::text,jsonb_build_object('base_amount',1050),cash_trip::text,jsonb_build_object('base_amount',150)));
 IF (result->>'journal_entry_id')::uuid<>j OR (select total from public.sales_orders where id=sales_id)<>1200
 OR (select count(*) from public.transport_customer_document_trips where document_id=(select id from public.transport_customer_documents where sales_order_id=sales_id))<>2
 OR (select sum(debit) from public.ledgers where journal_entry_id=j)<>1200
 OR (select sum(debit-credit) from public.ledgers where journal_entry_id=j)<>0
 OR EXISTS(select 1 from public.journal_entries where reversal_of_entry_id=j)
 OR (select count(*) from public.journal_entries where source_document_id=sales_id)<>1 THEN RAISE EXCEPTION 'Multi-trip edit did not preserve atomic GL identity';END IF;
 RESET ROLE;
 INSERT INTO public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 VALUES(c,b,'',current_date,customer,'Third A','Third B',100,0,'cash') RETURNING id INTO auth_trip;
 PERFORM public.transport_finalize_customer_rate(auth_trip,100,'manual');
 SET LOCAL ROLE authenticated;
 result:=public.transport_admin_edit_posted_invoice('customer',sales_id,array[trip,cash_trip,auth_trip],current_date,'Synthetic expand to three Trips without renumbering','{}');
 IF (result->>'journal_entry_id')::uuid<>j OR (SELECT total FROM public.sales_orders WHERE id=sales_id)<>1300
 OR (SELECT count(*) FROM public.transport_customer_document_trips WHERE document_id=(SELECT id FROM public.transport_customer_documents WHERE sales_order_id=sales_id))<>3
 OR (SELECT order_no FROM public.sales_orders WHERE id=sales_id)<>'CUSTOM-S-'||code THEN RAISE EXCEPTION 'Three-Trip expansion changed invoice identity or totals';END IF;
 result:=public.transport_admin_edit_posted_invoice('customer',sales_id,array[trip],current_date,'Synthetic restore single original Trip',jsonb_build_object(trip::text,jsonb_build_object('base_amount',1000)));
 IF (result->>'journal_entry_id')::uuid<>j OR (select total from public.sales_orders where id=sales_id)<>1000 THEN RAISE EXCEPTION 'Split restore failed';END IF;
 -- Bad target must roll back every interim ledger/document change.
 select to_jsonb(z) into original from public.sales_orders z where id=sales_id;
 rejected:=false;BEGIN
 perform public.transport_admin_edit_posted_invoice('customer',sales_id,array[trip,gen_random_uuid()],current_date,'Synthetic invalid Trip rollback verification','{}');
 EXCEPTION WHEN OTHERS THEN rejected:=true;END;
 IF NOT rejected OR original IS DISTINCT FROM (select to_jsonb(z) from public.sales_orders z where id=sales_id)
 OR (select sum(debit) from public.ledgers where journal_entry_id=j)<>1000 THEN RAISE EXCEPTION 'Rejected correction changed original data';END IF;
 -- Supplier parity, same journal and invoice IDs.
 rent:=public.transport_add_supplier_rent(trip,supplier,300,'Supplier test rent');
 rent2:=public.transport_add_supplier_rent(cash_trip,supplier,100,'Supplier second test rent');
 perform public.transport_finalize_supplier_rent(rent,300);
 perform public.transport_finalize_supplier_rent(rent2,100);
 result:=public.transport_post_supplier_bill_described(rent,current_date,acct,false,'SUP-REF','ADMIN-P-'||code,'Supplier test');bill:=(result->>'document_id')::uuid;
 select journal_entry_id into j from public.transport_supplier_documents where purchase_order_id=bill;
 result:=public.transport_admin_edit_posted_invoice('supplier',bill,array[rent,rent2],current_date,'Synthetic supplier combined in-place edit',jsonb_build_object(rent::text,jsonb_build_object('base_amount',350)));
 IF (result->>'journal_entry_id')::uuid<>j OR (select total from public.purchase_orders where id=bill)<>450
 OR (select sum(credit) from public.ledgers where journal_entry_id=j)<>450 THEN RAISE EXCEPTION 'Supplier combined correction failed';END IF;
 perform public.transport_admin_delete_posted_invoice('supplier',bill,'Synthetic supplier invoice permanent deletion');
 IF EXISTS(select 1 from public.purchase_orders where id=bill) OR EXISTS(select 1 from public.journal_entries where id=j)
 OR EXISTS(select 1 from public.ledgers where journal_entry_id=j) OR EXISTS(select 1 from public.party_ledgers where journal_entry_id=j)
 OR NOT EXISTS(select 1 from public.transport_trip_supplier_rents where id=rent) THEN RAISE EXCEPTION 'Supplier delete left ledger evidence or lost source rent';END IF;
 -- Payment dependencies reject deletion and editing while preserving allocations.
 result:=public.transport_settle_documents('customer',customer,current_date,cash_id,'cash',jsonb_build_array(jsonb_build_object('document_id',sales_id,'amount',100)));
 rejected:=false;BEGIN
 perform public.transport_admin_delete_posted_invoice('customer',sales_id,'Synthetic paid invoice deletion rejection');
 EXCEPTION WHEN OTHERS THEN rejected:=true;END;
 IF NOT rejected OR NOT EXISTS(select 1 from public.sales_orders where id=sales_id AND paid_amount=100) THEN RAISE EXCEPTION 'Paid deletion guard failed';END IF;

 -- Paid editing retains the exact receipt journal and allocations.
 SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) INTO initial_alloc FROM public.invoice_payment_allocations a WHERE sales_order_id=sales_id;
 SELECT journal_entry_id INTO j FROM public.transport_customer_documents WHERE sales_order_id=sales_id;
 result:=public.transport_admin_edit_posted_invoice('customer',sales_id,array[trip],current_date,'Synthetic paid rate correction preserves receipt',jsonb_build_object(trip::text,jsonb_build_object('base_amount',1100)));
 IF (result->>'journal_entry_id')::uuid<>j OR (SELECT paid_amount FROM public.sales_orders WHERE id=sales_id)<>100
 OR (SELECT outstanding_amount FROM public.sales_orders WHERE id=sales_id)<>1000
 OR initial_alloc IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.invoice_payment_allocations a WHERE sales_order_id=sales_id) THEN RAISE EXCEPTION 'Paid correction changed payment allocation or totals';END IF;
 RESET ROLE;
 insert into public.company_tax_events(company_id,effective_from,tax_mode,authority_code) values(c,current_date,'tax_registered','REHEARSAL');
 insert into public.tax_rates(user_id,company_id,name,rate,applies_to,is_fixed,is_active,effective_from) values(u,c,'Transport VAT 15%',15,'both',true,true,current_date);
 perform public.transport_set_party_billing_mode('customer',customer,'Credit');
 perform public.transport_set_party_billing_mode('supplier',supplier,'Credit');
 update public.customers set tax_registration_status='registered',strn='CUSTOMER-VAT' where id=customer;
 update public.suppliers set tax_registration_status='registered',strn='SUPPLIER-VAT' where id=supplier;
 SELECT account_id INTO normal_rev FROM public.account_mappings WHERE company_id=c AND mapping_key='service_revenue';
 INSERT INTO public.charge_master(user_id,company_id,charge_key,charge_name,applies_to,tax_applicable,revenue_account_id,cost_account_id,is_active)
 VALUES(u,c,'ADMIN-CHARGE-'||code,'Admin charge test','both',true,normal_rev,acct,true) RETURNING id INTO charge_id;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,'VAT A','VAT B',100,40,'credit') returning id into vat_trip;
 perform public.transport_finalize_customer_rate(vat_trip,100,'manual');
 result:=public.transport_post_customer_bill_numbered(vat_trip,current_date,true,'VAT-ADMIN-S-'||code);vat_bill:=(result->>'document_id')::uuid;
 SELECT journal_entry_id INTO j FROM public.transport_customer_documents WHERE sales_order_id=vat_bill;
 SET LOCAL ROLE authenticated;
 result:=public.transport_admin_edit_posted_invoice('customer',vat_bill,array[vat_trip],current_date,'Synthetic VAT and charge correction',jsonb_build_object(vat_trip::text,jsonb_build_object('base_amount',200,'charges',jsonb_build_array(jsonb_build_object('charge_master_id',charge_id,'amount',30)))));
 IF (result->>'journal_entry_id')::uuid<>j OR (SELECT total FROM public.sales_orders WHERE id=vat_bill)<>264.50
 OR (SELECT sum(vat_snapshot) FROM public.transport_customer_document_trips WHERE document_id=(SELECT id FROM public.transport_customer_documents WHERE sales_order_id=vat_bill))<>34.50
 OR (SELECT sum(amount) FROM public.sales_service_lines WHERE order_id=vat_bill)<>200
 OR (SELECT sum(amount) FROM public.sales_order_charges WHERE order_id=vat_bill)<>30
 OR (SELECT sum(debit) FROM public.ledgers WHERE journal_entry_id=j)<>264.50 THEN RAISE EXCEPTION 'VAT or charges counted twice or lost';END IF;
 result:=public.transport_admin_edit_posted_invoice('customer',vat_bill,array[vat_trip],current_date,'Synthetic remove posted charge',jsonb_build_object(vat_trip::text,jsonb_build_object('charges','[]'::jsonb)));
 IF (SELECT total FROM public.sales_orders WHERE id=vat_bill)<>230 OR EXISTS(SELECT 1 FROM public.sales_order_charges WHERE order_id=vat_bill) THEN RAISE EXCEPTION 'Posted charge removal failed';END IF;
 RESET ROLE;
 vat_rent:=public.transport_add_supplier_rent(vat_trip,supplier,40,'Taxable admin rent');perform public.transport_finalize_supplier_rent(vat_rent,40);
 result:=public.transport_post_supplier_bill(vat_rent,current_date,acct,true);vat_purchase:=(result->>'document_id')::uuid;
 SET LOCAL ROLE authenticated;
 result:=public.transport_admin_edit_posted_invoice('supplier',vat_purchase,array[vat_rent],current_date,'Synthetic supplier VAT charge correction',jsonb_build_object(vat_rent::text,jsonb_build_object('base_amount',50,'charges',jsonb_build_array(jsonb_build_object('charge_master_id',charge_id,'amount',10)))));
 IF (SELECT total FROM public.purchase_orders WHERE id=vat_purchase)<>69 THEN RAISE EXCEPTION 'Supplier VAT charge correction mismatch';END IF;
 result:=public.transport_settle_documents('supplier',supplier,current_date,cash_id,'cash',jsonb_build_array(jsonb_build_object('document_id',vat_purchase,'amount',20)));
 SELECT jsonb_agg(to_jsonb(a) ORDER BY id) INTO initial_alloc FROM public.purchase_payment_allocations a WHERE purchase_order_id=vat_purchase;
 result:=public.transport_admin_edit_posted_invoice('supplier',vat_purchase,array[vat_rent],current_date,'Synthetic paid supplier correction preserves allocation',jsonb_build_object(vat_rent::text,jsonb_build_object('base_amount',60)));
 IF (SELECT total FROM public.purchase_orders WHERE id=vat_purchase)<>80.50 OR (SELECT paid_amount FROM public.purchase_orders WHERE id=vat_purchase)<>20
 OR (SELECT outstanding_amount FROM public.purchase_orders WHERE id=vat_purchase)<>60.50
 OR initial_alloc IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.purchase_payment_allocations a WHERE purchase_order_id=vat_purchase) THEN RAISE EXCEPTION 'Paid supplier correction lost payment or VAT';END IF;
 IF (SELECT sum(debit-credit) FROM public.party_ledgers WHERE company_id=c AND party_id=customer) IS DISTINCT FROM
 (SELECT sum(outstanding_gross-credit_gross) FROM public.transport_service_document_balances WHERE company_id=c AND side='customer') THEN RAISE EXCEPTION 'Customer statement and invoice balances disagree';END IF;
 IF (SELECT sum(credit-debit) FROM public.party_ledgers WHERE company_id=c AND party_id=supplier) IS DISTINCT FROM
 (SELECT sum(outstanding_gross-credit_gross) FROM public.transport_service_document_balances WHERE company_id=c AND side='supplier') THEN RAISE EXCEPTION 'Supplier statement and invoice balances disagree';END IF;
 SELECT to_jsonb(o) INTO original FROM public.sales_orders o WHERE id=vat_bill;
 FOR payload IN SELECT jsonb_build_object(vat_trip::text,jsonb_build_object('base_amount','NaN')) UNION ALL SELECT jsonb_build_object(vat_trip::text,jsonb_build_object('charges',jsonb_build_array(jsonb_build_object('charge_master_id',charge_id,'amount',0)))) LOOP
  rejected:=false;BEGIN
   PERFORM public.transport_admin_edit_posted_invoice('customer',vat_bill,array[vat_trip],current_date,'Synthetic invalid amount rejection',payload);
  EXCEPTION WHEN OTHERS THEN rejected:=true;END;
  IF NOT rejected OR original IS DISTINCT FROM (SELECT to_jsonb(o) FROM public.sales_orders o WHERE id=vat_bill) THEN RAISE EXCEPTION 'Invalid amount accepted or left partial data';END IF;
 END LOOP;
 result:=public.transport_admin_edit_posted_invoice('customer',vat_bill,array[vat_trip],current_date+1,'Synthetic invoice date correction preserves identity','{}');
 IF (SELECT order_date FROM public.sales_orders WHERE id=vat_bill)<>current_date+1
 OR (SELECT entry_date FROM public.journal_entries WHERE id=(result->>'journal_entry_id')::uuid)<>current_date+1
 OR (SELECT posted_at FROM public.sales_orders WHERE id=vat_bill) IS DISTINCT FROM (original->>'posted_at')::timestamptz THEN RAISE EXCEPTION 'Date correction failed or changed original posting timestamp';END IF;
 result:=public.transport_admin_edit_posted_invoice('customer',vat_bill,array[vat_trip],current_date,'Synthetic restore invoice date','{}');
 RESET ROLE;
 INSERT INTO public.accounting_periods(user_id,company_id,period_name,period_start,period_end,status)
 VALUES(u,c,'Admin closed-period guard',current_date,current_date,'closed');
 SET LOCAL ROLE authenticated;
 rejected:=false;BEGIN
  PERFORM public.transport_admin_delete_posted_invoice('customer',vat_bill,'Synthetic closed-period delete denial');
 EXCEPTION WHEN OTHERS THEN rejected:=true;END;
 IF NOT rejected OR NOT EXISTS(SELECT 1 FROM public.sales_orders WHERE id=vat_bill) THEN RAISE EXCEPTION 'Closed-period delete guard failed';END IF;
 RESET ROLE;
 UPDATE public.business_unit_memberships SET is_active=false WHERE business_unit_id=b AND user_id=u;
 SET LOCAL ROLE authenticated;
 IF public.transport_posted_invoice_admin_access() THEN RAISE EXCEPTION 'Inactive Admin retained access';END IF;
 rejected:=false;BEGIN
  PERFORM public.transport_admin_edit_posted_invoice('customer',vat_bill,array[vat_trip],current_date,'Synthetic inactive Admin correction denial','{}');
 EXCEPTION WHEN OTHERS THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Inactive Admin mutation accepted';END IF;
 RESET ROLE;
 UPDATE public.business_unit_memberships SET is_active=true WHERE business_unit_id=b AND user_id=u;
 SET LOCAL ROLE authenticated;
 -- Namespace ACLs and rejected direct table writes remain strict.
 IF has_function_privilege('anon','public.transport_admin_delete_posted_invoice(text,uuid,text)','EXECUTE')
 OR has_table_privilege('authenticated','navilo_private.transport_invoice_control_gate','INSERT') THEN RAISE EXCEPTION 'Public control gate privilege leaked';END IF;
 rejected:=false;BEGIN
  UPDATE public.sales_orders SET total=1 WHERE id=vat_bill;
 EXCEPTION WHEN OTHERS THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Direct posted mutation bypassed the private gate';END IF;
 RESET ROLE;
 raise notice 'PASS Admin-only posted multi-trip edit, split, rate corrections, supplier parity, permanent delete, GL identity, no reversal, owner denial and rollback';
END $$;
ROLLBACK;
