CREATE OR REPLACE FUNCTION public.platform_remove_dedicated_workspace_login(
  p_company_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membership public.company_memberships%ROWTYPE;
  v_profile public.user_profiles%ROWTYPE;
  v_active_owner_count integer;
BEGIN
  SELECT *
    INTO v_membership
    FROM public.company_memberships
   WHERE company_id = p_company_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company user assignment not found.';
  END IF;

  SELECT *
    INTO v_profile
    FROM public.user_profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND OR v_profile.locked_business_unit_id IS NULL THEN
    RAISE EXCEPTION 'User is not a dedicated Business / Branch login.';
  END IF;

  -- A dedicated lock is global on user_profiles, so it must belong to the
  -- company whose membership is being removed.
  IF NOT EXISTS (
    SELECT 1
      FROM public.business_units bu
     WHERE bu.id = v_profile.locked_business_unit_id
       AND bu.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Dedicated workspace login scope does not belong to the requested company.';
  END IF;

  IF v_profile.locked_operating_location_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.operating_locations ol
        WHERE ol.id = v_profile.locked_operating_location_id
          AND ol.company_id = p_company_id
          AND ol.business_unit_id = v_profile.locked_business_unit_id
     )
  THEN
    RAISE EXCEPTION 'Dedicated workspace login branch scope does not match the requested company and business unit.';
  END IF;

  IF v_membership.role = 'company_owner' AND v_membership.is_active THEN
    SELECT count(*)
      INTO v_active_owner_count
      FROM public.company_memberships
     WHERE company_id = p_company_id
       AND role = 'company_owner'
       AND is_active = true;

    IF v_active_owner_count <= 1 THEN
      RAISE EXCEPTION 'Assign another active Company Owner before removing the last active owner.';
    END IF;
  END IF;

  DELETE FROM public.operating_location_memberships
   WHERE company_id = p_company_id
     AND user_id = p_user_id;

  DELETE FROM public.business_unit_memberships
   WHERE company_id = p_company_id
     AND user_id = p_user_id;

  DELETE FROM public.company_memberships
   WHERE company_id = p_company_id
     AND user_id = p_user_id;

  -- Preserve the global Auth login/profile. Clear company-specific lock/context
  -- only when the profile still points at this removed company.
  UPDATE public.user_profiles
     SET locked_business_unit_id = NULL,
         locked_operating_location_id = NULL,
         last_business_unit_id = CASE WHEN last_company_id = p_company_id THEN NULL ELSE last_business_unit_id END,
         last_company_id = CASE WHEN last_company_id = p_company_id THEN NULL ELSE last_company_id END,
         updated_at = now()
   WHERE id = p_user_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_remove_dedicated_workspace_login(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_remove_dedicated_workspace_login(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.platform_remove_dedicated_workspace_login(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.platform_remove_dedicated_workspace_login(uuid, uuid) TO service_role;

