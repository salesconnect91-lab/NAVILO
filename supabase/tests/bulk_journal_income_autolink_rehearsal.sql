-- Isolated PostgreSQL only. Roll back every synthetic company, account and draft.
-- General Journal does not accept Vehicle No dimensions; vehicle-linked income accounts
-- require their dedicated transport workflow, while shared GL lines remain ordinary drafts.
BEGIN;
DO $test$
DECLARE
 u uuid:=gen_random_uuid(); c uuid; b uuid; loc uuid; tt uuid;
 v1 uuid; v2 uuid; cash uuid; expense uuid; income uuid; shared_revenue uuid;
 id1 uuid; id2 uuid; result jsonb; bad boolean:=false;
 code text:=substr(replace(gen_random_uuid()::text,'-',''),1,10);
BEGIN
 INSERT INTO auth.users(id,role,email,created_at,updated_at)
 VALUES(u,'authenticated','bulk-journal-policy-'||code||'@navilo.test',now(),now());
 INSERT INTO public.user_profiles(id,user_id,email,role,platform_role,is_active)
 VALUES(u,u,'bulk-journal-policy-'||code||'@navilo.test','admin','user',true);
 INSERT INTO public.companies(name,code,status)
 VALUES('Vehicle journal bulk policy rehearsal','BP'||code,'active') RETURNING id INTO c;
 SELECT id INTO STRICT b FROM public.business_units WHERE company_id=c AND is_default;
 UPDATE public.business_units SET unit_type='transport' WHERE id=b;
 INSERT INTO public.company_memberships(company_id,user_id,role,is_active) VALUES(c,u,'company_owner',true);
 INSERT INTO public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
 VALUES(c,b,u,'company_owner',true) ON CONFLICT(business_unit_id,user_id) DO UPDATE SET is_active=true;
 INSERT INTO public.business_unit_modules(company_id,business_unit_id,module_key,enabled)
 VALUES(c,b,'accounting',true),(c,b,'transport',true),(c,b,'settings',true)
 ON CONFLICT(business_unit_id,module_key) DO UPDATE SET enabled=true;
 INSERT INTO public.platform_features(feature_key,module_key,label,category,supported_actions,default_enabled,core_locked,is_active,source)
 VALUES('journal','accounting','Journal Entries','transaction',array['view','create','edit','post','delete','print','export']::text[],true,false,true,'test')
 ON CONFLICT(feature_key) DO UPDATE SET supported_actions=excluded.supported_actions,default_enabled=true,is_active=true;
 INSERT INTO public.company_feature_entitlements(company_id,feature_key,enabled,action_overrides)
 VALUES(c,'journal',true,'{}'::jsonb) ON CONFLICT(company_id,feature_key) DO UPDATE SET enabled=true;
 INSERT INTO public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
 VALUES(c,b,'HO','Head Office','branch',true) RETURNING id INTO loc;
 INSERT INTO public.operating_location_memberships(company_id,business_unit_id,operating_location_id,user_id,role,is_active)
 VALUES(c,b,loc,u,'company_owner',true);
 UPDATE public.user_profiles SET last_company_id=c,last_business_unit_id=b WHERE id=u;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 INSERT INTO public.company_settings(user_id,company_id,company_name) VALUES(u,c,'Vehicle journal bulk policy rehearsal');
 PERFORM public.initialize_default_coa();
 SELECT account_id INTO STRICT cash FROM public.account_mappings WHERE company_id=c AND mapping_key='cash';
 SELECT account_id INTO STRICT shared_revenue FROM public.account_mappings WHERE company_id=c AND mapping_key='service_revenue';
 SELECT id INTO STRICT expense FROM public.chart_of_accounts WHERE company_id=c AND type='expense' AND is_active AND NOT is_group LIMIT 1;
 INSERT INTO public.chart_of_accounts(user_id,company_id,code,name,type,normal_balance,detail_type,is_active,is_group,allow_manual_entries)
 VALUES(u,c,'POL-V-'||code,'Dedicated Vehicle Income '||code,'revenue','credit','service_income',true,false,true) RETURNING id INTO income;
 INSERT INTO public.transport_truck_types(company_id,business_unit_id,name) VALUES(c,b,'Bulk Vehicle') RETURNING id INTO tt;
 v1:=public.transport_create_vehicle_master('BV-A-'||code,tt,'company',null,current_date-1);
 v2:=public.transport_create_vehicle_master('BV-B-'||code,tt,'company',null,current_date-1);
 UPDATE public.transport_vehicles SET revenue_account_id=income WHERE id=v1;

 -- General Journal can use a valid Income GL, but must not add a Vehicle dimension.
 result:=public.bulk_load_journal_entries(jsonb_build_array(jsonb_build_object(
  'entry_no','BULK-DEDICATED-'||code,'entry_date',current_date::text,'description','Dedicated vehicle income GL',
  'lines',jsonb_build_array(
   jsonb_build_object('account_name','Dedicated Vehicle Income '||code,'line_description','Vehicle income','debit',0,'credit',500),
   jsonb_build_object('account_name',(SELECT name FROM public.chart_of_accounts WHERE id=cash),'line_description','Cash received','debit',500,'credit',0)
  )
 )));
 id1:=(result->'entries'->0->>'id')::uuid;
 IF (SELECT count(*) FROM public.journal_lines WHERE entry_id=id1)<>2
 OR EXISTS(SELECT 1 FROM public.journal_lines WHERE entry_id=id1 AND transport_vehicle_id IS NOT NULL)
 OR (SELECT status FROM public.journal_entries WHERE id=id1)<>'draft'
 THEN RAISE EXCEPTION 'General Journal added Vehicle dimension or auto-posted'; END IF;

 -- Shared revenue GL remains unchanged and creates a draft only, with no vehicle dimension.
 result:=public.bulk_load_journal_entries(jsonb_build_array(jsonb_build_object(
  'entry_no','BULK-SHARED-'||code,'entry_date',current_date::text,'description','Shared Revenue journal',
  'lines',jsonb_build_array(
   jsonb_build_object('account_name',(SELECT name FROM public.chart_of_accounts WHERE id=shared_revenue),'line_description','Service revenue','debit',0,'credit',75),
   jsonb_build_object('account_name',(SELECT name FROM public.chart_of_accounts WHERE id=cash),'line_description','Cash received','debit',75,'credit',0)
  )
 )));
 id1:=(result->'entries'->0->>'id')::uuid;
 IF (SELECT count(*) FROM public.journal_lines WHERE entry_id=id1)<>2
 OR EXISTS(SELECT 1 FROM public.journal_lines WHERE entry_id=id1 AND transport_vehicle_id IS NOT NULL)
 OR (SELECT status FROM public.journal_entries WHERE id=id1)<>'draft'
 THEN RAISE EXCEPTION 'Shared GL import created extra lines, vehicle dimensions or auto-posted'; END IF;

 -- Vehicle No is not accepted on General Journal lines; reject the entire draft atomically.
 bad:=false;
 BEGIN
  PERFORM public.bulk_load_journal_entries(jsonb_build_array(jsonb_build_object(
   'entry_no','BULK-VEHICLE-NO-'||code,'entry_date',current_date::text,'description','Vehicle must use its source workflow',
   'lines',jsonb_build_array(
    jsonb_build_object('account_name',(SELECT name FROM public.chart_of_accounts WHERE id=expense),'vehicle_no','BV-A-'||code,'line_description','Repair','debit',100,'credit',0),
    jsonb_build_object('account_name',(SELECT name FROM public.chart_of_accounts WHERE id=cash),'line_description','Cash paid','debit',0,'credit',100)
   )
  )));
 EXCEPTION WHEN OTHERS THEN bad:=true;
 END;
 IF NOT bad OR EXISTS(SELECT 1 FROM public.journal_entries WHERE company_id=c AND entry_no='BULK-VEHICLE-NO-'||code)
 THEN RAISE EXCEPTION 'General Journal accepted Vehicle No dimension'; END IF;

 IF EXISTS(SELECT 1 FROM public.ledgers WHERE company_id=c)
 THEN RAISE EXCEPTION 'Draft imported unexpected posted ledger entries'; END IF;
 RAISE NOTICE 'PASS bulk Journal policy: dedicated vehicle Income and Vehicle No stay out of General Journal, shared GL imports remain balanced drafts only';
END $test$;
ROLLBACK;
