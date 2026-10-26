-- Use one party_id column in the local row record so customer invoice paths do
-- not resolve the supplier_id field and supplier paths do not resolve
-- customer_id. CASE expressions can resolve both record fields at runtime.
CREATE OR REPLACE FUNCTION public.transport_apply_prepost_trip_advances(
  p_side text,p_order_id uuid,p_document_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE
  r record;
  d record;
  amount_to_apply numeric;
  already_paid numeric;
BEGIN
  IF p_side='customer' THEN
    SELECT o.id,o.total,o.customer_id AS party_id,o.order_date INTO d
      FROM public.sales_orders o
     WHERE o.id=p_order_id AND o.status='posted'
       AND o.company_id=public.current_company_id()
       AND o.business_unit_id=public.current_business_unit_id()
       AND o.operating_location_id=public.current_operating_location_id()
     FOR UPDATE;
  ELSIF p_side='supplier' THEN
    SELECT o.id,o.total,o.supplier_id AS party_id,o.order_date INTO d
      FROM public.purchase_orders o
     WHERE o.id=p_order_id AND o.status='posted'
       AND o.company_id=public.current_company_id()
       AND o.business_unit_id=public.current_business_unit_id()
       AND o.operating_location_id=public.current_operating_location_id()
     FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Invoice side must be customer or supplier';
  END IF;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Posted invoice is required before Trip advance allocation'; END IF;

  FOR r IN
    SELECT a.journal_entry_id,sum(a.amount)::numeric(18,2) reserved,
      (SELECT coalesce(x.amount,0)-coalesce(x.allocated,0)
         FROM public.transport_party_advances x
        WHERE x.journal_entry_id=a.journal_entry_id AND x.side=p_side AND x.party_id=a.party_id) available,
      a.party_id
    FROM public.transport_trip_advance_allocations a
    WHERE a.company_id=public.current_company_id()
      AND a.business_unit_id=public.current_business_unit_id()
      AND a.operating_location_id=public.current_operating_location_id()
      AND a.side=p_side AND a.party_id=d.party_id
      AND ((p_side='customer' AND EXISTS(
            SELECT 1 FROM public.transport_customer_document_trips l
             WHERE l.document_id=p_document_id AND l.trip_id=a.trip_id AND NOT l.is_adjustment))
        OR (p_side='supplier' AND EXISTS(
            SELECT 1 FROM public.transport_supplier_document_rents l
             WHERE l.document_id=p_document_id AND l.rent_id=a.line_id AND NOT l.is_adjustment)))
    GROUP BY a.journal_entry_id,a.party_id
  LOOP
    DELETE FROM public.transport_trip_advance_allocations a
     WHERE a.journal_entry_id=r.journal_entry_id AND a.side=p_side
       AND a.company_id=public.current_company_id()
       AND a.business_unit_id=public.current_business_unit_id()
       AND a.operating_location_id=public.current_operating_location_id()
       AND ((p_side='customer' AND EXISTS(
             SELECT 1 FROM public.transport_customer_document_trips l
              WHERE l.document_id=p_document_id AND l.trip_id=a.trip_id AND NOT l.is_adjustment))
         OR (p_side='supplier' AND EXISTS(
             SELECT 1 FROM public.transport_supplier_document_rents l
              WHERE l.document_id=p_document_id AND l.rent_id=a.line_id AND NOT l.is_adjustment)));
    IF p_side='customer' THEN
      SELECT coalesce(sum(a.amount),0) INTO already_paid
        FROM public.invoice_payment_allocations a WHERE a.sales_order_id=p_order_id;
    ELSE
      SELECT coalesce(sum(a.amount),0) INTO already_paid
        FROM public.purchase_payment_allocations a WHERE a.purchase_order_id=p_order_id;
    END IF;
    amount_to_apply:=least(r.reserved,
      greatest(coalesce(d.total,0)-coalesce(already_paid,0),0),
      greatest(coalesce(r.available,0)+r.reserved,0));
    IF amount_to_apply>0.005 THEN
      IF p_side='customer' THEN
        PERFORM public.allocate_customer_advance(r.journal_entry_id,p_order_id,
          amount_to_apply,greatest(coalesce(d.order_date,current_date),current_date),
          'Trip advance auto-allocation','Applied from finalized Trip reservation when invoice posted');
      ELSE
        PERFORM public.allocate_supplier_advance(r.journal_entry_id,p_order_id,
          amount_to_apply,greatest(coalesce(d.order_date,current_date),current_date),
          'Trip advance auto-allocation','Applied from finalized Trip reservation when invoice posted');
      END IF;
    END IF;
  END LOOP;

  IF p_side='customer' THEN
    DELETE FROM public.transport_trip_advance_allocations a
     WHERE a.side='customer' AND a.company_id=public.current_company_id()
       AND a.business_unit_id=public.current_business_unit_id()
       AND a.operating_location_id=public.current_operating_location_id()
       AND EXISTS(SELECT 1 FROM public.transport_customer_document_trips l
         WHERE l.document_id=p_document_id AND l.trip_id=a.trip_id AND NOT l.is_adjustment);
  ELSE
    DELETE FROM public.transport_trip_advance_allocations a
     WHERE a.side='supplier' AND a.company_id=public.current_company_id()
       AND a.business_unit_id=public.current_business_unit_id()
       AND a.operating_location_id=public.current_operating_location_id()
       AND EXISTS(SELECT 1 FROM public.transport_supplier_document_rents l
         WHERE l.document_id=p_document_id AND l.rent_id=a.line_id AND NOT l.is_adjustment);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.transport_apply_prepost_trip_advances(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transport_apply_prepost_trip_advances(text,uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
