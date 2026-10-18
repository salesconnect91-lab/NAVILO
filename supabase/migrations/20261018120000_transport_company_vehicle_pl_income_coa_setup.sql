-- Company-owned vehicle income accounts may be provisioned by an authorized owner
-- explicitly from General P&L. No historical GL, invoices or master records are
-- modified when applying this migration.
BEGIN;
CREATE OR REPLACE FUNCTION public.accounting_setup_company_vehicle_income_accounts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
 c uuid:=public.current_company_id();
 b uuid:=public.current_business_unit_id();
 actor uuid:=auth.uid();
 parent uuid;
 owner_id uuid;
 v record;
 dest uuid;
 gl record;
 gl_code text;
 gl_name text;
 changed integer:=0;
 answer jsonb:='[]'::jsonb;
BEGIN
 IF actor IS NULL OR c IS NULL OR b IS NULL
    OR NOT public.has_module_permission(c,'accounting','create')
    OR NOT public.has_module_permission(c,'transport','view')
    OR NOT public.has_transport_action_permission(c,'master_manage')
 THEN
  RAISE EXCEPTION 'Company owner / Transport master and Accounting permissions required';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.business_units
   WHERE id=b AND company_id=c AND unit_type='transport' AND is_active)
 THEN RAISE EXCEPTION 'Active Transport business unit required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vehicle-income-coa:'||c::text||':'||b::text,0));
 SELECT id INTO parent FROM public.chart_of_accounts
  WHERE company_id=c AND type='revenue' AND is_group AND code='4000' AND is_active LIMIT 1;
 IF parent IS NULL THEN RAISE EXCEPTION 'Revenue group account 4000 required before vehicle setup';END IF;
 owner_id:=coalesce(public.company_legacy_owner_id(c),actor);
 IF (SELECT count(*) FROM public.transport_vehicles WHERE company_id=c AND business_unit_id=b
      AND ownership_type='company' AND is_active)>100 THEN
   RAISE EXCEPTION 'Too many company vehicles for one request; contact accounting administrator';
 END IF;
 FOR v IN
   SELECT id,vehicle_no,revenue_account_id FROM public.transport_vehicles
   WHERE company_id=c AND business_unit_id=b AND ownership_type='company' AND is_active
   ORDER BY vehicle_no,id FOR UPDATE
 LOOP
   dest:=null;
   -- Keep already individually linked Revenue accounts (never overwrite them).
   IF v.revenue_account_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.chart_of_accounts a
      WHERE a.id=v.revenue_account_id AND a.company_id=c AND a.type='revenue'
        AND a.is_active AND NOT a.is_group
        AND NOT EXISTS(SELECT 1 FROM public.account_mappings m
           WHERE m.company_id=c AND m.account_id=a.id AND m.mapping_key IN ('service_revenue','sales_revenue','sales'))
        AND NOT EXISTS(SELECT 1 FROM public.transport_vehicles other
           WHERE other.company_id=c AND other.id<>v.id AND other.revenue_account_id=a.id)
   ) THEN dest:=v.revenue_account_id;
   END IF;
   IF dest IS NULL THEN
     gl_code:=CASE
       WHEN c='48bfc042-e65e-4398-98a6-3d4fd56e3efb'::uuid AND v.vehicle_no='7979' THEN '4001'
       WHEN c='48bfc042-e65e-4398-98a6-3d4fd56e3efb'::uuid AND v.vehicle_no='7494' THEN '4002'
       WHEN c='48bfc042-e65e-4398-98a6-3d4fd56e3efb'::uuid AND v.vehicle_no='5731' THEN '4003'
       WHEN c='48bfc042-e65e-4398-98a6-3d4fd56e3efb'::uuid AND v.vehicle_no='2512' THEN '4004'
       ELSE 'VREV-'||replace(v.id::text,'-','')
     END;
     gl_name:='Vehicle '||v.vehicle_no||' Income';
     SELECT * INTO gl FROM public.chart_of_accounts WHERE company_id=c AND code=gl_code;
     IF FOUND THEN
       IF gl.name<>gl_name OR gl.type<>'revenue' OR gl.is_group OR NOT gl.is_active THEN
         RAISE EXCEPTION 'COA code % already exists for a different account; no changes committed',gl_code;
       END IF;
       dest:=gl.id;
     ELSE
       INSERT INTO public.chart_of_accounts(
         user_id,company_id,code,name,type,detail_type,parent_id,parent_head,
         is_group,allow_manual_entries,is_active,normal_balance)
       VALUES(owner_id,c,gl_code,gl_name,'revenue','service_income',parent,'Vehicle Income',
         false,true,true,'credit') RETURNING id INTO dest;
     END IF;
     UPDATE public.transport_vehicles SET revenue_account_id=dest
     WHERE id=v.id AND company_id=c AND business_unit_id=b;
     changed:=changed+1;
   END IF;
   answer:=answer||jsonb_build_array(jsonb_build_object(
     'vehicle_id',v.id,'vehicle_no',v.vehicle_no,'income_account_id',dest));
 END LOOP;
 RETURN jsonb_build_object('linked',changed,'vehicles',answer);
END
$function$;
REVOKE ALL ON FUNCTION public.accounting_setup_company_vehicle_income_accounts() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accounting_setup_company_vehicle_income_accounts() TO authenticated;
COMMIT;