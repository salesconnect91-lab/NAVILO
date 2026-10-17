-- Standalone Normal Sales/Purchase outstanding initialization.
-- The original posting core journals AR/AP correctly but expects the draft
-- document's financial snapshot to be initialized for Cash Counter selection.
-- Forward-only function change. Does not touch any existing invoice records.
DO $migration$
DECLARE
 source text:=pg_get_functiondef('public.transport_normal_invoice_create(text,uuid,date,jsonb,uuid,text,text,boolean)'::regprocedure);
 revised text;
 old_sales_columns text:='exchange_rate,document_kind,payment_mode)';
 old_sales_values text:='tax,base,1,''service'',mode)';
 old_purchase_columns text:='exchange_rate,document_kind,supplier_invoice_no,supplier_invoice_date)';
 old_purchase_values text:='tax,base,1,''service'',coalesce(nullif(btrim(p_reference),''''),number),p_date)';
BEGIN
 IF position('normal_open_balance_snapshot' in source)>0 THEN RETURN;END IF;
 IF length(source)-length(replace(source,old_sales_columns,''))<>length(old_sales_columns)
 OR length(source)-length(replace(source,old_sales_values,''))<>length(old_sales_values)
 OR length(source)-length(replace(source,old_purchase_columns,''))<>length(old_purchase_columns)
 OR length(source)-length(replace(source,old_purchase_values,''))<>length(old_purchase_values)
 THEN RAISE EXCEPTION 'Standalone normal invoice function changed unexpectedly; cannot patch balances safely';END IF;
 revised:=replace(source,old_sales_columns,
  'exchange_rate,document_kind,payment_mode,total,outstanding_amount,payment_status)');
 revised:=replace(revised,old_sales_values,
  'tax,base,1,''service'',mode,round(total*(1+tax/100),2),round(total*(1+tax/100),2),''unpaid'') /* normal_open_balance_snapshot */');
 revised:=replace(revised,old_purchase_columns,
  'exchange_rate,document_kind,supplier_invoice_no,supplier_invoice_date,total,outstanding_amount,payment_status)');
 revised:=replace(revised,old_purchase_values,
  'tax,base,1,''service'',coalesce(nullif(btrim(p_reference),''''),number),p_date,round(total*(1+tax/100),2),round(total*(1+tax/100),2),''unpaid'')');
 EXECUTE revised;
END $migration$;
