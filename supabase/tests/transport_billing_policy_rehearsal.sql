-- Isolated fixture, real canonical AR/AP/VAT posting, rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid();c uuid;b uuid;loc uuid;customer uuid;supplier uuid;supplier2 uuid;
 cash_id uuid;acct uuid;cost uuid;ar uuid;ap uuid;code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 revenue uuid;cm uuid;trip uuid;trip2 uuid;draft_trip uuid;rent uuid;sale uuid;purchase uuid;group_sale uuid;group_purchase uuid;single_sale uuid;single_purchase uuid;result jsonb;v numeric;before_order jsonb;before_trip jsonb;blocked boolean;vehicle uuid;external_order uuid;external_line uuid;
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

 select id into revenue from public.chart_of_accounts where company_id=c and type='revenue' and is_active and not is_group order by id limit 1;
 update public.account_mappings set account_id=revenue where company_id=c and mapping_key='service_revenue';
 update public.customers set strn='CUSTOMER-VAT' where id=customer;
 update public.suppliers set strn='SUPPLIER-VAT' where id=supplier;
 insert into public.tax_rates(user_id,company_id,name,rate,is_active,is_fixed,applies_to,effective_from,effective_to)
 values(u,c,'VAT 15',15,true,true,'both','2020-01-01','2026-12-31'),(u,c,'VAT 18',18,true,true,'both','2027-01-01',null);
 perform public.transport_set_party_billing_mode('customer',customer,'Credit');
 perform public.transport_set_party_billing_mode('supplier',supplier,'Cash');
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'','2026-10-11',customer,'A','B',1000,0,'credit') returning id into trip;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'','2026-10-11',customer,'A','B',1000,0,'credit') returning id into trip2;
 perform public.transport_finalize_customer_rate(trip,1000,'manual','Billing fixture');
 perform public.transport_finalize_customer_rate(trip2,1000,'manual','Billing fixture');

 insert into public.sales_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,payment_mode)
 values(u,c,b,loc,'POL-S-'||code,customer,'2026-10-11','draft','Sale Invoice',0,(select base_currency_code from public.companies where id=c),1,'service','Cash') returning id into sale;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'','2026-10-11',customer,'A','B',1000,0,'credit') returning id into draft_trip;
 update public.transport_trips set sales_order_id=sale where id=draft_trip;

 insert into public.sales_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,revenue_account_id,source_module,source_id,created_by)
 values(c,b,sale,'Transport service',1000,0,revenue,'transport',gen_random_uuid(),u);
 insert into public.charge_master(user_id,company_id,charge_key,charge_name,applies_to,tax_applicable,revenue_account_id,cost_account_id,is_active,is_fixed,charge_type)
 values(u,c,'pol-'||code,'Waiting','both',true,revenue,acct,true,false,'recovery') returning id into cm;
 insert into public.sales_order_charges(company_id,business_unit_id,order_id,charge_key,charge_label,amount,tax_percent,account_id,charge_type,quantity,rate)
 values(c,b,sale,'pol-'||code,'Waiting',200,0,revenue,'recovery',1,200);
 if (select tax_percent from public.sales_service_lines where order_id=sale)<>15 then raise exception 'Credit VAT was not automatic';end if;
 insert into public.purchase_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,supplier_id,order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,supplier_invoice_no,supplier_invoice_date)
 values(u,c,b,loc,'POL-P-'||code,supplier,'2026-10-11','draft','Tax Invoice',15,(select base_currency_code from public.companies where id=c),1,'service','SOURCE-'||code,'2026-10-11') returning id into purchase;
 insert into public.purchase_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,cost_account_id,source_module,source_id,created_by)
 values(c,b,purchase,'Supplier service',500,15,acct,'transport',gen_random_uuid(),u);
 if (select tax_percent from public.purchase_service_lines where order_id=purchase)<>0 then raise exception 'Cash supplier VAT not zero';end if;
 -- Bidirectional corrections reprice every draft service line and charge atomically.
 perform public.transport_set_party_billing_mode('customer',customer,'Cash');
 if (select total from public.sales_orders where id=sale)<>1200 or exists(select 1 from public.sales_service_lines where order_id=sale and tax_percent<>0) or exists(select 1 from public.sales_order_charges where order_id=sale and tax_percent<>0) then raise exception 'Customer Credit to Cash correction incomplete';end if;
 if (select sale_type from public.transport_trips where id=draft_trip)<>'cash' then raise exception 'Draft-linked Trip mode correction was blocked';end if;
 if (select sale_type from public.transport_trips where id=trip)<>'cash' then raise exception 'Unposted Trip did not follow corrected Cash master';end if;
 perform public.transport_set_party_billing_mode('customer',customer,'Credit');
 if (select sale_type from public.transport_trips where id=trip)<>'credit' then raise exception 'Unposted Trip did not follow corrected Credit master';end if;
 if (select total from public.sales_orders where id=sale)<>1380 then raise exception 'Customer Cash to Credit correction incomplete';end if;
 update public.sales_orders set order_date='2027-01-02' where id=sale;
 if (select total from public.sales_orders where id=sale)<>1416 then raise exception 'Dated VAT transition not applied to drafts';end if;
 perform public.transport_set_party_billing_mode('supplier',supplier,'Credit');
 if (select total from public.purchase_orders where id=purchase)<>575 then raise exception 'Supplier Cash to Credit correction incomplete';end if;
 perform public.transport_set_party_billing_mode('supplier',supplier,'Cash');
 if (select total from public.purchase_orders where id=purchase)<>500 then raise exception 'Supplier Credit to Cash correction incomplete';end if;
 result:=public.post_sales_invoice(sale);
 if (result->>'vat')::numeric<>216 or (result->>'grand_total')::numeric<>1416 then raise exception 'Canonical sales VAT mismatch: %',result;end if;
 result:=public.post_purchase_invoice(purchase);
 if (result->>'vat')::numeric<>0 or (result->>'grand_total')::numeric<>500 then raise exception 'Canonical Cash purchase mismatch: %',result;end if;
 select to_jsonb(s) into before_order from public.sales_orders s where id=sale;
 perform public.transport_set_party_billing_mode('customer',customer,'Cash');
 if (select to_jsonb(s) from public.sales_orders s where id=sale) is distinct from before_order then raise exception 'Mode correction rewrote posted history';end if;
 if exists(select 1 from public.stock_movements where source_id in(sale,purchase)) then raise exception 'Transport billing moved inventory';end if;

 -- Single and grouped RPCs override even a deliberately wrong manual VAT flag.
 result:=public.transport_post_customer_bill_grouped(array[trip],'2026-10-11',revenue,true,'POL-G-CASH-'||code,'{}');group_sale:=(result->>'order_id')::uuid;
 if (result->>'vat')::numeric<>0 then raise exception 'Grouped Cash customer accepted manual VAT';end if;
 before_trip:=(select to_jsonb(t) from public.transport_trips t where id=trip);
 perform public.transport_set_party_billing_mode('customer',customer,'Credit');
 if (select to_jsonb(t) from public.transport_trips t where id=trip) is distinct from before_trip then raise exception 'Posted Trip changed with customer master';end if;
 result:=public.transport_post_customer_bill_accounted(trip2,'2026-10-11',revenue,false,'POL-SINGLE-'||code,null);single_sale:=(result->>'document_id')::uuid;
 if (result->>'vat')::numeric<>150 then raise exception 'Single Credit customer skipped automatic VAT';end if;
 rent:=public.transport_add_supplier_rent(trip,supplier,500,'Billing fixture');
 perform public.transport_finalize_supplier_rent(rent,500,'Billing fixture');
 result:=public.transport_post_supplier_bill_grouped(array[rent],'2026-10-11',acct,true,'SOURCE-G-'||code,'POL-G-SUP-'||code,'{}');group_purchase:=(result->>'order_id')::uuid;
 if (result->>'vat')::numeric<>0 then raise exception 'Grouped Cash supplier accepted manual VAT';end if;
 perform public.transport_set_party_billing_mode('supplier',supplier,'Credit');
 rent:=public.transport_add_supplier_rent(trip2,supplier,500,'Billing fixture');
 perform public.transport_finalize_supplier_rent(rent,500,'Billing fixture');
 result:=public.transport_post_supplier_bill_described(rent,'2026-10-11',acct,false,'SOURCE-SINGLE-'||code,'POL-SINGLE-SUP-'||code,null);single_purchase:=(result->>'document_id')::uuid;
 if (result->>'vat')::numeric<>75 then raise exception 'Single Credit supplier skipped automatic VAT';end if;
 if exists(select 1 from public.transport_customer_documents where sales_order_id in(group_sale,single_sale) and paid_amount<>0) then raise exception 'Billing mode fabricated a receipt';end if;
 result:=public.transport_adjust_rate(trip,'customer',1100,'Cash source remains without VAT','2026-10-11',null,null);
 if (result->'accounting_evidence'->0->>'vat')::numeric is distinct from 0 then raise exception 'Cash original adjustment adopted current Credit VAT';end if;
 perform public.transport_set_party_billing_mode('supplier',supplier,'Cash');
 result:=public.transport_adjust_rate(trip2,'supplier',600,'Credit source remains taxable','2026-10-11',rent,'ADJ-SOURCE');
 if (result->'accounting_evidence'->0->>'vat')::numeric is distinct from 15 then raise exception 'Credit original adjustment adopted current Cash mode';end if;

 -- An external invoice debit note retains its signed original VAT snapshot,
 -- even after master correction and a later effective rate.
 insert into public.transport_vehicles(company_id,business_unit_id,vehicle_no) values(c,b,'POL-'||code) returning id into vehicle;
 result:=public.transport_import_external_invoices('Policy fixture',revenue,jsonb_build_array(jsonb_build_object(
  'source_reference','EXT-LINE-'||code,'invoice_no','POL-EXT-'||code,'invoice_date','2026-10-11','customer','Service Customer','sale_type','Credit','vehicle_no','POL-'||code,'amount',100,'tax_percent',15,'tax_amount',15,'bill_amount',115,'description','External Transport service')));
 select id into external_order from public.sales_orders where company_id=c and order_no='POL-EXT-'||code;
 perform public.post_sales_invoice(external_order);
 select id into external_line from public.transport_external_invoice_lines where sales_order_id=external_order;
 perform public.transport_set_party_billing_mode('customer',customer,'Cash');
 result:=public.transport_post_external_invoice_note(gen_random_uuid(),external_order,'debit','2027-01-05','Source VAT preserved',jsonb_build_array(jsonb_build_object('line_id',external_line,'amount',50)));
 if (result->>'vat')::numeric is distinct from 7.5 then raise exception 'External debit note VAT changed with master/date: %',result;end if;
 if (select tax_percent from public.sales_orders where id=(result->>'debit_order_id')::uuid)<>15 then raise exception 'External debit source snapshot lost';end if;
 if exists(select 1 from public.transport_billing_correction_gate where transaction_id=txid_current()) or exists(select 1 from public.transport_billing_adjustment_gate where transaction_id=txid_current()) then raise exception 'Correction capability leaked beyond posting';end if;
 if has_function_privilege('anon','public.transport_set_party_billing_mode(text,uuid,text)','execute') or has_table_privilege('authenticated','public.transport_billing_adjustment_gate','insert') then raise exception 'Billing correction policy exposes privileged writes';end if;

 blocked:=false;begin perform public.transport_party_billing_mode('supplier',c,b,supplier2);exception when others then blocked:=true;end;
 if not blocked then raise exception 'Unset supplier billing mode silently inferred';end if;
 raise notice 'PASS Transport customer/supplier zero/automatic VAT, charges, bidirectional draft correction, date transition, canonical posting and posted-history preservation';
end $$;
rollback;
