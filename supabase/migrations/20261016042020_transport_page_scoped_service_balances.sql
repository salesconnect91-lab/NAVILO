-- Restrict page balance work to the complete invoices linked to the selected
-- Trips before aggregating payments, notes, refunds and service lines.
-- All monetary expressions and last-line rounding remain canonical.
do $migration$
declare
 source_definition text:=pg_get_viewdef('public.transport_service_document_balances_fast'::regclass,true);
 page_definition text:=pg_get_functiondef('public.transport_register_page_document_outstanding(uuid[])'::regprocedure);
 before_definition text;
 old_text text;
 new_text text;
 replacements jsonb:=$replacements$[
 ["WHERE s.status = 'posted'::text", "WHERE s.status = 'posted'::text AND s.id=ANY(p_customer_orders)"],
 ["WHERE p.status = 'posted'::text", "WHERE p.status = 'posted'::text AND p.id=ANY(p_supplier_orders)"],
 ["FROM sales_service_lines\n", "FROM sales_service_lines WHERE sales_service_lines.order_id=ANY(p_customer_orders)\n"],
 ["FROM purchase_service_lines\n", "FROM purchase_service_lines WHERE purchase_service_lines.order_id=ANY(p_supplier_orders)\n"],
 ["FROM transport_supplier_documents d\n", "FROM (SELECT * FROM public.transport_supplier_documents WHERE purchase_order_id=ANY(p_supplier_orders)) d\n"],
 ["FROM transport_service_cost_links d\n", "FROM (SELECT * FROM public.transport_service_cost_links WHERE purchase_order_id=ANY(p_supplier_orders)) d\n"],
 ["WHERE rn.status = 'posted'::text", "WHERE rn.status = 'posted'::text AND ((n.side='customer' AND n.order_id=ANY(p_customer_orders)) OR (n.side='supplier' AND n.order_id=ANY(p_supplier_orders)))"],
 ["FROM invoice_payment_allocations a\n", "FROM (SELECT * FROM public.invoice_payment_allocations WHERE sales_order_id=ANY(p_customer_orders)) a\n"],
 ["FROM purchase_payment_allocations a\n", "FROM (SELECT * FROM public.purchase_payment_allocations WHERE purchase_order_id=ANY(p_supplier_orders)) a\n"],
 ["FROM transport_service_refunds f\n", "FROM (SELECT * FROM public.transport_service_refunds WHERE (side='customer' AND order_id=ANY(p_customer_orders)) OR (side='supplier' AND order_id=ANY(p_supplier_orders))) f\n"]
]$replacements$::jsonb;
 replacement jsonb;
begin
 for replacement in select value from jsonb_array_elements(replacements) loop
  old_text:=replacement->>0;new_text:=replacement->>1;
  if (length(source_definition)-length(replace(source_definition,old_text,'')))/length(old_text)<>1
  then raise exception 'Scoped service reader baseline changed at %',old_text;end if;
  source_definition:=replace(source_definition,old_text,new_text);
 end loop;
 execute format('create or replace function public._transport_service_balances_for_orders(p_customer_orders uuid[],p_supplier_orders uuid[]) returns setof public.transport_service_document_balances_fast language sql stable security invoker as %L',source_definition);
 -- This helper exposes no new authenticated or anonymous endpoint. It is
 -- called only from the existing workspace-validated SECURITY DEFINER reader.
 revoke all on function public._transport_service_balances_for_orders(uuid[],uuid[]) from public,anon,authenticated;
 before_definition:=page_definition;
 page_definition:=replace(page_definition,
  'from public.transport_service_document_balances_fast b',
  $scoped$from public._transport_service_balances_for_orders(
    coalesce((select array_agg(order_id) from orders where side='customer'),'{}'::uuid[]),
    coalesce((select array_agg(order_id) from orders where side='supplier'),'{}'::uuid[])
  ) b$scoped$);
 if page_definition=before_definition
  and position('public._transport_service_balances_for_orders(' in page_definition)=0
 then raise exception 'Page outstanding reader changed; inspect before applying';end if;
 execute page_definition;
end $migration$;
notify pgrst,'reload schema';
