CREATE TABLE IF NOT EXISTS public.company_permanent_delete_grants (company_id uuid NOT NULL REFERENCES public.companies(id),user_id uuid NOT NULL REFERENCES auth.users(id),allowed boolean NOT NULL DEFAULT false,granted_by uuid,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(company_id,user_id));
ALTER TABLE public.company_permanent_delete_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_permanent_delete_grants FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.company_can_permanently_delete() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
SELECT auth.uid() IS NOT NULL AND public.current_company_id() IS NOT NULL AND public.current_business_unit_id() IS NOT NULL
AND EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=public.current_company_id() AND m.user_id=auth.uid() AND m.is_active)
AND (EXISTS (SELECT 1 FROM public.company_memberships m WHERE m.company_id=public.current_company_id() AND m.user_id=auth.uid() AND m.is_active AND m.role IN ('owner','company_owner'))
OR EXISTS (SELECT 1 FROM public.company_permanent_delete_grants g WHERE g.company_id=public.current_company_id() AND g.user_id=auth.uid() AND g.allowed));
$$;
REVOKE ALL ON FUNCTION public.company_can_permanently_delete() FROM public,anon;
GRANT EXECUTE ON FUNCTION public.company_can_permanently_delete() TO authenticated;
CREATE OR REPLACE FUNCTION public.company_delegate_permanent_delete(p_user_id uuid,p_allowed boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE v_company uuid:=public.current_company_id();
BEGIN
IF auth.uid() IS NULL OR v_company IS NULL OR NOT EXISTS(SELECT 1 FROM public.company_memberships WHERE company_id=v_company AND user_id=auth.uid() AND is_active AND role IN ('owner','company_owner')) THEN RAISE EXCEPTION 'Company owner permission required'; END IF;
IF NOT EXISTS(SELECT 1 FROM public.company_memberships WHERE company_id=v_company AND user_id=p_user_id AND is_active) THEN RAISE EXCEPTION 'Target user is not an active member of this company'; END IF;
INSERT INTO public.company_permanent_delete_grants(company_id,user_id,allowed,granted_by,updated_at) VALUES(v_company,p_user_id,p_allowed,auth.uid(),now())
ON CONFLICT(company_id,user_id) DO UPDATE SET allowed=excluded.allowed,granted_by=excluded.granted_by,updated_at=excluded.updated_at;
RETURN true;
END;$$;
REVOKE ALL ON FUNCTION public.company_delegate_permanent_delete(uuid,boolean) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.company_delegate_permanent_delete(uuid,boolean) TO authenticated;