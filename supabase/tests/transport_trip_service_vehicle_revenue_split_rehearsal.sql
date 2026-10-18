-- Synthetic isolated PostgreSQL acceptance; this file rolls back everything it creates.
-- One mixed grouped Trip Service Invoice: company vehicle => own COA, supplier => Service Revenue.
BEGIN;
DO $$
DECLARE
 u uuid:=gen_random_uuid();
 code text:=substr(replace(gen_random_uuid()::text,'-',''),1,10);
 c uuid;b uuid;loc uuid;customer uuid;supplier uuid;ar uuid;ap uuid;service_rev uuid;vehicle_rev uuid;
 own_vehicle uuid;supplier_vehicle uuid;unlinked_vehicle uuid;
 own_trip uuid;supplier_trip uuid;unlinked_trip uuid;cm uuid;posted jsonb;doc uuid;entry uuid;
 rejected boolean:=false;
BEGIN
 INSERT INTO auth.users(id,role,email,created_at,updated_at)
 VALUES(u,'authenticated','split-'||code||'@navilo.test',now(),now());
 INSERT INTO public.user_profiles(id,user_id,email,role,platform_role,is_active)
 VALUES(u,u,'split-'||code||'@navilo.test','admin','user',true);
 INSERT INTO public.companies(name,code,status) VALUES('Split rehearsal','SP'||code,'active') RETURNING id INTO c;
 SELECT id INTO STRICT b FROM public.business_units WHERE company_id=c AND is_default;
 UPDATE public.business_units SET unit_type='transport' WHERE id=b;
 INSERT INTO public.company_memberships(company_id,user_id,role,is_active) VALUES(c,u,'company_owner',true);
 INSERT INTO public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
 VALUES(c,b,u,'company_owner',true) ON CONFLICT(business_unit_id,user_id) DO UPDATE SET is_active=true;
 INSERT INTO public.business_unit_modules(company_id,business_unit_id,module_key,enabled)
 VALUES(c,b,'sales',true),(c,b,'accounting',true),(c,b,'transport',true)
 ON CONFLICT(business_unit_id,module_key) DO UPDATE SET enabled=true;
 INSERT INTO public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
 VALUES(c,b,'HO','Head Office','branch',true) RETURNING id INTO loc;
 INSERT INTO public.operating_location_memberships(company_id,business_unit_id,operating_location_id,user_id,role,is_active)
 VALUES(c,b,loc,u,'company_owner',true);
 UPDATE public.user_profiles SET last_company_id=c,last_business_unit_id=b WHERE id=u;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM public.initialize_default_coa();
 SELECT account_id INTO ar FROM public.account_mappings WHERE company_id=c AND mapping_key='accounts_receivable';
 SELECT account_id INTO ap FROM public.account_mappings WHERE company_id=c AND mapping_key='accounts_payable';
 SELECT account_id INTO service_rev FROM public.account_mappings WHERE company_id=c AND mapping_key='service_revenue';
 IF ar IS NULL OR service_rev IS NULL THEN RAISE EXCEPTION 'Fixture missing canonical AR/Service mapping'; END IF;
 INSERT INTO public.chart_of_accounts(user_id,company_id,code,name,type,detail_type,is_group,allow_manual_entries,is_active,normal_balance)
 VALUES(u,c,'VREV-'||code,'Company vehicle income','revenue','service_income',false,true,true,'credit')
 RETURNING id INTO vehicle_rev;
 INSERT INTO public.customers(user_id,company_id,name,account_id) VALUES(u,c,'Mixed invoice customer',ar) RETURNING id INTO customer;
 INSERT INTO public.suppliers(user_id,company_id,name,account_id) VALUES(u,c,'External vehicle owner',ap) RETURNING id INTO supplier;
 PERFORM public.transport_set_party_billing_mode('customer',customer,'Cash');
 INSERT INTO public.transport_vehicles(company_id,business_unit_id,vehicle_no,ownership_type,revenue_account_id)
 VALUES(c,b,'OWN-'||code,'company',vehicle_rev) RETURNING id INTO own_vehicle;
 INSERT INTO public.transport_vehicles(company_id,business_unit_id,vehicle_no,ownership_type,supplier_id)
 VALUES(c,b,'SUP-'||code,'supplier',supplier) RETURNING id INTO supplier_vehicle;
 INSERT INTO public.charge_master(user_id,company_id,charge_key,charge_name,applies_to,tax_applicable,revenue_account_id,is_active)
 VALUES(u,c,'waiting-'||code,'Waiting charge','sales',false,service_rev,true) RETURNING id INTO cm;
 INSERT INTO public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,vehicle_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 VALUES(c,b,'',current_date,customer,own_vehicle,'A','B',300,0,'cash') RETURNING id INTO own_trip;
 INSERT INTO public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,vehicle_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 VALUES(c,b,'',current_date,customer,supplier_vehicle,'C','D',200,0,'cash') RETURNING id INTO supplier_trip;
 PERFORM public.transport_replace_trip_customer_charges(own_trip,jsonb_build_array(jsonb_build_object('charge_master_id',cm,'amount',40)),'Own waiting');
 PERFORM public.transport_replace_trip_customer_charges(supplier_trip,jsonb_build_array(jsonb_build_object('charge_master_id',cm,'amount',30)),'Supplier waiting');
 PERFORM public.transport_finalize_customer_rate(own_trip,300,'manual');
 PERFORM public.transport_finalize_customer_rate(supplier_trip,200,'manual');
 posted:=public.transport_post_customer_bill_grouped(ARRAY[own_trip,supplier_trip],current_date,service_rev,false,'SPLIT-'||code,'{}'::jsonb);
 doc:=(posted->>'order_id')::uuid;
 IF doc IS NULL OR (posted->>'status')<>'posted' OR (posted->>'trip_count')::int<>2 THEN
   RAISE EXCEPTION 'Grouped one-invoice posting failed: %',posted;
 END IF;
 IF (SELECT count(*) FROM public.journal_entries WHERE source_document_id=doc AND status='posted')<>1 THEN
   RAISE EXCEPTION 'Mixed Trip invoice must post one journal';
 END IF;
 SELECT id INTO entry FROM public.journal_entries WHERE source_document_id=doc AND status='posted';
 IF COALESCE((SELECT sum(credit) FROM public.journal_lines WHERE entry_id=entry AND account_id=vehicle_rev),0) IS DISTINCT FROM 0
   OR (SELECT sum(credit) FROM public.journal_lines WHERE entry_id=entry AND account_id=service_rev) IS DISTINCT FROM 570
 THEN RAISE EXCEPTION 'Trip revenue must use common Service Revenue 570; dedicated vehicle GL unchanged'; END IF;
 IF (SELECT count(*) FROM public.sales_service_lines WHERE order_id=doc AND source_module='transport')<>2
   OR (SELECT sum(amount) FROM public.sales_order_charges WHERE order_id=doc) IS DISTINCT FROM 70
   OR (SELECT total FROM public.sales_orders WHERE id=doc) IS DISTINCT FROM 570
 THEN RAISE EXCEPTION 'Mixed invoice trip lines, charge totals or receivable changed'; END IF;
 IF (SELECT sum(debit-credit) FROM public.journal_lines WHERE entry_id=entry) IS DISTINCT FROM 0 THEN
   RAISE EXCEPTION 'Mixed Trip invoice journal unbalanced'; END IF;
 IF (SELECT count(*) FROM public.transport_customer_document_trips WHERE document_id=(posted->>'transport_document_id')::uuid)<>2 THEN
   RAISE EXCEPTION 'Mixed invoice lost per-Trip linkage'; END IF;
 INSERT INTO public.transport_vehicles(company_id,business_unit_id,vehicle_no,ownership_type)
 VALUES(c,b,'UNLINKED-'||code,'company') RETURNING id INTO unlinked_vehicle;
 INSERT INTO public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,vehicle_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 VALUES(c,b,'',current_date,customer,unlinked_vehicle,'A','C',150,0,'cash') RETURNING id INTO unlinked_trip;
 PERFORM public.transport_finalize_customer_rate(unlinked_trip,150,'manual');
 posted:=public.transport_post_customer_bill_grouped(ARRAY[unlinked_trip],current_date,service_rev,false,'UNLINKED-'||code,'{}'::jsonb);
 doc:=(posted->>'order_id')::uuid;
 IF (posted->>'status')<>'posted' OR doc IS NULL THEN
   RAISE EXCEPTION 'Company-owned vehicle without dedicated Income COA should use common Service Revenue'; END IF;
 SELECT id INTO entry FROM public.journal_entries WHERE source_document_id=doc AND status='posted';
 IF (SELECT sum(credit) FROM public.journal_lines WHERE entry_id=entry AND account_id=service_rev) IS DISTINCT FROM 150
 THEN RAISE EXCEPTION 'Unlinked vehicle service revenue did not post to selected GL'; END IF;
 RAISE NOTICE 'PASS: mixed company/supplier Trip invoice, Service Revenue GL, balanced AR and unlinked vehicle attribution';
END $$;
ROLLBACK;
