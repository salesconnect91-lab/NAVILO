-- Refresh the permission-scoped snapshot source from the current canonical
-- financial views. The existing source was inlined from an older view and
-- treated draft document links as posted financial evidence.
DO $source$
DECLARE
 summary_definition text:=pg_get_viewdef('public.transport_trip_financial_summary'::regclass,true);
 register_definition text:=pg_get_viewdef('public.transport_financial_register'::regclass,true);
 opening_definition text:=pg_get_viewdef('public.transport_historical_payment_effective'::regclass,true);
 prefix text:=$prefix$WITH register_selected_ids AS MATERIALIZED (
  SELECT id FROM public.transport_trips WHERE company_id=p_company AND business_unit_id=p_unit
   AND operating_location_id=p_location AND (p_ids IS NULL OR id=ANY(p_ids))
 ), register_selected_orders AS MATERIALIZED (
  SELECT DISTINCT 'customer'::text side,d.sales_order_id order_id
  FROM register_selected_ids x JOIN public.transport_customer_document_trips l ON l.trip_id=x.id
  JOIN public.transport_customer_documents d ON d.id=l.document_id
  UNION
  SELECT 'supplier',d.purchase_order_id
  FROM register_selected_ids x JOIN public.transport_supplier_document_rents l ON l.trip_id=x.id
  JOIN public.transport_supplier_documents d ON d.id=l.document_id
  UNION
  SELECT 'supplier',l.purchase_order_id FROM register_selected_ids x
  JOIN public.transport_service_cost_links l ON l.trip_id=x.id
 ) $prefix$;
 scoped_balances text:=$balances$FROM public._transport_service_balances_for_orders(
  COALESCE((SELECT array_agg(order_id) FROM register_selected_orders WHERE side='customer'),'{}'::uuid[]),
  COALESCE((SELECT array_agg(order_id) FROM register_selected_orders WHERE side='supplier'),'{}'::uuid[])
 ) transport_service_document_balances$balances$;
BEGIN
 IF position('FROM transport_service_document_balances_fast transport_service_document_balances' IN summary_definition)=0
 OR position('JOIN transport_trip_financial_summary f ON f.id = t.id' IN register_definition)=0
 OR position('FROM transport_historical_operational_mapping m' IN opening_definition)=0 THEN
  RAISE EXCEPTION 'Canonical snapshot source changed; inspect before applying';
 END IF;
 summary_definition:=replace(summary_definition,
  'FROM transport_service_document_balances_fast transport_service_document_balances',scoped_balances);
 summary_definition:=replace(summary_definition,'FROM transport_trips t',
  'FROM transport_trips t JOIN register_selected_ids scoped_id ON scoped_id.id=t.id');
 opening_definition:=replace(opening_definition,'FROM transport_historical_operational_mapping m',
  'FROM (SELECT * FROM public.transport_historical_operational_mapping WHERE trip_id IN (SELECT id FROM register_selected_ids)) m');
 opening_definition:=replace(opening_definition,'FROM transport_opening_invoice_lines',
  'FROM (SELECT * FROM public.transport_opening_invoice_lines WHERE trip_id IN (SELECT id FROM register_selected_ids)) transport_opening_invoice_lines');
 opening_definition:=regexp_replace(btrim(opening_definition),';[[:space:]]*$','');
 summary_definition:=regexp_replace(btrim(summary_definition),';[[:space:]]*$','');
 register_definition:=replace(register_definition,'FROM transport_trips t',
  'FROM transport_trips t JOIN register_selected_ids scoped_id ON scoped_id.id=t.id');
 register_definition:=replace(register_definition,'JOIN transport_trip_financial_summary f ON f.id = t.id',
  'JOIN ('||summary_definition||') f ON f.id=t.id');
 register_definition:=replace(register_definition,'LEFT JOIN transport_historical_payment_effective hp ON',
  'LEFT JOIN ('||opening_definition||') hp ON');
 EXECUTE format('CREATE OR REPLACE FUNCTION public._transport_register_snapshot_source(p_company uuid,p_unit uuid,p_location uuid,p_ids uuid[]) RETURNS SETOF public.transport_financial_register LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public,pg_temp AS %L',prefix||register_definition);
 REVOKE ALL ON FUNCTION public._transport_register_snapshot_source(uuid,uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
END
$source$;

-- Discard derived rows built from the old inlined financial formulas. The
-- next Register read rebuilds each scope from the canonical views above.
UPDATE public.transport_register_snapshots SET built=false,refreshed_at=NULL;
