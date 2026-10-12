-- Run in an authenticated Transport workspace with imported payment evidence.
DO $test$
DECLARE c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); l uuid:=public.current_operating_location_id();
 r jsonb; expected_received numeric;expected_paid numeric; bad integer;
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR l IS NULL THEN RAISE EXCEPTION 'Authenticated transport context required';END IF;
 SELECT coalesce(sum(received_gross),0),coalesce(sum(paid_gross),0) INTO expected_received,expected_paid
 FROM public.transport_historical_payment_snapshots WHERE company_id=c AND business_unit_id=b AND operating_location_id=l;
 IF EXISTS(SELECT 1 FROM public.transport_historical_payment_snapshots hp JOIN public.transport_historical_operational_mapping hm ON hm.trip_id=hp.trip_id WHERE hp.company_id=c AND hp.received_gross>0 AND hm.customer_invoice_ref ~ '[0-9]') THEN RAISE EXCEPTION 'Invoice-number customer receipt imported';END IF;
 IF EXISTS(SELECT 1 FROM public.transport_historical_payment_snapshots hp JOIN public.transport_trips t ON t.id=hp.trip_id WHERE hp.company_id IS DISTINCT FROM t.company_id OR hp.business_unit_id IS DISTINCT FROM t.business_unit_id OR hp.operating_location_id IS DISTINCT FROM t.operating_location_id) THEN RAISE EXCEPTION 'Cross-workspace evidence';END IF;
 r:=public.transport_register_query(25,0,'{}','','asc',null,'');
 IF (r->'totals'->>'received_company')::numeric IS DISTINCT FROM expected_received OR (r->'totals'->>'supplier_paid')::numeric IS DISTINCT FROM expected_paid THEN RAISE EXCEPTION 'Default register totals do not match imported payments';END IF;
 SELECT count(*) INTO bad FROM public.transport_financial_register fr
 JOIN public.transport_historical_payment_snapshots hp ON hp.trip_id=fr.id
 WHERE fr.company_id=c AND NOT fr.customer_rate_locked AND NOT fr.supplier_rate_locked
 AND (fr.received_from_company IS DISTINCT FROM hp.received_gross OR fr.supplier_paid_net IS DISTINCT FROM hp.paid_gross);
 IF bad>0 THEN RAISE EXCEPTION 'Canonical historical payment projection mismatch: %',bad;END IF;
END $test$;
