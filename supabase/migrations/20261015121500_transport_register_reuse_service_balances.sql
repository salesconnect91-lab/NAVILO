-- NAVILO Transport: reuse canonical service balances in supplier distribution.
-- No user records are inserted, updated or deleted. Keep all posted calculations.
DO $migration$
DECLARE
  parent_view text;
  supplier_view text;
  old_rows jsonb;
  new_rows jsonb;
  sample_ids uuid[];
BEGIN
  IF position('JOIN service_balances b ON' IN
       pg_get_viewdef('public.transport_trip_financial_summary'::regclass,true))>0
     AND position('FROM transport_supplier_trip_document_balances' IN
       pg_get_viewdef('public.transport_trip_financial_summary'::regclass,true))=0
  THEN
    RAISE NOTICE 'Supplier service-balance reuse already applied';
    RETURN;
  END IF;
  SELECT pg_get_viewdef('public.transport_trip_financial_summary'::regclass,true)
    INTO parent_view;
  SELECT pg_get_viewdef('public.transport_supplier_trip_document_balances'::regclass,true)
    INTO supplier_view;
  IF position('FROM transport_supplier_trip_document_balances' IN parent_view)=0 OR
     position('JOIN transport_service_document_balances b ON' IN supplier_view)=0 THEN
    RAISE EXCEPTION 'Financial view definitions differ from verified baseline';
  END IF;
  SELECT array_agg(id) INTO sample_ids FROM (
    (SELECT id FROM public.transport_trips ORDER BY trip_date DESC, id LIMIT 7)
    UNION
    (SELECT id FROM public.transport_trips ORDER BY trip_date ASC, id LIMIT 7)
    UNION
    (SELECT t.id FROM public.transport_trips t
      WHERE EXISTS (SELECT 1 FROM public.transport_customer_document_trips d
                     WHERE d.trip_id=t.id)
      ORDER BY t.trip_date DESC,id LIMIT 7)
    UNION
    (SELECT t.id FROM public.transport_trips t
      WHERE EXISTS (SELECT 1 FROM public.transport_supplier_document_rents d
                     WHERE d.trip_id=t.id)
      ORDER BY t.trip_date DESC,id LIMIT 7)
  ) sampled;
  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) INTO old_rows
    FROM (SELECT * FROM public.transport_trip_financial_summary
      WHERE id=ANY(sample_ids)) x;
  supplier_view := replace(supplier_view,
    'JOIN transport_service_document_balances b ON',
    'JOIN service_balances b ON');
  supplier_view := regexp_replace(btrim(supplier_view),';[[:space:]]*$','');
  parent_view := replace(parent_view,
    'FROM transport_supplier_trip_document_balances',
    'FROM ('||supplier_view||') transport_supplier_trip_document_balances');
  EXECUTE 'CREATE OR REPLACE VIEW public.transport_trip_financial_summary AS '||parent_view;
  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) INTO new_rows
    FROM (SELECT * FROM public.transport_trip_financial_summary
      WHERE id=ANY(sample_ids)) x;
  IF old_rows IS DISTINCT FROM new_rows THEN
    RAISE EXCEPTION 'Financial parity test failed; migration rolled back';
  END IF;
  RAISE NOTICE 'Financial parity verified on % Trip rows',coalesce(array_length(sample_ids,1),0);
END;
$migration$;