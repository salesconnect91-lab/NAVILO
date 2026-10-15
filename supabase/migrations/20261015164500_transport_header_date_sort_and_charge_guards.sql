-- NAVILO: date header options are true chronological dates (latest first),
-- and Customer/Supplier Charges receive the same financial permission checks
-- as their respective other register amount columns.
-- Pure stored-function change. No journal, Trip, invoice or payment data edits.
DO $fix$
DECLARE
  def text := pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
  front text;
  remainder text;
  first_pos integer;
  n_customer integer;
  n_supplier integer;
BEGIN
  IF position('ORDER BY CASE WHEN p_option_key='||quote_literal('trip_date') IN def)>0
    AND position('''invoiced'',''charge'']' IN def)>0
    AND position('''supplier_invoice_no'',''supplier_charges'']' IN def)>0
  THEN
    RAISE NOTICE 'Chronological header options and charges permissions already fixed';
    RETURN;
  END IF;
  first_pos:=position(' opening_read:=exists(' IN def);
  IF first_pos<=0 THEN RAISE EXCEPTION 'Transport permission guard baseline missing'; END IF;
  front:=left(def,first_pos-1);
  remainder:=substr(def,first_pos);
  n_customer:=(length(front)-length(replace(front,'''invoiced''])','')))/length('''invoiced''])');
  n_supplier:=(length(front)-length(replace(front,'''supplier_invoice_no''])','')))/length('''supplier_invoice_no''])');
  IF n_customer<>3 OR n_supplier<>3 THEN
    RAISE EXCEPTION 'Transport financial guard changed (customer %, supplier %)',n_customer,n_supplier;
  END IF;
  front:=replace(front,'''invoiced''])','''invoiced'',''charge''])');
  front:=replace(front,'''supplier_invoice_no''])','''supplier_invoice_no'',''supplier_charges''])');
  IF position('jsonb_agg(value order by value)' IN remainder)=0
   OR position('select jsonb_agg(value) from options' IN remainder)=0
  THEN RAISE EXCEPTION 'Filter option ordering baseline changed'; END IF;
  remainder:=replace(remainder,
    'jsonb_agg(value order by value)',
    'jsonb_agg(value ORDER BY CASE WHEN p_option_key=''trip_date'' AND value ~ ''^[0-9]{2}-[A-Za-z]{3}-[0-9]{2}$'' THEN to_date(value,''DD-Mon-YY'') END DESC NULLS LAST, value)');
  remainder:=replace(remainder,
    'select jsonb_agg(value) from options',
    'select jsonb_agg(value ORDER BY CASE WHEN p_option_key=''trip_date'' AND value ~ ''^[0-9]{2}-[A-Za-z]{3}-[0-9]{2}$'' THEN to_date(value,''DD-Mon-YY'') END DESC NULLS LAST, value) from options');
  EXECUTE front||remainder;
END
$fix$;