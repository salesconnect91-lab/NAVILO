DO $migration$
DECLARE
  v_def text;
  v_old text;
BEGIN
  SELECT pg_get_functiondef('public.transport_reverse_service_invoice(text,uuid,date,text)'::regprocedure)
    INTO v_def;

  v_old := '  v_party_name text;' || E'\n';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'Expected party-name declaration was not found'; END IF;
  v_def := replace(v_def, v_old, v_old || '  v_party_id uuid;' || E'\n');

  v_old := '    IF NOT FOUND OR v_order.status<>''posted'' OR v_order.document_kind<>''service'' THEN' || E'\n' ||
           '      RAISE EXCEPTION ''Posted Transport Sales Service Invoice in the active workspace required.'';' || E'\n' ||
           '    END IF;';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'Expected customer invoice guard was not found'; END IF;
  v_def := replace(v_def, v_old, v_old || E'\n' || '    v_party_id:=v_order.customer_id;');

  v_old := '    IF NOT FOUND OR v_order.status<>''posted'' OR v_order.document_kind<>''service'' THEN' || E'\n' ||
           '      RAISE EXCEPTION ''Posted Transport Purchase Service Invoice in the active workspace required.'';' || E'\n' ||
           '    END IF;';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'Expected supplier invoice guard was not found'; END IF;
  v_def := replace(v_def, v_old, v_old || E'\n' || '    v_party_id:=v_order.supplier_id;');

  v_old := '    p_side,CASE WHEN p_side=''customer'' THEN v_order.customer_id ELSE v_order.supplier_id END,';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'Expected return-note party expression was not found'; END IF;
  v_def := replace(v_def, v_old, '    p_side,v_party_id,');

  EXECUTE v_def;
END
$migration$;
