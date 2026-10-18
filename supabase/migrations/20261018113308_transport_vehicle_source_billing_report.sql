-- AUD-03: Read-only, source-linked posted Trip invoice attribution by vehicle.
-- Does NOT repost/reclassify the ledger, adjust VAT, or modify documents.
CREATE OR REPLACE FUNCTION public.transport_vehicle_source_billing(
  p_vehicle uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL,
  p_limit integer DEFAULT 500, p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  loc uuid:=public.current_operating_location_id();
  answer jsonb;
BEGIN
  IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR loc IS NULL
     OR NOT public.has_module_permission(c,'accounting','view')
     OR NOT public.has_module_permission(c,'transport','view')
     OR NOT public.transport_financial_read_allowed('customer')
     OR NOT public.transport_financial_read_allowed('supplier')
  THEN
    RAISE EXCEPTION 'Vehicle financial viewing permission required' USING ERRCODE='42501';
  END IF;
  IF p_vehicle IS NULL OR p_limit NOT BETWEEN 1 AND 500 OR p_offset < 0
     OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to)
     OR NOT EXISTS (
       SELECT 1 FROM public.transport_vehicles v WHERE v.id=p_vehicle
         AND v.company_id=c AND v.business_unit_id=b
     )
  THEN
    RAISE EXCEPTION 'Valid vehicle and invoice date range required';
  END IF;
  WITH evidence AS MATERIALIZED (
    SELECT l.id AS event_id,s.order_date AS event_date,
           public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,
           COALESCE(NULLIF(btrim(t.source_invoice_no),''),
                    NULLIF(btrim(h.customer_invoice_ref),''),'') AS original_invoice_no,
           COALESCE(l.rate_snapshot,0)::numeric AS net,
           COALESCE(l.vat_snapshot,0)::numeric AS vat,
           (COALESCE(l.rate_snapshot,0)+COALESCE(l.vat_snapshot,0))::numeric AS gross
    FROM public.transport_customer_document_trips l
    JOIN public.transport_trips t ON t.id=l.trip_id AND t.company_id=c
      AND t.business_unit_id=b AND t.operating_location_id=loc
    JOIN public.transport_historical_operational_mapping h ON h.trip_id=t.id
      AND h.company_id=c AND h.business_unit_id=b AND h.operating_location_id=loc
      AND h.company_owned=true AND h.vehicle_master_id=p_vehicle
    JOIN public.transport_customer_documents d ON d.id=l.document_id
      AND d.company_id=c AND d.business_unit_id=b AND d.operating_location_id=loc
    JOIN public.sales_orders s ON s.id=d.sales_order_id AND s.company_id=c
      AND s.business_unit_id=b AND s.operating_location_id=loc AND s.status='posted'
    JOIN public.journal_entries j ON j.id=d.journal_entry_id AND j.company_id=c
      AND j.business_unit_id=b AND j.operating_location_id=loc AND j.status='posted'
    WHERE l.company_id=c AND l.business_unit_id=b AND l.operating_location_id=loc
      AND l.is_adjustment=false AND t.vehicle_id=p_vehicle
      AND (p_from IS NULL OR s.order_date>=p_from)
      AND (p_to IS NULL OR s.order_date<=p_to)
      AND EXISTS (
        SELECT 1 FROM public.sales_service_lines sl WHERE sl.order_id=s.id
          AND sl.company_id=c AND sl.business_unit_id=b
          AND sl.source_module='historical_register' AND sl.source_id=t.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries r WHERE r.reversal_of_entry_id=j.id
          AND r.company_id=c AND r.business_unit_id=b AND r.status='posted'
      )
  ), page AS (
    SELECT * FROM evidence ORDER BY event_date,event_id LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'rows',(SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.event_date,page.event_id),'[]'::jsonb) FROM page),
    'count',(SELECT count(*) FROM evidence),
    'net',(SELECT COALESCE(sum(net),0) FROM evidence),
    'vat',(SELECT COALESCE(sum(vat),0) FROM evidence),
    'gross',(SELECT COALESCE(sum(gross),0) FROM evidence)
  ) INTO answer;
  RETURN answer;
END;
$function$;
REVOKE ALL ON FUNCTION public.transport_vehicle_source_billing(uuid,date,date,integer,integer)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_vehicle_source_billing(uuid,date,date,integer,integer)
  TO authenticated;
