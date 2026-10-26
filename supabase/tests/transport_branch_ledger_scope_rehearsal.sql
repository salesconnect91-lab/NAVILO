-- Isolated local PostgreSQL/Supabase only. Synthetic fixture rolls back.
begin;
do $$
declare u uuid:=gen_random_uuid();c uuid;b uuid;loc uuid;customer uuid;supplier uuid;supplier2 uuid;
 cash_id uuid;acct uuid;cost uuid;ar uuid;ap uuid;normal_rev uuid;vehicle_rev uuid;normal_doc uuid;code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 trip uuid;trip2 uuid;cash_trip uuid;driver uuid;vehicle uuid;rent uuid;rent2 uuid;bill uuid;bill2 uuid;sales_id uuid;sales2 uuid;cashbill uuid;
 original_journal jsonb;original_lines jsonb;original_bill jsonb;result jsonb;rejected boolean;j uuid;original jsonb;newer jsonb;paid_j uuid;initial_alloc jsonb;
 branch_index integer;branch2 uuid;target_loc uuid;test_amount numeric;test_date date;changed_count integer;auth_trip uuid;employee uuid;accrual uuid;salary uuid;salary2 uuid;salary_ac uuid;payable uuid;driver_trip uuid;vat_trip uuid;vat_bill uuid;vat_rent uuid;vat_purchase uuid;other_bu uuid;other_c uuid;old_bu uuid;member uuid;reversal uuid;request_id uuid:=gen_random_uuid();st text;v numeric;payload jsonb;
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




 INSERT INTO public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
 VALUES(c,b,'OTHER-QA','Second ledger scope branch','branch',true) RETURNING id INTO branch2;
 INSERT INTO public.operating_location_memberships(company_id,business_unit_id,operating_location_id,user_id,role,is_active)
 VALUES(c,b,branch2,u,'company_owner',true);
 FOR branch_index IN 1..4 LOOP
  target_loc:=CASE WHEN branch_index=2 THEN branch2 ELSE loc END;
  test_amount:=CASE branch_index WHEN 1 THEN 10 WHEN 2 THEN 20 WHEN 3 THEN 5 ELSE 3 END;
  test_date:=CASE branch_index WHEN 1 THEN current_date WHEN 2 THEN current_date-1 WHEN 3 THEN current_date-2 ELSE current_date+1 END;
  UPDATE public.user_profiles SET locked_operating_location_id=target_loc WHERE id=u;
  INSERT INTO public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type,source_module)
  VALUES(u,c,b,target_loc,'BR-QA-'||code||'-'||branch_index,test_date,'Branch scope rehearsal','draft','General','accounting') RETURNING id INTO j;
  INSERT INTO public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name)
  SELECT u,c,b,target_loc,j,ar,name,test_amount,0,'customer',customer,'Service Customer' FROM public.chart_of_accounts WHERE id=ar;
  INSERT INTO public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit)
  SELECT u,c,b,target_loc,j,cash_id,name,0,test_amount FROM public.chart_of_accounts WHERE id=cash_id;
  IF branch_index=4 THEN PERFORM set_config('app.maintenance_reset','1',true);END IF;
  SET LOCAL ROLE authenticated;
  result:=public.post_journal_entry(j);
  RESET ROLE;
  PERFORM set_config('app.maintenance_reset','0',true);
  IF EXISTS(SELECT 1 FROM public.ledgers WHERE journal_entry_id=j AND operating_location_id IS DISTINCT FROM target_loc)
  OR EXISTS(SELECT 1 FROM public.party_ledgers WHERE journal_entry_id=j AND operating_location_id IS DISTINCT FROM target_loc) THEN
   RAISE EXCEPTION 'Canonical journal branch was not copied to GL/party ledgers';END IF;
 END LOOP;
 IF (SELECT balance FROM public.party_ledgers WHERE company_id=c AND operating_location_id=branch2 AND party_id=customer)<>20
 OR (SELECT balance FROM public.party_ledgers WHERE company_id=c AND operating_location_id=loc AND party_id=customer ORDER BY entry_date DESC,created_at DESC,id DESC LIMIT 1)<>18
 OR (SELECT sum(debit-credit) FROM public.party_ledgers WHERE company_id=c AND party_id=customer)<>38 THEN
  RAISE EXCEPTION 'Backdated party balances leaked across branches';END IF;
 SET LOCAL ROLE authenticated;
 rejected:=false;BEGIN
  UPDATE public.party_ledgers SET balance=999 WHERE company_id=c AND operating_location_id=branch2 AND party_id=customer;
  GET DIAGNOSTICS changed_count=ROW_COUNT;rejected:=changed_count=0;
 EXCEPTION WHEN OTHERS THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Cross-branch write guard was weakened';END IF;
 RESET ROLE;
 RAISE NOTICE 'PASS canonical GL/party source branch, backdated branch balances and cross-branch write protection';
END $$;
ROLLBACK;
