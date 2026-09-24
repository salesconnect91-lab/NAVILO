BEGIN;

DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_company uuid;
  v_bu uuid;
  v_loc uuid;
  v_rows int;
BEGIN
  INSERT INTO auth.users(id,role,email,created_at,updated_at)
  VALUES (v_user,'authenticated','rpc-accounting@navilo.test',now(),now());

  INSERT INTO public.user_profiles(id,user_id,email,role,platform_role,is_active)
  VALUES (v_user,v_user,'rpc-accounting@navilo.test','accountant','user',true);

  INSERT INTO public.companies(name,code,status)
  VALUES ('RPC Accounting Company','RPCA_'||substr(replace(gen_random_uuid()::text,'-',''),1,8),'active')
  RETURNING id INTO v_company;

  SELECT id INTO v_bu
  FROM public.business_units
  WHERE company_id=v_company AND is_default;

  INSERT INTO public.company_memberships(company_id,user_id,role,is_active)
  VALUES (v_company,v_user,'accounts',true);

  INSERT INTO public.business_unit_modules(business_unit_id,company_id,module_key,enabled)
  VALUES (v_bu,v_company,'accounting',true);

  INSERT INTO public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
  VALUES (v_company,v_bu,'RPC-BR','RPC Branch','branch',true)
  RETURNING id INTO v_loc;

  INSERT INTO public.operating_location_memberships
    (company_id,business_unit_id,operating_location_id,user_id,role,is_active)
  VALUES (v_company,v_bu,v_loc,v_user,'accountant',true);

  UPDATE public.user_profiles
  SET last_company_id=v_company,last_business_unit_id=v_bu
  WHERE id=v_user;

  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_rows
  FROM public.get_accounting_integrity_summary();

  IF v_rows <> 3 THEN
    RAISE EXCEPTION 'RPC FAILURE: expected 3 integrity rows, got %',v_rows;
  END IF;

  RESET ROLE;
  UPDATE public.business_unit_modules
  SET enabled=false
  WHERE business_unit_id=v_bu AND module_key='accounting';

  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM * FROM public.get_accounting_integrity_summary();
    RAISE EXCEPTION 'SECURITY FAILURE: accounting RPC allowed with disabled BU module';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'SECURITY FAILURE: accounting RPC allowed with disabled BU module' THEN
        RAISE;
      END IF;
      IF position('Accounting view permission required.' in SQLERRM)=0 THEN
        RAISE;
      END IF;
  END;

  RAISE NOTICE 'PASS: direct accounting RPC authorization verified';
END $$;

ROLLBACK;