-- Draft edit already includes each trip's charge VAT in its per-trip VAT
-- snapshot. Do not add the same sales/purchase charge VAT a second time when
-- summing the document's charge rows.
DO $fix_charge_vat$
DECLARE
  v_definition text:=pg_get_functiondef(
    'public.transport_edit_register_draft_invoice(text,uuid,uuid[],date,text,uuid)'::regprocedure
  );
  v_old text;
  v_new text;
BEGIN
  v_old:='SELECT v_net+coalesce(sum(amount),0),v_vat+coalesce(sum(round(amount*tax_percent/100,2)),0) INTO v_net,v_vat FROM public.sales_order_charges WHERE order_id=v_order;';
  v_new:='SELECT v_net+coalesce(sum(amount),0) INTO v_net FROM public.sales_order_charges WHERE order_id=v_order;';
  IF position(v_old IN v_definition)=0 THEN
    RAISE EXCEPTION 'Sales charge VAT calculation changed; review before applying';
  END IF;
  v_definition:=replace(v_definition,v_old,v_new);

  v_old:='SELECT v_net+coalesce(sum(amount),0),v_vat+coalesce(sum(round(amount*tax_percent/100,2)),0) INTO v_net,v_vat FROM public.purchase_order_charges WHERE order_id=v_order;';
  v_new:='SELECT v_net+coalesce(sum(amount),0) INTO v_net FROM public.purchase_order_charges WHERE order_id=v_order;';
  IF position(v_old IN v_definition)=0 THEN
    RAISE EXCEPTION 'Purchase charge VAT calculation changed; review before applying';
  END IF;
  v_definition:=replace(v_definition,v_old,v_new);
  EXECUTE v_definition;
END
$fix_charge_vat$;
