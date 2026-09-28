\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_code text := substr(replace(gen_random_uuid()::text,'-',''),1,10);
  v_company_a uuid;
  v_company_b uuid;
  v_bu_a uuid;
  v_bu_b uuid;
  v_loc_a uuid;

  v_user_remove uuid := gen_random_uuid();
  v_user_last_owner uuid := gen_random_uuid();
  v_user_second_owner uuid := gen_random_uuid();
  v_user_normal uuid := gen_random_uuid();
  v_user_cross uuid := gen_random_uuid();

  v_rejected boolean;
BEGIN
  -- Synthetic Auth users: use the same minimal pattern as existing NAVILO rehearsals.
  INSERT INTO auth.users(id,role,email,created_at,updated_at)
  VALUES
    (v_user_remove,'authenticated','ded-remove-'||v_code||'@navilo.test',now(),now()),
    (v_user_last_owner,'authenticated','ded-owner-'||v_code||'@navilo.test',now(),now()),
    (v_user_second_owner,'authenticated','ded-owner2-'||v_code||'@navilo.test',now(),now()),
    (v_user_normal,'authenticated','ded-normal-'||v_code||'@navilo.test',now(),now()),
    (v_user_cross,'authenticated','ded-cross-'||v_code||'@navilo.test',now(),now());

  INSERT INTO public.user_profiles(id,user_id,email,role,platform_role,is_active)
  VALUES
    (v_user_remove,v_user_remove,'ded-remove-'||v_code||'@navilo.test','viewer','user',true),
    (v_user_last_owner,v_user_last_owner,'ded-owner-'||v_code||'@navilo.test','company_owner','user',true),
    (v_user_second_owner,v_user_second_owner,'ded-owner2-'||v_code||'@navilo.test','company_owner','user',true),
    (v_user_normal,v_user_normal,'ded-normal-'||v_code||'@navilo.test','viewer','user',true),
    (v_user_cross,v_user_cross,'ded-cross-'||v_code||'@navilo.test','viewer','user',true);

  INSERT INTO public.companies(name,code,status)
  VALUES ('Dedicated Rehearsal A','DRA'||v_code,'active')
  RETURNING id INTO v_company_a;

  INSERT INTO public.companies(name,code,status)
  VALUES ('Dedicated Rehearsal B','DRB'||v_code,'active')
  RETURNING id INTO v_company_b;

  SELECT id INTO STRICT v_bu_a
    FROM public.business_units
   WHERE company_id=v_company_a AND is_default;

  SELECT id INTO STRICT v_bu_b
    FROM public.business_units
   WHERE company_id=v_company_b AND is_default;

  INSERT INTO public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
  VALUES(v_company_a,v_bu_a,'DRA-BR-'||v_code,'Dedicated rehearsal branch','branch',true)
  RETURNING id INTO v_loc_a;

  ---------------------------------------------------------------------------
  -- 1. Normal dedicated non-owner removal.
  ---------------------------------------------------------------------------
  INSERT INTO public.company_memberships(company_id,user_id,role,is_active)
  VALUES(v_company_a,v_user_remove,'viewer',true);

  INSERT INTO public.operating_location_memberships
    (company_id,business_unit_id,operating_location_id,user_id,role,is_active)
  VALUES(v_company_a,v_bu_a,v_loc_a,v_user_remove,'viewer',true);

  UPDATE public.user_profiles
     SET last_company_id=v_company_a,
         last_business_unit_id=v_bu_a,
         locked_business_unit_id=v_bu_a,
         locked_operating_location_id=v_loc_a
   WHERE id=v_user_remove;

  IF NOT public.platform_remove_dedicated_workspace_login(v_company_a,v_user_remove) THEN
    RAISE EXCEPTION 'Dedicated removal did not return true';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.company_memberships
     WHERE company_id=v_company_a AND user_id=v_user_remove
  ) THEN
    RAISE EXCEPTION 'Company membership survived dedicated removal';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.business_unit_memberships
     WHERE company_id=v_company_a AND user_id=v_user_remove
  ) THEN
    RAISE EXCEPTION 'Business-unit membership survived dedicated removal';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.operating_location_memberships
     WHERE company_id=v_company_a AND user_id=v_user_remove
  ) THEN
    RAISE EXCEPTION 'Operating-location membership survived dedicated removal';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=v_user_remove) THEN
    RAISE EXCEPTION 'Global Auth user was deleted';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id=v_user_remove) THEN
    RAISE EXCEPTION 'Global user profile was deleted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_profiles
     WHERE id=v_user_remove
       AND (
         locked_business_unit_id IS NOT NULL OR
         locked_operating_location_id IS NOT NULL OR
         last_company_id IS NOT NULL OR
         last_business_unit_id IS NOT NULL
       )
  ) THEN
    RAISE EXCEPTION 'Dedicated lock/context was not cleared';
  END IF;

  ---------------------------------------------------------------------------
  -- 2. Last active owner must be blocked with no partial cleanup.
  ---------------------------------------------------------------------------
  INSERT INTO public.company_memberships(company_id,user_id,role,is_active)
  VALUES(v_company_a,v_user_last_owner,'company_owner',true);

  UPDATE public.user_profiles
     SET last_company_id=v_company_a,
         last_business_unit_id=v_bu_a,
         locked_business_unit_id=v_bu_a
   WHERE id=v_user_last_owner;

  v_rejected := false;
  BEGIN
    PERFORM public.platform_remove_dedicated_workspace_login(v_company_a,v_user_last_owner);
  EXCEPTION WHEN OTHERS THEN
    IF position('Assign another active Company Owner' in SQLERRM) > 0 THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Last active owner removal was not blocked';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.company_memberships
     WHERE company_id=v_company_a AND user_id=v_user_last_owner
  ) THEN
    RAISE EXCEPTION 'Last-owner rejection partially deleted company membership';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_unit_memberships
     WHERE company_id=v_company_a AND user_id=v_user_last_owner
  ) THEN
    RAISE EXCEPTION 'Last-owner rejection partially deleted BU membership';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
     WHERE id=v_user_last_owner AND locked_business_unit_id=v_bu_a
  ) THEN
    RAISE EXCEPTION 'Last-owner rejection changed profile lock';
  END IF;

  ---------------------------------------------------------------------------
  -- 3. With a second active owner, removal becomes legal.
  ---------------------------------------------------------------------------
  INSERT INTO public.company_memberships(company_id,user_id,role,is_active)
  VALUES(v_company_a,v_user_second_owner,'company_owner',true);

  PERFORM public.platform_remove_dedicated_workspace_login(v_company_a,v_user_last_owner);

  IF EXISTS (
    SELECT 1 FROM public.company_memberships
     WHERE company_id=v_company_a AND user_id=v_user_last_owner
  ) THEN
    RAISE EXCEPTION 'Dedicated owner remained after second owner existed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.company_memberships
     WHERE company_id=v_company_a
       AND user_id=v_user_second_owner
       AND role='company_owner'
       AND is_active=true
  ) THEN
    RAISE EXCEPTION 'Second active owner was unexpectedly changed';
  END IF;

  ---------------------------------------------------------------------------
  -- 4. Ordinary non-dedicated company user must be rejected.
  ---------------------------------------------------------------------------
  INSERT INTO public.company_memberships(company_id,user_id,role,is_active)
  VALUES(v_company_a,v_user_normal,'viewer',true);

  UPDATE public.user_profiles
     SET last_company_id=v_company_a,
         last_business_unit_id=NULL,
         locked_business_unit_id=NULL,
         locked_operating_location_id=NULL
   WHERE id=v_user_normal;

  v_rejected := false;
  BEGIN
    PERFORM public.platform_remove_dedicated_workspace_login(v_company_a,v_user_normal);
  EXCEPTION WHEN OTHERS THEN
    IF position('not a dedicated Business / Branch login' in SQLERRM) > 0 THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Non-dedicated user removal was not rejected';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.company_memberships
     WHERE company_id=v_company_a AND user_id=v_user_normal
  ) THEN
    RAISE EXCEPTION 'Non-dedicated rejection partially deleted membership';
  END IF;

  ---------------------------------------------------------------------------
  -- 5. Cross-company global lock mismatch must be rejected atomically.
  ---------------------------------------------------------------------------
  INSERT INTO public.company_memberships(company_id,user_id,role,is_active)
  VALUES
    (v_company_a,v_user_cross,'viewer',true),
    (v_company_b,v_user_cross,'viewer',true);

  UPDATE public.user_profiles
     SET last_company_id=v_company_b,
         last_business_unit_id=v_bu_b,
         locked_business_unit_id=v_bu_b,
         locked_operating_location_id=NULL
   WHERE id=v_user_cross;

  v_rejected := false;
  BEGIN
    PERFORM public.platform_remove_dedicated_workspace_login(v_company_a,v_user_cross);
  EXCEPTION WHEN OTHERS THEN
    IF position('scope does not belong to the requested company' in SQLERRM) > 0 THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Cross-company lock mismatch was not rejected';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.company_memberships
     WHERE company_id=v_company_a AND user_id=v_user_cross
  ) THEN
    RAISE EXCEPTION 'Cross-company rejection partially deleted requested-company membership';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.company_memberships
     WHERE company_id=v_company_b AND user_id=v_user_cross
  ) THEN
    RAISE EXCEPTION 'Cross-company rejection damaged other-company membership';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
     WHERE id=v_user_cross
       AND locked_business_unit_id=v_bu_b
       AND last_company_id=v_company_b
       AND last_business_unit_id=v_bu_b
  ) THEN
    RAISE EXCEPTION 'Cross-company rejection changed the other-company profile lock/context';
  END IF;

  RAISE NOTICE 'PASS: dedicated workspace login transactional behavior';
END
$$;

DO $$
BEGIN
  IF has_function_privilege('anon',
       'public.platform_remove_dedicated_workspace_login(uuid,uuid)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute dedicated removal RPC';
  END IF;

  IF has_function_privilege('authenticated',
       'public.platform_remove_dedicated_workspace_login(uuid,uuid)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not execute dedicated removal RPC';
  END IF;

  IF NOT has_function_privilege('service_role',
       'public.platform_remove_dedicated_workspace_login(uuid,uuid)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute dedicated removal RPC';
  END IF;

  RAISE NOTICE 'PASS: dedicated workspace login RPC privileges';
END
$$;

ROLLBACK;
