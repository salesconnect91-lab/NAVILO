-- Extend collision recovery to each document family using the shared generator.
DO $migration$
DECLARE definition text; start_at integer; end_at integer;
BEGIN
 SELECT pg_get_functiondef('public.next_document_number(text,text)'::regprocedure) INTO definition;
 definition:=replace(definition,'v_number bigint;','v_number bigint; v_table text; v_column text; v_existing bigint; v_prefix text;');
 start_at:=position('IF p_document_type=''manual_journal'' AND' in definition);
 end_at:=position('v_number:=v_seq.next_number;' in definition);
 IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'Unexpected generator definition'; END IF;
 definition:=left(definition,start_at-1)||$patch$
 v_table:=CASE
   WHEN p_document_type IN ('manual_journal','salary_payment','cash_bank','inventory_journal','cutover_opening_balance') THEN 'journal_entries'
   WHEN p_document_type='sales' THEN 'sales_orders'
   WHEN p_document_type IN ('purchase','expense_invoice') THEN 'purchase_orders'
   WHEN p_document_type='maintenance_work_order' THEN 'maintenance_work_orders'
 END;
 v_column:=CASE WHEN v_table='journal_entries' THEN 'entry_no'
   WHEN v_table='maintenance_work_orders' THEN 'maintenance_no' ELSE 'order_no' END;
 v_prefix:=coalesce(p_prefix,v_seq.prefix,'');
 IF v_table IS NOT NULL THEN
   EXECUTE format(
     'SELECT max(substring(btrim(%1$I) from length($3)+1)::bigint) FROM public.%2$I WHERE company_id=$1 AND business_unit_id IS NOT DISTINCT FROM $2 AND lower(left(btrim(%1$I),length($3)))=lower($3) AND substring(btrim(%1$I) from length($3)+1) ~ ''^[0-9]{1,18}$''',
     v_column,v_table)
   INTO v_existing USING v_company,v_unit,v_prefix;
   v_seq.next_number:=greatest(v_seq.next_number,coalesce(v_existing,0)+1);
 END IF;
 $patch$||substring(definition from end_at);
 definition:=replace(definition,
 'CASE WHEN p_document_type=''manual_journal'' THEN greatest(v_seq.padding,length(v_number::text)) ELSE v_seq.padding END',
 'greatest(v_seq.padding,length(v_number::text))');
 definition:=replace(definition,'set next_number=next_number+1,prefix=','set next_number=v_number+1,prefix=');
 EXECUTE definition;
END $migration$;
