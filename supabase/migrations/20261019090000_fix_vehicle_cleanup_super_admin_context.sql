-- Correct cleanup auth to match NAVILO's Platform Super Admin access policy.
-- Still requires server-side Twakkal company/BU context and original master/edit permissions.
DO $assert$
BEGIN
 IF (SELECT md5(pg_get_functiondef(p.oid))
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='transport_retire_unused_vehicle_income_coas')
     IS DISTINCT FROM 'f150c2c5f9c606057be7f151d9b4790c'
 THEN RAISE EXCEPTION 'Cleanup function changed since audit: migration cancelled'; END IF;
END $assert$;

CREATE OR REPLACE FUNCTION public.transport_retire_unused_vehicle_income_coas()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  target_company constant uuid := 'c611adca-fd2f-4cc1-b379-3aed22924f65';
  target_bu constant uuid := 'bbd67d8b-930e-4ef4-8f61-0061f07b686a';
  account_ids uuid[];
  matched integer;
  affected integer;
  dep record;
  referenced boolean;
BEGIN
  -- Super Admin is a company-owner-equivalent in NAVILO access context.
  -- The company and BU still must match the authenticated server session.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in again before retiring legacy accounts';
  END IF;
  IF public.current_company_id() IS DISTINCT FROM target_company
    OR public.current_business_unit_id() IS DISTINCT FROM target_bu THEN
    RAISE EXCEPTION 'Active workspace changed. Re-select Twakkal Al Khaleej and Twakkal Transport, then retry';
  END IF;
  IF NOT public.is_platform_owner()
    AND NOT EXISTS (SELECT 1 FROM public.company_memberships m
      WHERE m.company_id=target_company AND m.user_id=auth.uid()
        AND m.role='company_owner' AND m.is_active) THEN
    RAISE EXCEPTION 'Only a Twakkal company owner or NAVILO Platform Super Admin may retire these accounts';
  END IF;
  IF NOT public.has_transport_action_permission(target_company,'master_manage')
    OR NOT public.has_module_permission(target_company,'accounting','edit') THEN
    RAISE EXCEPTION 'Transport master and Accounting edit permissions are required for legacy cleanup';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('navilo:retire:twakkal:vehicle-income',0));
  -- Lock both master records and accounts; only exact generated unused GLs qualify.
  SELECT array_agg(x.account_id ORDER BY x.account_id),count(*)
  INTO account_ids,matched
  FROM (
    SELECT a.id AS account_id
    FROM public.transport_vehicles v
    JOIN public.chart_of_accounts a ON a.id=v.revenue_account_id
    WHERE v.company_id=target_company AND v.business_unit_id=target_bu
      AND a.company_id=target_company AND a.type='revenue'
      AND a.is_active AND NOT a.is_group
      AND a.code='VREV-'||replace(v.id::text,'-','')
      AND a.name='Vehicle '||v.vehicle_no||' Income'
    FOR UPDATE OF v,a
  ) AS x;

  IF matched<>6 THEN
    RAISE EXCEPTION 'Expected six intact generated Vehicle Income GL mappings, found %; no changes made',matched;
  END IF;
  IF EXISTS(SELECT 1 FROM public.chart_of_accounts a WHERE a.parent_id=ANY(account_ids))
     OR EXISTS(SELECT 1 FROM public.transport_vehicles v
        WHERE v.revenue_account_id=ANY(account_ids) AND
              (v.company_id<>target_company OR v.business_unit_id<>target_bu))
     OR (SELECT count(*) FROM public.transport_vehicles v
         WHERE v.revenue_account_id=ANY(account_ids))<>6
  THEN RAISE EXCEPTION 'Legacy account has master dependencies; no changes made'; END IF;

  -- Fail closed for every currently defined account UUID reference, not only journals.
  FOR dep IN
    SELECT col.table_schema,col.table_name,col.column_name
    FROM information_schema.columns col
    JOIN information_schema.tables tbl
      ON tbl.table_schema=col.table_schema AND tbl.table_name=col.table_name
    WHERE col.table_schema='public' AND tbl.table_type='BASE TABLE'
      AND col.data_type='uuid' AND col.table_name<>'transport_vehicles'
      AND (col.column_name='account_id' OR right(col.column_name,11)='_account_id')
  LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I=ANY($1))',
                   dep.table_schema,dep.table_name,dep.column_name)
      INTO referenced USING account_ids;
    IF referenced THEN
      RAISE EXCEPTION 'Account still referenced in %.%; no changes made',dep.table_name,dep.column_name;
    END IF;
  END LOOP;

  UPDATE public.transport_vehicles SET revenue_account_id=NULL
  WHERE company_id=target_company AND business_unit_id=target_bu
    AND revenue_account_id=ANY(account_ids);
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>6 THEN RAISE EXCEPTION 'Vehicle unlink mismatch; no changes made'; END IF;

  UPDATE public.chart_of_accounts SET is_active=false
  WHERE company_id=target_company AND id=ANY(account_ids) AND is_active;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>6 THEN RAISE EXCEPTION 'Account retirement mismatch; no changes made'; END IF;
  RETURN affected;
END;
$function$;
