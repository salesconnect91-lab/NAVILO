-- Isolated Postgres only. Ensure Company Vehicle Income account setup is
-- explicitly tenant-authorized, atomic, idempotent and never posts a journal.
BEGIN;
DO $$
DECLARE
 u uuid:=gen_random_uuid();
 code text:=substr(replace(gen_random_uuid()::text,'-',''),1,10);
 c uuid;b uuid;loc uuid;
 va uuid;vb uuid;shared uuid;
 result jsonb;first_count integer;new_count integer;
BEGIN
 INSERT INTO auth.users(id,role,email,created_at,updated_at)
 VALUES(u,'authenticated','pl-vehicles-'||code||'@navilo.test',now(),now());
 INSERT INTO public.user_profiles(id,user_id,email,role,platform_role,is_active)
 VALUES(u,u,'pl-vehicles-'||code||'@navilo.test','admin','user',true);
 INSERT INTO public.companies(name,code,status) VALUES('P&L Vehicle setup', 'VS'||code,'active') RETURNING id INTO c;
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
 SELECT account_id INTO shared FROM public.account_mappings WHERE company_id=c AND mapping_key='service_revenue';
 IF shared IS NULL THEN RAISE EXCEPTION 'Service Revenue mapping missing'; END IF;
 INSERT INTO public.transport_vehicles(company_id,business_unit_id,vehicle_no,ownership_type,revenue_account_id)
 VALUES(c,b,'INCOME-A-'||code,'company',shared) RETURNING id INTO va;
 INSERT INTO public.transport_vehicles(company_id,business_unit_id,vehicle_no,ownership_type,revenue_account_id)
 VALUES(c,b,'INCOME-B-'||code,'company',shared) RETURNING id INTO vb;
 SELECT count(*) INTO first_count FROM public.journal_entries WHERE company_id=c;
 result:=public.accounting_setup_company_vehicle_income_accounts();
 IF (result->>'linked')::int<>2 OR jsonb_array_length(result->'vehicles')<>2 THEN
  RAISE EXCEPTION 'Expected two vehicle income links, got %',result;
 END IF;
 IF (SELECT count(DISTINCT revenue_account_id) FROM public.transport_vehicles WHERE id IN (va,vb))<>2
 OR EXISTS(SELECT 1 FROM public.transport_vehicles WHERE id IN (va,vb) AND revenue_account_id=shared)
 OR (SELECT count(*) FROM public.chart_of_accounts
    WHERE company_id=c AND type='revenue' AND is_active AND NOT is_group AND code LIKE 'VREV-%')<>2
 THEN RAISE EXCEPTION 'Vehicle income setup did not create exactly two dedicated Revenue accounts';END IF;
 result:=public.accounting_setup_company_vehicle_income_accounts();
 IF (result->>'linked')::int<>0 THEN RAISE EXCEPTION 'Repeat setup changed links or created duplicate accounts';END IF;
 SELECT count(*) INTO new_count FROM public.journal_entries WHERE company_id=c;
 IF first_count<>new_count THEN RAISE EXCEPTION 'Setup unexpectedly posted financial journal';END IF;
 IF has_function_privilege('anon','public.accounting_setup_company_vehicle_income_accounts()','EXECUTE')
 THEN RAISE EXCEPTION 'Unauthenticated user can call COA setup';END IF;
 RAISE NOTICE 'PASS: vehicle income setup makes 2 dedicated GL links; repeat is no-op; no journal posted';
END $$;
ROLLBACK;