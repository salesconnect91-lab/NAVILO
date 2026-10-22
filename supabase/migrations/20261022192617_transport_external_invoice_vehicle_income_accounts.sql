BEGIN;

-- Normal invoice creation already resolves each company-owned vehicle to its
-- linked Revenue COA. Apply the same rule to external-ready invoice imports so
-- every posted vehicle sale and expense shares that vehicle's ledger.
DO $external_vehicle_accounts$
DECLARE
  definition text;
  updated text;
BEGIN
  SELECT pg_get_functiondef(
    'public.transport_import_external_invoices(text,uuid,jsonb)'::regprocedure
  ) INTO definition;
  IF definition IS NULL THEN
    RAISE EXCEPTION 'Missing external transport invoice import RPC';
  END IF;

  updated:=replace(definition,E'  lid uuid;',E'  lid uuid;\n  vehicle_account_id uuid;');
  updated:=replace(updated,
    '      lid:=gen_random_uuid();',
    $replacement$      vehicle_account_id:=null;
      SELECT a.id INTO vehicle_account_id
      FROM public.transport_vehicles v
      JOIN public.chart_of_accounts a ON a.id=v.revenue_account_id
        AND a.company_id=v.company_id AND a.type='revenue'
        AND a.is_active AND NOT a.is_group
      WHERE v.company_id=c AND v.business_unit_id=b AND v.is_active
        AND v.ownership_type='company'
        AND lower(btrim(v.vehicle_no))=lower(btrim(x->>'vehicle_no'))
      LIMIT 1;
      IF EXISTS(
        SELECT 1 FROM public.transport_vehicles v
        WHERE v.company_id=c AND v.business_unit_id=b AND v.is_active
          AND v.ownership_type='company'
          AND lower(btrim(v.vehicle_no))=lower(btrim(x->>'vehicle_no'))
      ) AND vehicle_account_id IS NULL THEN
        RAISE EXCEPTION 'Company-owned Vehicle % has no active linked Income COA. Open Vehicle Master and link its Revenue account before importing',x->>'vehicle_no';
      END IF;
      lid:=gen_random_uuid();$replacement$);
  updated:=replace(updated,
    'p_revenue_account_id,''external_transport'',lid,u',
    'coalesce(vehicle_account_id,p_revenue_account_id),''external_transport'',lid,u');

  IF updated=definition
     OR position('vehicle_account_id uuid' in updated)=0
     OR position('coalesce(vehicle_account_id,p_revenue_account_id)' in updated)=0
     OR position('Company-owned Vehicle % has no active linked Income COA' in updated)=0 THEN
    RAISE EXCEPTION 'External invoice importer changed; refusing an incomplete vehicle-account update';
  END IF;
  EXECUTE updated;
END
$external_vehicle_accounts$;

COMMIT;
