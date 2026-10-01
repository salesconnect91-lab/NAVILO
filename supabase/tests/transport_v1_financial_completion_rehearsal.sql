-- Isolated local PostgreSQL/Supabase only. Synthetic fixture rolls back.
begin;
do $$
declare u uuid:=gen_random_uuid();c uuid;b uuid;loc uuid;customer uuid;supplier uuid;supplier2 uuid;
 cash_id uuid;acct uuid;cost uuid;ar uuid;ap uuid;code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 trip uuid;trip2 uuid;cash_trip uuid;driver uuid;vehicle uuid;rent uuid;rent2 uuid;bill uuid;bill2 uuid;sales_id uuid;sales2 uuid;cashbill uuid;
 original_journal jsonb;original_lines jsonb;original_bill jsonb;result jsonb;rejected boolean;j uuid;original jsonb;newer jsonb;paid_j uuid;initial_alloc jsonb;
 auth_trip uuid;employee uuid;accrual uuid;salary uuid;salary2 uuid;salary_ac uuid;payable uuid;driver_trip uuid;vat_trip uuid;vat_bill uuid;vat_rent uuid;vat_purchase uuid;other_bu uuid;other_c uuid;old_bu uuid;member uuid;reversal uuid;request_id uuid:=gen_random_uuid();st text;v numeric;payload jsonb;
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
 insert into public.transport_vehicles(company_id,business_unit_id,vehicle_no) values(c,b,'FIN-V') returning id into vehicle;
 insert into public.transport_drivers(company_id,business_unit_id,driver_name) values(c,b,'Financial Driver') returning id into driver;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,vehicle_id,driver_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,vehicle,driver,'A','B',1000,400,'credit') returning id into trip;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,'A','B',200,0,'credit') returning id into trip2;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,'A','B',100,0,'cash') returning id into cash_trip;
 result:=public.transport_post_customer_bill(trip,current_date,false);sales_id:=(result->>'document_id')::uuid;
 result:=public.transport_post_customer_bill(trip2,current_date,false);sales2:=(result->>'document_id')::uuid;
 result:=public.transport_post_customer_bill(cash_trip,current_date,false);cashbill:=(result->>'document_id')::uuid;
 if not exists(select 1 from public.transport_customer_documents where sales_order_id=cashbill and document_kind='cash_hand_bill') then raise exception 'Cash bill subtype missing';end if;
 if exists(select 1 from public.stock_movements where source_id in(sales_id,sales2,cashbill)) then raise exception 'Service created inventory movement';end if;
 select to_jsonb(s) into original from public.sales_orders s where id=sales_id;
 select to_jsonb(original_entry) into original_journal from public.journal_entries original_entry join public.transport_customer_documents d on d.journal_entry_id=original_entry.id where d.sales_order_id=sales_id;
 select jsonb_agg(to_jsonb(l) order by l.id) into original_lines from public.journal_lines l join public.transport_customer_documents d on d.journal_entry_id=l.entry_id where d.sales_order_id=sales_id;
 rejected:=false;begin update public.sales_service_lines set amount=1100 where order_id=sales_id;exception when others then rejected:=true;end;
 if not rejected then raise exception 'Posted service line overwrite allowed';end if;

 result:=public.transport_settle_documents('customer',customer,current_date,cash_id,'cash',jsonb_build_array(jsonb_build_object('document_id',sales_id,'amount',300)));
 paid_j:=(result->>'journal_entry_id')::uuid;
 if (select customer_received_gross from public.transport_trip_financial_summary where id=trip)<>300
 or (select customer_received_gross from public.transport_trip_financial_summary where id=trip2)<>0 then raise exception 'Receipt cross-attribution';end if;
 rent:=public.transport_add_supplier_rent(trip,supplier,300,'Owner rent split');
 rent2:=public.transport_add_supplier_rent(trip,supplier2,100,'Second supplier rent');
 result:=public.transport_post_supplier_bill(rent,current_date,acct,false);bill:=(result->>'document_id')::uuid;
 result:=public.transport_post_supplier_bill(rent2,current_date,acct,false);bill2:=(result->>'document_id')::uuid;
 result:=public.transport_settle_documents('supplier',supplier,current_date,cash_id,'cash',jsonb_build_array(jsonb_build_object('document_id',bill,'amount',100)));
 if (select supplier_outstanding_gross from public.transport_trip_financial_summary where id=trip)<>300 then raise exception 'Multi-supplier partial attribution';end if;
 rejected:=false;begin update public.transport_trips set customer_rate=1100 where id=trip;exception when others then rejected:=true;end;
 if not rejected then raise exception 'Posted normal rate overwrite accepted';end if;
 rejected:=false;begin delete from public.transport_trips where id=trip;exception when others then rejected:=true;end;
 if not rejected then raise exception 'Financial Trip deletion accepted';end if;
 result:=public.transport_adjust_rate(trip,'customer',1100,'Additional customer service');
 if (select customer_net from public.transport_trip_financial_summary where id=trip)<>1100 then raise exception 'Positive customer correction';end if;
 result:=public.transport_adjust_rate(trip,'customer',900,'Correct customer overcharge');
 if (select customer_net from public.transport_trip_financial_summary where id=trip)<>900
 or (select customer_outstanding_gross from public.transport_trip_financial_summary where id=trip)<>600 then raise exception 'Negative correction after partial receipt';end if;
 result:=public.transport_adjust_rate(trip,'supplier',350,'Additional supplier rent',current_date,rent);
 result:=public.transport_adjust_rate(trip,'supplier',250,'Correct supplier rent',current_date,rent);
 if (select supplier_net from public.transport_trip_financial_summary where id=trip)<>350
 or (select supplier_outstanding_gross from public.transport_trip_financial_summary where id=trip)<>250 then raise exception 'Supplier corrections after partial payment';end if;
 result:=public.transport_settle_documents('customer',customer,current_date,cash_id,'cash',jsonb_build_array(jsonb_build_object('document_id',sales_id,'amount',600),jsonb_build_object('document_id',sales2,'amount',200),jsonb_build_object('document_id',cashbill,'amount',100)));
 result:=public.transport_settle_documents('supplier',supplier,current_date,cash_id,'cash',null,150);
 result:=public.transport_settle_documents('supplier',supplier2,current_date,cash_id,'cash',null,100);
 update public.transport_trips set po_do_job_no='FIN-JOB-1' where id=trip;
 perform public.transport_complete_operations(trip,'Job completed');
 if (select financial_status from public.transport_trip_financial_summary where id=trip)<>'Closed' then raise exception 'Fully settled Trip did not close';end if;
 select jsonb_agg(to_jsonb(a) order by id) into initial_alloc from public.invoice_payment_allocations a where sales_order_id=sales_id;
 select to_jsonb(je) into newer from public.journal_entries je where id=paid_j;
 result:=public.transport_adjust_rate(trip,'customer',850,'Correction after Closed');
 if (select customer_credit_gross from public.transport_trip_financial_summary where id=trip)<>50
 or (select financial_status from public.transport_trip_financial_summary where id=trip)<>'Under Settlement' then raise exception 'Closed correction credit/refund position';end if;
 if initial_alloc is distinct from (select jsonb_agg(to_jsonb(a) order by id) from public.invoice_payment_allocations a where sales_order_id=sales_id)
 or newer is distinct from (select to_jsonb(je) from public.journal_entries je where id=paid_j)
 then raise exception 'Rate correction rewrote payment history';end if;
 if (original-'paid_amount'-'outstanding_amount'-'payment_status'-'updated_at'-'updated_by') is distinct from
 (select to_jsonb(s)-'paid_amount'-'outstanding_amount'-'payment_status'-'updated_at'-'updated_by' from public.sales_orders s where id=sales_id) then raise exception 'Original posted invoice changed';end if;
 result:=public.transport_refund_service_credit('customer',sales_id,current_date,cash_id,50,'Refund overcharge');
 if (select financial_status from public.transport_trip_financial_summary where id=trip)<>'Closed' then raise exception 'Refund did not resolve credit';end if;
 result:=public.transport_adjust_rate(trip,'supplier',200,'Owner overpaid after close',current_date,rent);
 if (select supplier_credit_gross from public.transport_trip_financial_summary where id=trip)<>50 then raise exception 'Supplier credit after full payment';end if;
 result:=public.transport_refund_service_credit('supplier',bill,current_date,cash_id,50,'Recover supplier overpayment');
 result:=public.transport_post_cost(trip,'commission',supplier,20,current_date,acct,false);
 j:=(result->>'document_id')::uuid;
 if (select financial_status from public.transport_trip_financial_summary where id=trip)<>'Under Settlement' then raise exception 'Unpaid approved cost must reopen settlement';end if;
 result:=public.transport_settle_documents('supplier',supplier,current_date,cash_id,'cash',jsonb_build_array(jsonb_build_object('document_id',j,'amount',20)));
 if (select commission_paid_net from public.transport_trip_financial_summary where id=trip)<>20
 or (select posted_profit from public.transport_trip_financial_summary where id=trip)<>530 then raise exception 'Posted profit/commission reconciliation';end if;
 rejected:=false;begin perform public.transport_settle_documents('customer',customer,current_date,cash_id,'cash',jsonb_build_array(jsonb_build_object('document_id',sales_id,'amount',1)));exception when others then rejected:=true;end;
 if not rejected then raise exception 'Overreceipt accepted after correction';end if;
 perform public.reverse_payment_voucher(paid_j,current_date,'Reverse first receipt');
 if (select customer_outstanding_gross from public.transport_trip_financial_summary where id=trip)<>300 then raise exception 'Canonical receipt reversal not reflected';end if;
 -- Journal, GL and party subledger proof in base currency.
 if exists(select 1 from public.journal_entries je join public.journal_lines l on l.entry_id=je.id where je.company_id=c and je.status='posted' group by je.id having abs(sum(l.debit-l.credit))>0.005) then raise exception 'Unbalanced posted journal';end if;
 select sum(debit-credit) into v from public.party_ledgers where company_id=c and party_id=customer;
 if v is distinct from (select sum(customer_outstanding_gross-customer_credit_gross) from public.transport_trip_financial_summary where company_id=c) then raise exception 'Customer ledger does not reconcile %',v;end if;
 select sum(credit-debit) into v from public.party_ledgers where company_id=c and party_id in(supplier,supplier2);
 if v is distinct from (select sum(outstanding_gross-credit_gross) from public.transport_service_document_balances where company_id=c and side='supplier') then raise exception 'Supplier ledger does not reconcile %',v;end if;
 -- VAT is allocated on gross amounts and decomposed on original document basis.
 insert into public.company_tax_events(company_id,effective_from,tax_mode,authority_code) values(c,current_date,'tax_registered','REHEARSAL');
 insert into public.tax_rates(user_id,company_id,name,rate,applies_to,is_fixed,is_active,effective_from) values(u,c,'Transport VAT 18%',18,'both',true,true,current_date);
 update public.customers set tax_registration_status='registered',strn='CUSTOMER-VAT' where id=customer;
 update public.suppliers set tax_registration_status='registered',strn='SUPPLIER-VAT' where id=supplier;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,'VAT A','VAT B',100,40,'credit') returning id into vat_trip;
 result:=public.transport_post_customer_bill(vat_trip,current_date,true);vat_bill:=(result->>'document_id')::uuid;
 vat_rent:=public.transport_add_supplier_rent(vat_trip,supplier,40,'Taxable rent');result:=public.transport_post_supplier_bill(vat_rent,current_date,acct,true);vat_purchase:=(result->>'document_id')::uuid;
 result:=public.transport_settle_documents('customer',customer,current_date,cash_id,'cash',jsonb_build_array(jsonb_build_object('document_id',vat_bill,'amount',59)));
 if (select received_from_company from public.transport_financial_register where id=vat_trip)<>50
 or (select remaining_with_company from public.transport_financial_register where id=vat_trip)<>50
 or (select customer_outstanding_gross from public.transport_trip_financial_summary where id=vat_trip)<>59 then raise exception 'VAT net/gross receipt decomposition';end if;
 result:=public.transport_adjust_rate(vat_trip,'customer',80,'VAT correction after partial receipt');
 if (select customer_net from public.transport_trip_financial_summary where id=vat_trip)<>80
 or (select customer_outstanding_gross from public.transport_trip_financial_summary where id=vat_trip)<>35.4 then raise exception 'VAT credit snapshot correction';end if;
 result:=public.transport_settle_documents('customer',customer,current_date,cash_id,'cash',jsonb_build_array(jsonb_build_object('document_id',vat_bill,'amount',35.4)));
 result:=public.transport_settle_documents('supplier',supplier,current_date,cash_id,'cash',jsonb_build_array(jsonb_build_object('document_id',vat_purchase,'amount',47.2)));
 if (select posted_profit from public.transport_trip_financial_summary where id=vat_trip)<>40 then raise exception 'VAT excluded from trip profit';end if;
 -- Canonical driver payroll evidence. A salary payment without attribution
 -- cannot close a Trip or count as Trip paid.
 insert into public.employees(user_id,company_id,name,is_active) values(u,c,'Payroll Driver',true) returning id into employee;
 update public.transport_drivers set employee_id=employee where id=driver;
 insert into public.chart_of_accounts(user_id,company_id,code,name,type,detail_type,is_group,allow_manual_entries,is_active,normal_balance)
 values(u,c,'TEST-SAL-PAY','Salary Payable','liability','Salary Payable',false,true,true,'credit') returning id into payable;
 insert into public.account_mappings(user_id,company_id,mapping_key,account_id) values(u,c,'salary_expense',acct) on conflict(company_id,mapping_key) do update set account_id=excluded.account_id;
 perform public.set_employee_salary_profile(employee,100,date_trunc('month',current_date)::date);
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,driver_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,driver,'Driver A','Driver B',200,0,'credit') returning id into driver_trip;
 perform public.transport_set_driver_pay(driver_trip,60,'Agreed Trip pay');
 result:=public.transport_post_customer_bill(driver_trip,current_date,true);j:=(result->>'document_id')::uuid;
 result:=public.transport_settle_documents('customer',customer,current_date,cash_id,'cash',jsonb_build_array(jsonb_build_object('document_id',j,'amount',236)));
 update public.transport_trips set po_do_job_no='FIN-JOB-DRIVER' where id=driver_trip;
 perform public.transport_complete_operations(driver_trip,'Driver job complete');
 result:=public.accrue_employee_salary(employee,current_date);
 select id into accrual from public.employee_salary_accruals where employee_id=employee and company_id=c;
 perform public.attribute_transport_driver_account(driver_trip,accrual,60,'accrual');
 result:=public.post_salary_payment(employee,current_date,current_date,acct,cash_id,30,'DRIVER-P1','Partial salary');
 select id into salary from public.employee_salary_payments where journal_entry_id=(result->>'journal_entry_id')::uuid;
 if (select driver_paid from public.transport_trip_financial_summary where id=driver_trip)<>0 then raise exception 'Unattributed driver payment leaked';end if;
 perform public.attribute_transport_driver_account(driver_trip,salary,30,'payment');
 if (select driver_outstanding from public.transport_trip_financial_summary where id=driver_trip)<>30 or (select financial_status from public.transport_trip_financial_summary where id=driver_trip)<>'Under Settlement' then raise exception 'Partial driver settlement';end if;
 result:=public.post_salary_payment(employee,current_date,current_date,acct,cash_id,30,'DRIVER-P2','Full Trip share');
 select id into salary2 from public.employee_salary_payments where journal_entry_id=(result->>'journal_entry_id')::uuid;
 perform public.attribute_transport_driver_account(driver_trip,salary2,30,'payment');
 if (select financial_status from public.transport_trip_financial_summary where id=driver_trip)<>'Closed' or (select posted_profit from public.transport_trip_financial_summary where id=driver_trip)<>140 then raise exception 'Payroll evidence closure/profit';end if;
 rejected:=false;begin perform public.attribute_transport_driver_account(driver_trip,salary2,1,'payment');exception when others then rejected:=true;end;if not rejected then raise exception 'Overallocated payroll accepted';end if;
 rejected:=false;begin update public.transport_trips set driver_pay=0 where id=driver_trip;exception when others then rejected:=true;end;if not rejected then raise exception 'Posted driver pay was editable';end if;
 -- Cost upload is all-or-nothing and safe to retry with same request ID.
 payload:=jsonb_build_array(jsonb_build_object('trip_id',vat_trip,'amount',5,'date',current_date,'reference','UP-1'));
 result:=public.transport_post_cost_chunk(request_id,payload,supplier,acct,true);
 newer:=public.transport_post_cost_chunk(request_id,payload,supplier,acct,true);
 if result is distinct from newer or (select count(*) from public.transport_service_cost_links where trip_id=vat_trip and cost_kind='driver_expense')<>1 then raise exception 'Cost upload retry created duplicate accounting';end if;
 rejected:=false;begin perform public.transport_post_cost_chunk(gen_random_uuid(),payload||jsonb_build_array(jsonb_build_object('trip_id',gen_random_uuid(),'amount',5,'date',current_date)),supplier,acct,true);exception when others then rejected:=true;end;
 if not rejected or (select count(*) from public.transport_service_cost_links where trip_id=vat_trip and cost_kind='driver_expense')<>1 then raise exception 'Invalid cost batch partly posted';end if;

 -- Authorized browser role can post and read; it cannot mutate private attribution.
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,'Auth A','Auth B',20,0,'credit') returning id into auth_trip;
 execute 'set local role authenticated';
 result:=public.transport_post_customer_bill(auth_trip,current_date,true);
 if (select customer_net from public.transport_trip_financial_summary where id=auth_trip)<>20 then raise exception 'Authorized financial evidence hidden';end if;
 rejected:=false;begin update public.transport_customer_document_trips set rate_snapshot=1 where trip_id=auth_trip;exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Direct attribution write was allowed';end if;
 execute 'reset role';
 -- Test real RLS under the authenticated role and cross-BU RPC denial.
 insert into public.business_units(company_id,name,code,unit_type,is_active) values(c,'Other Transport BU','OT-'||code,'transport',true) returning id into other_bu;
 insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active) values(c,other_bu,u,'company_owner',true);
 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled) values(c,other_bu,'transport',true),(c,other_bu,'accounting',true);
 update public.user_profiles set last_business_unit_id=other_bu where id=u;
 execute 'set local role authenticated';
 if exists(select 1 from public.transport_trip_supplier_rents where trip_id=trip) or exists(select 1 from public.transport_customer_document_trips where trip_id=trip) then raise exception 'Cross-BU RLS read leak';end if;
 rejected:=false;begin perform public.transport_post_customer_bill(trip,current_date,false);exception when others then rejected:=true;end;if not rejected then raise exception 'Cross-BU posting accepted';end if;
 execute 'reset role';update public.user_profiles set last_business_unit_id=b where id=u;
 insert into public.companies(name,code,status) values('Other isolated company','OC-'||code,'active') returning id into other_c;
 select id into old_bu from public.business_units where company_id=other_c and is_default;
 insert into public.company_memberships(company_id,user_id,role,is_active) values(other_c,u,'company_owner',true);
 insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active) values(other_c,old_bu,u,'company_owner',true) on conflict(business_unit_id,user_id) do update set is_active=true;
 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled) values(other_c,old_bu,'transport',true),(other_c,old_bu,'accounting',true) on conflict(business_unit_id,module_key) do update set enabled=true;
 update public.user_profiles set last_company_id=other_c,last_business_unit_id=old_bu where id=u;
 execute 'set local role authenticated';
 if exists(select 1 from public.transport_customer_document_trips where trip_id=trip) or exists(select 1 from public.transport_service_note_lines where order_id=sales_id) then raise exception 'Cross-company RLS read leak';end if;
 rejected:=false;begin perform public.transport_adjust_rate(trip,'customer',950,'Cross-company attempt');exception when others then rejected:=true;end;if not rejected then raise exception 'Cross-company RPC accepted';end if;
 execute 'reset role';update public.user_profiles set last_company_id=c,last_business_unit_id=b where id=u;

 if original_journal is distinct from (select to_jsonb(original_entry) from public.journal_entries original_entry join public.transport_customer_documents d on d.journal_entry_id=original_entry.id where d.sales_order_id=sales_id)
 or original_lines is distinct from (select jsonb_agg(to_jsonb(l) order by l.id) from public.journal_lines l join public.transport_customer_documents d on d.journal_entry_id=l.entry_id where d.sales_order_id=sales_id) then raise exception 'Original invoice journal/lines changed during correction';end if;
 -- GL/COA account balances and the resulting trial balance must agree exactly.
 if exists(with journal as (select l.account_id,sum(l.debit) debit,sum(l.credit) credit from public.journal_lines l join public.journal_entries j on j.id=l.entry_id where j.company_id=c and j.status='posted' group by l.account_id),
 gl as (select account_id,sum(debit) debit,sum(credit) credit from public.ledgers where company_id=c group by account_id)
 select 1 from journal j full join gl g using(account_id) where abs(coalesce(j.debit,0)-coalesce(g.debit,0))>0.005 or abs(coalesce(j.credit,0)-coalesce(g.credit,0))>0.005) then raise exception 'COA/GL does not reconcile posted journals';end if;
 if abs((select sum(debit-credit) from public.ledgers where company_id=c))>0.005 then raise exception 'Trial balance is unbalanced';end if;
 if (select paid_amount from public.sales_orders where id=sales_id) is distinct from (select paid_gross-refunded_gross from public.transport_service_document_balances where side='customer' and order_id=sales_id) then raise exception 'Canonical invoice payment snapshot differs after refund/reversal';end if;
 rejected:=false;begin
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,status,reversal_of_entry_id)
 select u,c,b,loc,'FORBIDDEN-REV-'||code,current_date,'draft',journal_entry_id from public.transport_customer_documents where sales_order_id=sales_id;
 exception when others then if sqlerrm not like 'Transport posted billing/credit/refund history is immutable%' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'Original Transport billing reversal bypass accepted';end if;

 select sum(debit-credit) into v from public.party_ledgers where company_id=c and party_id=customer;
 if v is distinct from (select sum(outstanding_gross-credit_gross) from public.transport_service_document_balances where company_id=c and side='customer') then raise exception 'Final VAT/customer AR ledger reconciliation failed';end if;
 select sum(credit-debit) into v from public.party_ledgers where company_id=c and party_id in(supplier,supplier2);
 if v is distinct from (select sum(outstanding_gross-credit_gross) from public.transport_service_document_balances where company_id=c and side='supplier') then raise exception 'Final VAT/cost supplier AP ledger reconciliation failed';end if;
 -- Permission is enforced inside RPC, irrespective of client state.
 perform public.transport_set_financial_permission(u,'adjustment',false);
 rejected:=false;begin perform public.transport_adjust_rate(trip,'customer',900,'Denied correction');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Granular permission denial ignored';end if;
 raise notice 'PASS: canonical credit/cash service billing; receipt and AP allocation; multiple Trips/suppliers; partial/full settlement; positive/negative corrections; Closed/refund; posted history; commission/profit; reversal; ledger reconciliation; delete/edit and permission guards';
end $$;
rollback;
