-- Run in an authenticated imported Transport workspace.
DO $test$
DECLARE c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); t uuid; original text; stored text; r jsonb;
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR b IS NULL THEN RAISE EXCEPTION 'Active authenticated Transport workspace required';END IF;
 SELECT h.trip_id,h.source_trip_id,tr.trip_no INTO t,original,stored
 FROM public.transport_historical_trip_identity h JOIN public.transport_trips tr ON tr.id=h.trip_id
 WHERE h.company_id=c AND h.business_unit_id=b ORDER BY h.source_trip_id LIMIT 1;
 IF t IS NULL THEN RAISE EXCEPTION 'An imported source Trip is required';END IF;
 IF public.transport_display_trip_no(t,stored) IS DISTINCT FROM original THEN RAISE EXCEPTION 'Original number helper failed';END IF;
 IF (SELECT trip_no FROM public.transport_financial_register WHERE id=t) IS DISTINCT FROM original THEN RAISE EXCEPTION 'Financial register label failed';END IF;
 r:=public.transport_edit_trip_read(t);
 IF r->>'trip_no' IS DISTINCT FROM original OR r->>'internal_trip_no' IS DISTINCT FROM stored THEN RAISE EXCEPTION 'Edit presentation / internal identity failed';END IF;
 r:=public.transport_register_query(1,0,'{}','','asc','trip_no',original);
 IF NOT (r->'options' @> jsonb_build_array(original)) THEN RAISE EXCEPTION 'Original Trip No filter failed';END IF;
 IF EXISTS(SELECT 1 FROM public.transport_financial_register fr JOIN public.transport_historical_trip_identity h ON h.trip_id=fr.id
  WHERE fr.company_id=c AND fr.business_unit_id=b AND fr.trip_no IS DISTINCT FROM h.source_trip_id) THEN RAISE EXCEPTION 'Imported numbers missing from register';END IF;
 IF (SELECT trip_no FROM public.transport_trips WHERE id=t) IS DISTINCT FROM stored THEN RAISE EXCEPTION 'Stored number was changed';END IF;
END $test$;
