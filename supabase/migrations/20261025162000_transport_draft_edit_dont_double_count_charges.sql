DO $$
DECLARE
  v_function regprocedure := 'public.transport_edit_register_draft_invoice(text,uuid,uuid[],date,text,uuid)'::regprocedure;
  v_source text := pg_get_functiondef(v_function);
  v_old text;
  v_new text;
BEGIN
  v_old := 'SELECT v_net+coalesce(sum(amount),0) INTO v_net FROM public.sales_order_charges WHERE order_id=v_order;';
  v_new := '';
  IF position(v_old in v_source) = 0 THEN
    RAISE EXCEPTION 'Expected customer charge double-count expression was not found';
  END IF;
  v_source := replace(v_source, v_old, v_new);

  v_old := 'SELECT v_net+coalesce(sum(amount),0) INTO v_net FROM public.purchase_order_charges WHERE order_id=v_order;';
  IF position(v_old in v_source) = 0 THEN
    RAISE EXCEPTION 'Expected supplier charge double-count expression was not found';
  END IF;
  v_source := replace(v_source, v_old, v_new);

  EXECUTE v_source;
END
$$;
