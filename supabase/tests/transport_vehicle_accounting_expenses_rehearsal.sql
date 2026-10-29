-- Isolated synthetic companies only. No production data. All changes rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid();c uuid;b uuid;loc uuid;customer uuid;supplier uuid;supplier2 uuid;
 cash_id uuid;acct uuid;cost uuid;ar uuid;ap uuid;revenue uuid;code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 tt uuid;v1 uuid;v2 uuid;doc uuid;expense_doc uuid;je uuid;rev uuid;bank uuid;res jsonb;payload jsonb;bad boolean;error_text text;v numeric;n bigint;before_trips bigint;sale uuid;acceptance_sale uuid;acceptance_je uuid;output_vat_account uuid;
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
  and id<>cost and coalesce(detail_type,'') not in ('COGS','Salaries') order by id limit 1;
 if acct is null then acct:=cost; end if;
 if ar is null or ap is null or acct is null or cash_id is null then raise exception 'Canonical accounting setup missing'; end if;
 insert into public.customers(user_id,company_id,name,account_id) values(u,c,'Service Customer',ar) returning id into customer;
 insert into public.suppliers(user_id,company_id,name,account_id) values(u,c,'Service Supplier',ap) returning id into supplier;

 insert into public.suppliers(user_id,company_id,name,account_id) values(u,c,'Second Supplier',ap) returning id into supplier2;

 select account_id into revenue from public.account_mappings where company_id=c and mapping_key='sales_revenue' limit 1;
 -- Keep Trip Service and Normal Sale revenue mappings distinct.
 update public.customers set strn='CUSTOMER-VAT' where id=customer;
 update public.suppliers set strn='SUPPLIER-VAT' where id=supplier;
 insert into public.tax_rates(user_id,company_id,name,rate,is_active,is_fixed,applies_to,effective_from,effective_to)
 values(u,c,'VAT 15',15,true,true,'both','2020-01-01','2026-12-31'),(u,c,'VAT 18',18,true,true,'both','2027-01-01',null);
 perform public.transport_set_party_billing_mode('customer',customer,'Credit');
 perform public.transport_set_party_billing_mode('supplier',supplier,'Cash');

 insert into public.platform_features(feature_key,module_key,label,category,supported_actions,default_enabled,core_locked,is_active,source) values('journal','accounting','Journal Entries','transaction',array['view','create','edit','post','delete','print','export']::text[],true,false,true,'test') on conflict(feature_key) do update set supported_actions=excluded.supported_actions,default_enabled=true,is_active=true;
 insert into public.company_feature_entitlements(company_id,feature_key,enabled,action_overrides) values(c,'journal',true,'{}') on conflict(company_id,feature_key) do update set enabled=true;
 insert into public.transport_truck_types(company_id,business_unit_id,name) values(c,b,'Trailer') returning id into tt;
 v1:=public.transport_create_vehicle_master('EXP-1',tt,'company',null,'2026-01-01');
 v2:=public.transport_create_vehicle_master('EXP-2',tt,'company',null,'2026-01-01');
 -- Revenue from company vehicles uses a dedicated linked Income GL; no manual
 -- duplicate journal and no changes to the expense account classification.
 perform public.accounting_setup_company_vehicle_income_accounts();
 if (select count(distinct revenue_account_id) from public.transport_vehicles where id in(v1,v2))<>2
    or exists(select 1 from public.transport_vehicles where id in(v1,v2) and revenue_account_id is null)
 then raise exception 'Dedicated vehicle Income COA mapping missing in rehearsal';end if;
 insert into public.transport_vehicle_expense_types(company_id,business_unit_id,name) values(c,b,'Fuel');
 insert into public.chart_of_accounts(user_id,company_id,code,name,type,normal_balance,detail_type,is_active,is_group,allow_manual_entries) values(u,c,'BANK-EXP','Expense Bank','asset','debit','Bank Account',true,false,true) returning id into bank;
 payload:=jsonb_build_object('expense_group','MULTI-1','expense_date','2026-10-17','payment_method','cash','payment_account_id',cash_id,'lines',jsonb_build_array(
  jsonb_build_object('vehicle_id',v1,'expense_type','Fuel','description','Fuel VAT','expense_account_id',acct,'net_amount','100.00','vat_rate',15,'source_reference','EXP-REF-1','vat_recoverable',true),
  jsonb_build_object('vehicle_id',v2,'expense_type','Fuel','description','No VAT','expense_account_id',acct,'net_amount','200','vat_rate',0,'source_reference','EXP-REF-2'),
  jsonb_build_object('vehicle_id',v2,'expense_type','Fuel','description','Non-recoverable VAT','expense_account_id',acct,'net_amount','100','vat_rate',15,'source_reference','EXP-REF-3','vat_recoverable',false)));
 set local role authenticated;
 res:=public.transport_vehicle_expense_save(payload);doc:=(res->>'document_id')::uuid;expense_doc:=doc;
 if (select status from public.transport_vehicle_expense_documents where id=doc)<>'draft' then raise exception 'Draft save failed';end if;
 res:=public.transport_vehicle_expense_save(payload,doc);
 res:=public.transport_vehicle_expense_post(doc);je:=(res->>'journal_entry_id')::uuid;
 if (res->>'gross')::numeric<>430 or (res->>'recoverable_vat')::numeric<>15 then raise exception 'Mixed VAT totals wrong %',res;end if;
 res:=public.transport_vehicle_expense_post(doc);
 if (res->>'already_posted')::boolean is not true or (res->>'journal_entry_id')::uuid<>je then raise exception 'Retry duplicated posting';end if;
 res:=public.transport_vehicle_ledger(v1,'2026-10-01','2026-10-31');
 if (res->>'cost')::numeric<>100 then raise exception 'Vehicle 1 report %',res;end if;
 res:=public.transport_vehicle_ledger(v2,'2026-10-01','2026-10-31');
 if (res->>'cost')::numeric<>315 then raise exception 'Vehicle 2 nonrecoverable VAT report %',res;end if;
 bad:=false;begin perform public.transport_vehicle_expense_save(payload,doc);exception when others then bad:=true;end;
 if not bad then raise exception 'Posted expense editable';end if;
 -- A read-only company user cannot call posted-reversal APIs directly.
 reset role;
 update public.user_profiles set role='user' where id=u;
 update public.company_memberships set role='viewer' where company_id=c and user_id=u;
 update public.business_unit_memberships set role='viewer' where business_unit_id=b and user_id=u;
 update public.operating_location_memberships set role='viewer' where operating_location_id=loc and user_id=u;
 set local role authenticated;
 bad:=false;begin perform public.reverse_manual_journal_entry(je,'2026-10-18','Denied read-only user');exception when others then bad:=true;end;
 if not bad then raise exception 'Read-only user bypassed posted journal reversal authorization';end if;
 bad:=false;begin perform public.transport_vehicle_expense_reverse(doc,'2026-10-18','Denied read-only user');exception when others then bad:=true;end;
 if not bad then raise exception 'Read-only user bypassed posted expense reversal authorization';end if;
 reset role;
 update public.user_profiles set role='admin',platform_role='user' where id=u;
 update public.company_memberships set role='admin' where company_id=c and user_id=u;
 update public.business_unit_memberships set role='admin' where business_unit_id=b and user_id=u;
 update public.operating_location_memberships set role='admin' where operating_location_id=loc and user_id=u;
 set local role authenticated;
 bad:=false;begin perform public.reverse_manual_journal_entry(je,'2026-10-18','Wrong screen');exception when insufficient_privilege then bad:=true;end;if not bad then raise exception 'Raw manual reversal API was not restricted to its audited wrapper';end if;
 res:=public.transport_vehicle_expense_reverse(doc,'2026-10-18','Isolated expense correction');rev:=(res->>'reversal_entry_id')::uuid;
 res:=public.transport_vehicle_ledger(v1,'2026-10-01','2026-10-31');if (res->>'cost')::numeric<>0 then raise exception 'Vehicle reversal omitted %',res;end if;
 bad:=false;begin perform public.transport_vehicle_expense_reverse(doc,'2026-10-19','Repeated');exception when others then bad:=true;end;if not bad then raise exception 'Duplicate reversal accepted';end if;
 reset role;
 if (select sum(debit-credit) from public.ledgers where journal_entry_id=je)<>0 or (select sum(debit) from public.ledgers where journal_entry_id=je)<>430 then raise exception 'GL expense imbalance/duplicate';end if;
 if (select sum(debit) from public.journal_lines where entry_id=je and account_id=(select account_id from public.account_mappings where company_id=c and mapping_key='input_vat'))<>15 then raise exception 'Input VAT wrong';end if;
 if (select sum(debit-credit) from public.ledgers where journal_entry_id in (je,rev))<>0 then raise exception 'Reversal GL imbalance';end if;
 -- Different groups import together, but a bad group rolls back the entire call.
 payload:=jsonb_set(payload,'{expense_group}','"ATOMIC-1"');
 payload:=jsonb_set(payload,'{lines}',jsonb_build_array(jsonb_build_object('vehicle_id',v1,'expense_type','Fuel','description','Atomic','expense_account_id',acct,'net_amount','50','vat_rate',0,'source_reference','ATOMIC-REF-1')));
 n:=(select count(*) from public.transport_vehicle_expense_documents where company_id=c);
 bad:=false;begin perform public.transport_vehicle_expense_import(jsonb_build_array(payload,jsonb_set(payload,'{expense_group}','"ATOMIC-2"')));exception when unique_violation then bad:=true;end;
 if not bad or (select count(*) from public.transport_vehicle_expense_documents where company_id=c)<>n then raise exception 'Failed import not atomic';end if;
 res:=public.transport_vehicle_expense_import(jsonb_build_array(payload,jsonb_set(jsonb_set(payload,'{expense_group}','"ATOMIC-2"'),'{lines,0,source_reference}','"ATOMIC-REF-2"')));
 if jsonb_array_length(res)<>2 then raise exception 'Multiple groups not imported';end if;
 -- Validate server-side ownership, tax transition and scopes.
 bad:=false;begin perform public.transport_vehicle_expense_save(jsonb_set(jsonb_set(payload,'{expense_group}','"BAD-VEH"'),'{lines,0,vehicle_id}',to_jsonb(gen_random_uuid())));exception when others then bad:=true;end;if not bad then raise exception 'Foreign vehicle accepted';end if;
 bad:=false;begin perform public.transport_vehicle_expense_save(jsonb_set(jsonb_set(jsonb_set(payload,'{expense_group}','"BAD-VAT"'),'{expense_date}','"2027-01-02"'),'{lines,0,vat_rate}','15'));exception when others then bad:=true;end;if not bad then raise exception 'Outdated tax rate accepted';end if;
 bad:=false;begin perform public.transport_vehicle_expense_save(jsonb_set(jsonb_set(payload,'{expense_group}','"BAD-DATE"'),'{expense_date}','"2025-12-31"'));exception when others then bad:=true;end;if not bad then raise exception 'Pre-ownership expense accepted';end if;
 payload:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{expense_group}','"FUTURE-18"'),'{expense_date}','"2027-01-02"'),'{lines,0,vat_rate}','18'),'{lines,0,source_reference}','"FUTURE-18"');
 perform public.transport_vehicle_expense_save(payload);
 payload:=jsonb_set(jsonb_set(payload,'{expense_date}','"2026-10-17"'),'{lines,0,vat_rate}','0');
 bad:=false;begin perform public.transport_vehicle_ledger(gen_random_uuid());exception when others then bad:=true;end;if not bad then raise exception 'Foreign vehicle report accepted';end if;
 -- Payable updates canonical supplier party balance, and reversal clears it.
 payload:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{expense_group}','"PAYABLE"'),'{payment_method}','"payable"'),'{supplier_id}',to_jsonb(supplier)),'{lines,0,source_reference}','"AP-REF"');
 res:=public.transport_vehicle_expense_save(payload);doc:=(res->>'document_id')::uuid;
 res:=public.transport_vehicle_expense_post(doc);je:=(res->>'journal_entry_id')::uuid;
 if (select sum(credit-debit) from public.party_ledgers where journal_entry_id=je and party_type='supplier' and party_id=supplier)<>50 then raise exception 'Supplier AP not updated';end if;
 perform public.transport_vehicle_expense_reverse(doc,'2026-10-18','AP correction');
 update public.user_profiles set platform_role='user' where id=u;
 -- Bank expense must credit chosen Bank, never Cash or AP.
 payload:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{expense_group}','"BANK"'),'{payment_method}','"bank"'),'{payment_account_id}',to_jsonb(bank)),'{lines,0,source_reference}','"BANK-REF"');
 res:=public.transport_vehicle_expense_save(payload);res:=public.transport_vehicle_expense_post((res->>'document_id')::uuid);je:=(res->>'journal_entry_id')::uuid;
 if (select sum(credit) from public.journal_lines where entry_id=je and account_id=bank)<>50 then raise exception 'Bank not credited';end if;
 res:=public.transport_save_vehicle_expense_draft('COMPAT','2026-10-17',null,'cash',jsonb_build_array(jsonb_build_object('vehicle_id',v1,'expense_type','Fuel','description','Compatible draft','net_amount','25','vat_rate',0,'source_reference','COMPAT-1')));
 if (select operating_location_id from public.transport_vehicle_expense_documents where id=(res->>'document_id')::uuid) is distinct from loc then raise exception 'Legacy draft RPC lost location scope';end if;
 -- Normal Sale: two vehicles + shared description, single AR/GL invoice, no Trip.
 -- Validate general expense billing with existing supplier modes.
 perform public.transport_set_party_billing_mode('supplier',supplier2,'Credit');
 update public.suppliers set strn='VAT-TEST-SUPPLIER' where id=supplier2;
 set local role authenticated;
 res:=public.general_expense_bill_create(supplier,'2026-10-17','EXP-CASH-TEST',acct,
  '[{"description":"General no VAT","amount":"100"}]'::jsonb,false,false,null);
 if res->>'status'<>'draft' then raise exception 'Expense creation skipped Draft';end if;
 perform public.post_purchase_invoice((res->>'document_id')::uuid);
 if (res->>'vat')::numeric<>0 then raise exception 'Expense without VAT mismatch';end if;
 if (res->>'invoice_no') !~ '^EXP-[0-9]{4,}$' then raise exception 'Expected compact Expense invoice sequence';end if;
 res:=public.general_expense_bill_create(supplier2,'2026-10-17','EXP-CREDIT-TEST',acct,
  '[{"description":"General with VAT","amount":"200"}]'::jsonb,true,false,null);
 if res->>'status'<>'draft' then raise exception 'VAT expense creation skipped Draft';end if;
 perform public.post_purchase_invoice((res->>'document_id')::uuid);
 if (res->>'vat')::numeric<>30 then raise exception 'Expense VAT mismatch';end if;
 if (res->>'invoice_no') !~ '^EXP-[0-9]{4,}$' then raise exception 'Expected compact VAT Expense invoice sequence';end if;
 res:=public.general_expense_bill_import(jsonb_build_array(
  jsonb_build_object('batch_ref','EXCEL-TEST-1','supplier_id',supplier2,'account_id',acct,'invoice_date','2026-10-17','supplier_invoice_no','EXCEL-SUP-1','description','Invoice row 1','amount','50','vat_choice','with_vat'),
  jsonb_build_object('batch_ref','EXCEL-TEST-1','supplier_id',supplier2,'account_id',acct,'invoice_date','2026-10-17','supplier_invoice_no','EXCEL-SUP-1','description','Invoice row 2','amount','25','vat_choice','with_vat')
 ),false);
 if (res->>'invoices')::integer<>1 or (res->>'lines')::integer<>2
 then raise exception 'Expense Excel import summary incorrect';end if;
 if not exists(select 1 from public.purchase_orders where id=(res->'documents'->0->>'document_id')::uuid and status='draft') then raise exception 'Expense import skipped Draft';end if;
 perform public.post_purchase_invoice((res->'documents'->0->>'document_id')::uuid);
 if not exists(select 1 from public.purchase_orders p where p.id=(res->'documents'->0->>'document_id')::uuid and p.status='posted')
 then raise exception 'Expense Excel import did not post invoice';end if;

 -- A customer Normal Sale must never become draft or posted without a Vehicle,
 -- even when callers bypass the browser or submit direct RPC/import JSON.
 bad:=false;
 begin
   perform public.transport_normal_invoice_create('customer',customer,'2026-10-17',
     '[{"description":"Unassigned vehicle must fail","amount":"10"}]'::jsonb,
     revenue,'NO-VEHICLE-MUST-FAIL',null,false);
 exception when others then
   if position('requires a company-owned Vehicle Master' in sqlerrm)>0 then bad:=true;else raise;end if;
 end;
 if not bad then raise exception 'Normal Sale without Vehicle was incorrectly accepted';end if;
 -- Credit Sale invoice acceptance, synthetic company and rollback at end.
 select account_id into strict output_vat_account from public.account_mappings
 where company_id=c and mapping_key='output_vat';
 bad:=false;
 begin
   perform public.transport_normal_invoice_create_vat('customer',customer,'2026-10-17',
    '[{"description":"Missing original credit invoice","amount":"100"}]'::jsonb,
    revenue,null,null,false,'master');
 exception when others then
   if position('requires genuine original invoice number' in sqlerrm)>0 then bad:=true;else raise;end if;
 end;
 if not bad then raise exception 'Credit invoice without genuine original reference incorrectly created';end if;
 res:=public.transport_normal_invoice_create_vat('customer',customer,'2026-10-17',
  jsonb_build_array(jsonb_build_object('description','Standalone customer acceptance','amount','100','vehicle_id',v1)),
  revenue,'ACCEPTANCE-CREDIT-100',null,false,'master');
 acceptance_sale:=(res->>'document_id')::uuid;
 if (res->>'status')<>'draft' or (res->>'vat')::numeric<>15
   or (select status from public.sales_orders where id=acceptance_sale)<>'draft'
   or exists(select 1 from public.journal_entries where source_document_id=acceptance_sale)
 then raise exception 'Draft Sales invoice incorrectly created journal entries';end if;
 res:=public.post_sales_invoice(acceptance_sale);
 acceptance_je:=(res->>'journal_entry_id')::uuid;
 if acceptance_je is null
   or (select status from public.sales_orders where id=acceptance_sale)<>'posted'
   or coalesce((select outstanding_amount from public.sales_orders where id=acceptance_sale),0)<>115
   or coalesce((select sum(debit-credit) from public.journal_lines where entry_id=acceptance_je and account_id=ar),0)<>115
   or coalesce((select sum(credit-debit) from public.journal_lines where entry_id=acceptance_je and account_id=revenue),0)<>100
   or coalesce((select sum(credit-debit) from public.journal_lines where entry_id=acceptance_je and account_id=output_vat_account),0)<>15
   or coalesce((select sum(debit-credit) from public.party_ledgers where journal_entry_id=acceptance_je and party_type='customer' and party_id=customer),0)<>115
   or coalesce((select sum(debit-credit) from public.ledgers where journal_entry_id=acceptance_je),0)<>0
 then raise exception 'Posted Sale did not reconcile AR 115, Revenue 100, Output VAT 15, customer ledger and balanced GL';end if;
 raise notice 'PASS standalone Sale Credit: required original; draft no GL; posted AR 115, Revenue 100, Output VAT 15';
 res:=public.transport_normal_invoice_create_vat('customer',customer,'2026-10-17',
  jsonb_build_array(jsonb_build_object('description','VAT choice invoice','amount','100','vehicle_id',v1)),revenue,'VAT-CHOICE-GOOD',null,false,'with_vat');
 if (res->>'vat')::numeric<>15 then raise exception 'Normal VAT choice wrong total';end if;
 perform public.post_sales_invoice((res->>'document_id')::uuid);
 bad:=false;
 begin
  perform public.transport_normal_invoice_create_vat('customer',customer,'2026-10-17',
   jsonb_build_array(jsonb_build_object('description','Wrong VAT choice','amount','100','vehicle_id',v1)),revenue,'VAT-CHOICE-INVALID',null,false,'without_vat');
 exception when others then bad:=true;end;
 if not bad then raise exception 'Normal VAT selection rule not enforced';end if;
 reset role;
 before_trips:=(select count(*) from public.transport_trips where company_id=c);
 set local role authenticated;
 res:=public.transport_normal_invoice_create('customer',customer,'2026-10-17',jsonb_build_array(
 jsonb_build_object('description','Vehicle one sale','amount','300','vehicle_id',v1),jsonb_build_object('description','Vehicle two sale','amount','200','vehicle_id',v2),jsonb_build_object('description','Third vehicle-one sale','amount','50','vehicle_id',v1)),revenue,'VEH-SALE-1',null,false);
 res:=res||public.post_sales_invoice((res->>'document_id')::uuid);
 sale:=(res->>'document_id')::uuid;je:=(res->>'journal_entry_id')::uuid;
 if (select count(*) from public.transport_normal_vehicle_allocations where journal_entry_id=je)<>3 then raise exception 'Posted allocation snapshots incomplete';end if;
 if (res->>'net')::numeric<>550 or (res->>'vat')::numeric<>82.5 then raise exception 'Sale VAT %',res;end if;
 res:=public.transport_vehicle_ledger(v1,'2026-10-01','2026-10-31');if (res->>'revenue')::numeric<>550 then raise exception 'Normal Sale vehicle allocation wrong %',res;end if;
 res:=public.transport_vehicle_ledger(v2,'2026-10-01','2026-10-31');if (res->>'revenue')::numeric<>200 then raise exception 'Normal Sale vehicle 2 wrong %',res;end if;
 reset role;
 if (select sum(debit-credit) from public.party_ledgers where journal_entry_id=je and party_type='customer')<>632.5 then raise exception 'Customer AR not updated';end if;
 if (select count(*) from public.transport_trips where company_id=c)<>before_trips then raise exception 'Normal Sale created Trip';end if;
 if (select sum(debit-credit) from public.ledgers where journal_entry_id=je)<>0 then raise exception 'Normal Sale GL imbalance';end if;
 if coalesce((select sum(credit) from public.journal_lines where entry_id=je and account_id=revenue),0)<>550
    or exists (select 1 from public.journal_lines l join public.transport_vehicles v on v.revenue_account_id=l.account_id where l.entry_id=je and v.id in (v1,v2))
 then raise exception 'Normal Sale must credit chosen common Revenue once; vehicle attribution stays in snapshots';end if;
 -- Same stable reference cannot be claimed by Vehicle Expense and Direct Cash,
 -- while a genuinely separate expense with the same date and amount remains valid.
 if not exists(select 1 from public.transport_vehicle_expense_document_lines
   where document_id=expense_doc and lower(btrim(source_reference))='exp-ref-1') then
   raise exception 'Vehicle Expense source reference was not persisted on its line';
 end if;
 if not exists(select 1 from public.accounting_expense_source_claims
   where company_id=c and business_unit_id=b and source_reference='exp-ref-1'
     and source_kind='transport_vehicle_expense') then
   raise exception 'Vehicle Expense source reference claim missing before cross-workflow retry';
 end if;
 bad:=false;
 begin
  perform public.accounting_import_direct_cash_expenses(jsonb_build_array(jsonb_build_object(
   'transaction_date','2026-10-17','expense_area','general','amount','100.00',
   'expense_account_id',acct::text,'cash_bank_account_id',cash_id::text,
   'source_reference','EXP-REF-1','description','Duplicate source via direct cash','paid_to','Fixture'
  )));
 exception when others then error_text:=sqlerrm; bad:=position('Duplicate Source Reference' in error_text)>0 or position('already imported expense' in error_text)>0 or position('already claimed' in error_text)>0; if not bad then raise exception 'Unexpected cross-workflow duplicate error: %',error_text;end if;
 end;
 if not bad then raise exception 'Vehicle Expense source reference was accepted through Direct Cash';end if;

 payload:=jsonb_build_array(jsonb_build_object(
  'transaction_date','2026-10-17','expense_area','general','amount','100.00',
  'expense_account_id',acct::text,'cash_bank_account_id',cash_id::text,
  'source_reference','CASH-SAME-DATE-AMOUNT','description','Separate legitimate expense','paid_to','Fixture'
 ));
 res:=public.accounting_import_direct_cash_expenses(payload);
 if coalesce((res->>'success')::boolean,false) is not true or (res->>'posted_count')::integer<>1 then
  raise exception 'Distinct source reference with same date and amount was rejected %',res;
 end if;
 bad:=false;
 begin
  perform public.accounting_import_direct_cash_expenses(payload);
 exception when others then error_text:=sqlerrm; bad:=position('Duplicate Source Reference' in error_text)>0 or position('already imported expense' in error_text)>0 or position('already claimed' in error_text)>0; if not bad then raise exception 'Unexpected cross-workflow duplicate error: %',error_text;end if;
 end;
 if not bad then raise exception 'Repeated Direct Cash upload created a second journal';end if;

 bad:=false;
 begin
  perform public.accounting_import_direct_cash_expenses(jsonb_build_array(
   jsonb_build_object('transaction_date','2026-10-17','expense_area','general','amount','40.00',
    'expense_account_id',acct::text,'cash_bank_account_id',cash_id::text,
    'source_reference','CASH-PARTIAL-FAIL','description','First batch row','paid_to','Fixture'),
   jsonb_build_object('transaction_date','2026-10-17','expense_area','general','amount','100.00',
    'expense_account_id',acct::text,'cash_bank_account_id',cash_id::text,
    'source_reference','CASH-SAME-DATE-AMOUNT','description','Duplicate second batch row','paid_to','Fixture')
  ));
 exception when others then error_text:=sqlerrm; bad:=position('Duplicate Source Reference' in error_text)>0 or position('already imported expense' in error_text)>0 or position('already claimed' in error_text)>0; if not bad then raise exception 'Unexpected cross-workflow duplicate error: %',error_text;end if;
 end;
 if not bad then raise exception 'Partial batch failure was not reported';end if;
 if exists(select 1 from public.accounting_direct_cash_expense_import_keys
           where company_id=c and business_unit_id=b and source_reference='cash-partial-fail')
 then raise exception 'Failed batch left behind a partial source claim or journal';end if;
 raise notice 'PASS vehicle expense mixed VAT, Cash/Bank/AP, atomic imports, ownership, idempotency, reversal, normal Sales AR/VAT/GL and multi-vehicle reports';
end $$;
rollback;
