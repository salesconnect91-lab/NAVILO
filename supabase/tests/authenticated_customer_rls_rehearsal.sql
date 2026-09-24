BEGIN;

DO $$
DECLARE
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_company_a uuid;
  v_company_b uuid;
  v_bu_a uuid;
  v_visible_a int;
  v_visible_b int;
BEGIN
  INSERT INTO auth.users(id,role,email,created_at,updated_at)
  VALUES
    (v_user_a,'authenticated','rls-a@navilo.test',now(),now()),
    (v_user_b,'authenticated','rls-b@navilo.test',now(),now());

  INSERT INTO public.user_profiles(id,user_id,email,role,platform_role,is_active)
  VALUES
    (v_user_a,v_user_a,'rls-a@navilo.test','sales','user',true),
    (v_user_b,v_user_b,'rls-b@navilo.test','sales','user',true);

  INSERT INTO public.companies(name,code,status)
  VALUES ('RLS Company A','RLSA_'||substr(replace(gen_random_uuid()::text,'-',''),1,8),'active')
  RETURNING id INTO v_company_a;

  INSERT INTO public.companies(name,code,status)
  VALUES ('RLS Company B','RLSB_'||substr(replace(gen_random_uuid()::text,'-',''),1,8),'active')
  RETURNING id INTO v_company_b;

  SELECT id INTO v_bu_a FROM public.business_units
  WHERE company_id=v_company_a AND is_default;

  INSERT INTO public.company_memberships(company_id,user_id,role,is_active)
  VALUES
    (v_company_a,v_user_a,'sales',true),
    (v_company_b,v_user_b,'sales',true);

  INSERT INTO public.business_unit_modules(business_unit_id,company_id,module_key,enabled)
  VALUES (v_bu_a,v_company_a,'master',true);

  UPDATE public.user_profiles
  SET last_company_id=v_company_a,last_business_unit_id=v_bu_a
  WHERE id=v_user_a;

  PERFORM set_config('request.jwt.claim.sub',v_user_a::text,true);

  INSERT INTO public.customers(user_id,name,company_id)
  VALUES (v_user_a,'RLS Customer A',v_company_a);

  PERFORM set_config('request.jwt.claim.sub',v_user_b::text,true);
  INSERT INTO public.customers(user_id,name,company_id)
  VALUES (v_user_b,'RLS Customer B',v_company_b);

  PERFORM set_config('request.jwt.claim.sub',v_user_a::text,true);

  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_visible_a FROM public.customers
  WHERE company_id=v_company_a AND name='RLS Customer A';

  SELECT count(*) INTO v_visible_b FROM public.customers
  WHERE company_id=v_company_b AND name='RLS Customer B';

  IF v_visible_a <> 1 THEN
    RAISE EXCEPTION 'RLS FAILURE: own-company customer not visible';
  END IF;

  IF v_visible_b <> 0 THEN
    RAISE EXCEPTION 'SECURITY FAILURE: cross-company customer visible';
  END IF;

  RAISE NOTICE 'PASS: authenticated customer RLS isolation verified';
END $$;

ROLLBACK;
