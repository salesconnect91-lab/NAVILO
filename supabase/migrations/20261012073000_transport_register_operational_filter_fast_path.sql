-- Optimize operational filter choices, preserving current historical import
-- mappings, financial ledger expressions, permissions and all other query paths.
DO $guard$
DECLARE d text;
BEGIN
 SELECT md5(pg_get_functiondef(oid)) INTO d FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='transport_register_query';
 IF d IS DISTINCT FROM '9fc2c90cb4477626756322bf5bb5ed9d' THEN RAISE EXCEPTION 'Concurrent transport_register_query change; rebase required'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.transport_register_query(p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT ''::text, p_direction text DEFAULT 'asc'::text, p_option_key text DEFAULT NULL::text, p_option_search text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;needs_cells boolean;cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view')
 then raise exception 'Transport view permission and active Company/Business Unit required';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p¶»§q«^