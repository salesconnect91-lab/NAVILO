BEGIN;

DO $migration$
DECLARE
  v_source text;
  v_at integer;
  v_injection text := $injection$
  -- A posted customer link can be released only after an Admin-only RPC has
  -- verified a full credit, zero outstanding, no payments/refunds, and recorded
  -- its audit event in this same transaction.
  if tg_table_name='transport_customer_document_trips' and tg_op='UPDATE'
    and old.is_adjustment=false and new.is_adjustment=true
    and (to_jsonb(new)-'is_adjustment')=(to_jsonb(old)-'is_adjustment')
    and coalesce(current_setting('app.transport_invoice_trip_release',true),'0')='1'
    and exists(
      select 1 from public.transport_action_gate g
      join public.transport_customer_documents d on d.id=old.document_id
      join public.sales_orders o on o.id=d.sales_order_id
      join public.transport_service_document_balances b on b.order_id=o.id and b.side='customer'
      where g.transaction_id=txid_current() and g.trip_id=old.trip_id
        and g.action='admin_invoice_trip_release'
        and o.status='posted' and d.journal_entry_id is not null
        and d.company_id=public.current_company_id()
        and d.business_unit_id=public.current_business_unit_id()
        and d.operating_location_id=public.current_operating_location_id()
        and b.credited_gross>=b.original_gross-0.01
        and b.outstanding_gross<=0.01 and b.paid_gross<=0.01 and b.refunded_gross<=0.01
    ) then return new; end if;
$injection$;
BEGIN
  SELECT p.prosrc INTO v_source
    FROM pg_proc p WHERE p.oid='public.transport_financial_append_only()'::regprocedure;
  v_source:=ltrim(v_source,E' \t\n\r');
  v_at:=strpos(v_source,'begin');
  IF v_at<>1 THEN
    RAISE EXCEPTION 'Could not locate transport financial immutability trigger insertion point';
  END IF;
  IF strpos(v_source,'admin_invoice_trip_release')=0 THEN
    v_source := left(v_source,v_at+4)||E'\n'||v_injection||substr(v_source,v_at+5);
  END IF;
  EXECUTE 'CREATE OR REPLACE FUNCTION public.transport_financial_append_only() '
    ||'RETURNS trigger LANGUAGE plpgsql SET search_path TO ''public'', ''pg_temp'' AS '
    ||quote_literal(v_source);
END
$migration$;

COMMIT;
