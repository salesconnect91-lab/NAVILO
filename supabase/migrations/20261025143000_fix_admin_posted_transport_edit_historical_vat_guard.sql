-- Preserve the historical VAT snapshot when a posted service amount changes.
-- Invoice detail computes VAT from amount and the immutable tax_percent when
-- historical_vat_amount is NULL; the conversion guard forbids setting it here.
BEGIN;
DO $migration$
DECLARE
  v_definition text;
  v_old text := 'UPDATE public.sales_service_lines SET amount=v_new_net,historical_vat_amount=v_new_vat WHERE id=v_line.id;';
  v_new text := 'UPDATE public.sales_service_lines SET amount=v_new_net WHERE id=v_line.id;';
BEGIN
  SELECT pg_get_functiondef('public.admin_edit_posted_transport_service_invoice(uuid,numeric,text)'::regprocedure)
    INTO v_definition;
  IF position(v_old IN v_definition)=0 THEN
    RAISE EXCEPTION 'Expected posted transport edit service-line update was not found';
  END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END
$migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
