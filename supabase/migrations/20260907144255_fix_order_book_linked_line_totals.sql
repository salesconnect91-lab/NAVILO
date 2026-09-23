create or replace function public.update_order_book_linked_line(p_line_id uuid,p_qty numeric,p_godown_id uuid,p_kind text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_company uuid:=public.current_company_id();
  v_bu uuid:=public.current_business_unit_id();
  v_commitment uuid;
  v_doc uuid;
  v_status text;
  v_rate numeric;
  v_line_total numeric;
begin
  if p_qty is null or p_qty<=0 then raise exception 'Quantity must be greater than zero.'; end if;
  if not exists(select 1 from public.godowns g where g.id=p_godown_id and g.company_id=v_company and g.warehouse_id is not null) then raise exception 'Select a valid Godown linked to a warehouse.'; end if;

  if p_kind='sales_main' then
    perform public.assert_module_permission('sales','edit');
    select l.order_book_commitment_id,l.order_id,o.status into v_commitment,v_doc,v_status from public.sales_order_lines l join public.sales_orders o on o.id=l.order_id where l.id=p_line_id and l.company_id=v_company and l.business_unit_id=v_bu;
    if v_commitment is null then raise exception 'This line is not linked to Order Book.'; end if;
    if v_status<>'draft' then raise exception 'Only draft Sales Invoice lines can be changed.'; end if;
    select agreed_rate into v_rate from public.order_book_commitments where id=v_commitment;
    v_line_total:=round(p_qty*v_rate,2);
    update public.sales_order_lines set qty=p_qty,godown_id=p_godown_id,unit_price=v_rate,line_total=v_line_total where id=p_line_id;
    update public.sales_orders o set total=(select coalesce(sum(l.line_total + case when o.invoice_type='Tax Invoice' then l.line_total*l.tax_percent/100 else 0 end),0) from public.sales_order_lines l where l.order_id=v_doc) where o.id=v_doc;
  elsif p_kind='purchase_main' then
    perform public.assert_module_permission('purchase','edit');
    select l.order_book_commitment_id,l.order_id,o.status into v_commitment,v_doc,v_status from public.purchase_order_lines l join public.purchase_orders o on o.id=l.order_id where l.id=p_line_id and l.company_id=v_company and l.business_unit_id=v_bu;
    if v_commitment is null then raise exception 'This line is not linked to Order Book.'; end if;
    if v_status<>'draft' then raise exception 'Only draft Purchase Invoice lines can be changed.'; end if;
    select agreed_rate into v_rate from public.order_book_commitments where id=v_commitment;
    v_line_total:=round(p_qty*v_rate,2);
    update public.purchase_order_lines set qty=p_qty,godown_id=p_godown_id,unit_cost=v_rate,line_total=v_line_total where id=p_line_id;
    update public.purchase_orders o set total=(select coalesce(sum(l.line_total + case when o.invoice_type='Tax Invoice' then l.line_total*l.tax_percent/100 else 0 end),0) from public.purchase_order_lines l where l.order_id=v_doc) where o.id=v_doc;
  elsif p_kind='sales_consolidated' then
    perform public.assert_module_permission('sales','edit');
    select l.order_book_commitment_id,l.invoice_id,o.status into v_commitment,v_doc,v_status from public.consolidated_sales_invoice_lines l join public.consolidated_sales_invoices o on o.id=l.invoice_id where l.id=p_line_id and l.company_id=v_company and l.business_unit_id=v_bu;
    if v_commitment is null then raise exception 'This line is not linked to Order Book.'; end if;
    if v_status<>'draft' then raise exception 'Only draft Consolidated Sales lines can be changed.'; end if;
    select agreed_rate into v_rate from public.order_book_commitments where id=v_commitment;
    v_line_total:=round(p_qty*v_rate,2);
    update public.consolidated_sales_invoice_lines set qty=p_qty,godown_id=p_godown_id,unit_price=v_rate,line_total=v_line_total where id=p_line_id;
    update public.consolidated_sales_invoices o set subtotal=(select coalesce(sum(l.line_total),0) from public.consolidated_sales_invoice_lines l where l.invoice_id=v_doc), total=(select coalesce(sum(l.line_total + case when o.invoice_type='Tax Invoice' then l.line_total*l.tax_percent/100 else 0 end),0) from public.consolidated_sales_invoice_lines l where l.invoice_id=v_doc) where o.id=v_doc;
  elsif p_kind='purchase_consolidated' then
    perform public.assert_module_permission('purchase','edit');
    select l.order_book_commitment_id,l.invoice_id,o.status into v_commitment,v_doc,v_status from public.consolidated_purchase_invoice_lines l join public.consolidated_purchase_invoices o on o.id=l.invoice_id where l.id=p_line_id and l.company_id=v_company and l.business_unit_id=v_bu;
    if v_commitment is null then raise exception 'This line is not linked to Order Book.'; end if;
    if v_status<>'draft' then raise exception 'Only draft Consolidated Purchase lines can be changed.'; end if;
    select agreed_rate into v_rate from public.order_book_commitments where id=v_commitment;
    v_line_total:=round(p_qty*v_rate,2);
    update public.consolidated_purchase_invoice_lines set qty=p_qty,godown_id=p_godown_id,unit_cost=v_rate,line_total=v_line_total where id=p_line_id;
    update public.consolidated_purchase_invoices o set subtotal=(select coalesce(sum(l.line_total),0) from public.consolidated_purchase_invoice_lines l where l.invoice_id=v_doc), total=(select coalesce(sum(l.line_total + case when o.invoice_type='Tax Invoice' then l.line_total*l.tax_percent/100 else 0 end),0) from public.consolidated_purchase_invoice_lines l where l.invoice_id=v_doc) where o.id=v_doc;
  else raise exception 'Invalid document kind.'; end if;
  return jsonb_build_object('success',true,'line_id',p_line_id,'qty',p_qty,'godown_id',p_godown_id);
end
$function$;