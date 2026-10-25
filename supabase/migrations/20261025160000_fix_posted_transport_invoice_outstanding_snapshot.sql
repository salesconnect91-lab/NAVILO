-- Recalculate the compatibility outstanding snapshot after the posted total has been written.
-- transport_normalize_payment_snapshot reads the persisted order total, so a single UPDATE
-- that changes total and outstanding at once leaves outstanding based on the previous total.
BEGIN;
DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$  UPDATE public.sales_orders SET total=v_new_gross,outstanding_amount=v_new_gross,payment_status='unpaid',
    updated_by=auth.uid(),updated_at=now() WHERE id=v_order.id;
$old$;
  v_new text := $new$  UPDATE public.sales_orders SET total=v_new_gross,outstanding_amount=v_new_gross,payment_status='unpaid',
    updated_by=auth.uid(),updated_at=now() WHERE id=v_order.id;
  -- Re-run the snapshot trigger after total is persisted, so it reads the new gross.
  UPDATE public.sales_orders SET outstanding_amount=v_new_gross WHERE id=v_order.id;
$new$;
BEGIN
  SELECT pg_get_functiondef('public.admin_edit_posted_transport_service_invoice(uuid,numeric,text)'::regprocedure)
    INTO v_definition;
  IF position(v_old IN v_definition)=0 THEN
    RAISE EXCEPTION 'Expected posted transport invoice total update was not found';
  END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END
$migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
