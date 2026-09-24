create or replace function public.delete_draft_invoice_line(
  p_kind text,
  p_line_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public.legacy_data_user_id();
  v_company uuid := public.current_company_id();
  v_unit uuid := public.current_business_unit_id();
  v_doc_id uuid;
  v_status text;
  v_items numeric := 0;
  v_item_tax numeric := 0;
  v_charges numeric := 0;
  v_charge_tax numeric := 0;
  v_hawala numeric := 0;
begin
  perform public.assert_module_permission('sales','edit');
  if v_uid is null or v_company is null or v_unit is null then
    raise exception 'Authentication, active company and business unit are required.';
  end if;

  if p_kind = 'sales_main' then
    select l.order_id, o.status into v_doc_id, v_status
    from public.sales_order_lines l join public.sales_orders o on o.id = l.order_id
    where l.id = p_line_id and o.user_id = v_uid and o.company_id = v_company and o.business_unit_id = v_unit
    for update of o;
    if v_doc_id is null then raise exception 'Sales invoice line not found in active business unit.'; end if;
    if coalesce(v_status,'') <> 'draft' then raise exception 'Only draft Sales Invoice lines can be deleted.'; end if;
    delete from public.sales_order_lines where id = p_line_id and order_id = v_doc_id;
    select coalesce(sum(coalesce(line_total, qty*unit_price, 0)),0),
           coalesce(sum(coalesce(line_total, qty*unit_price, 0) * coalesce(tax_percent,0) / 100),0)
      into v_items, v_item_tax from public.sales_order_lines where order_id = v_doc_id;
    select coalesce(sum(amount),0), coalesce(sum(amount * coalesce(tax_percent,0) / 100),0)
      into v_charges, v_charge_tax from public.sales_order_charges where order_id = v_doc_id;
    select coalesce(sum(h.total),0) into v_hawala
      from public.sales_order_hawala_invoices l join public.consolidated_sales_invoices h on h.id = l.hawala_invoice_id
      where l.sales_order_id = v_doc_id;
    update public.sales_orders set total = round(v_items + v_item_tax + v_charges + v_charge_tax + v_hawala, 2) where id = v_doc_id;
  elsif p_kind = 'sales_consolidated' then
    select l.invoice_id, i.status into v_doc_id, v_status
    from public.consolidated_sales_invoice_lines l join public.consolidated_sales_invoices i on i.id = l.invoice_id
    where l.id = p_line_id and i.user_id = v_uid and i.company_id = v_company and i.business_unit_id = v_unit
    for update of i;
    if v_doc_id is null then raise exception 'Consolidated invoice line not found in active business unit.'; end if;
    if coalesce(v_status,'') <> 'draft' then raise exception 'Only draft Consolidated Invoice lines can be deleted.'; end if;
    delete from public.consolidated_sales_invoice_lines where id = p_line_id and invoice_id = v_doc_id;
    select coalesce(sum(coalesce(line_total, qty*unit_price, 0)),0),
           coalesce(sum(coalesce(line_total, qty*unit_price, 0) * coalesce(tax_percent,0) / 100),0)
      into v_items, v_item_tax from public.consolidated_sales_invoice_lines where invoice_id = v_doc_id;
    select coalesce(sum(amount),0), coalesce(sum(amount * coalesce(tax_percent,0) / 100),0)
      into v_charges, v_charge_tax from public.consolidated_sales_invoice_charges where invoice_id = v_doc_id;
    update public.consolidated_sales_invoices
      set subtotal=round(v_items,2), item_tax=round(v_item_tax,2), charges_total=round(v_charges,2),
          charge_tax=round(v_charge_tax,2), total=round(v_items+v_item_tax+v_charges+v_charge_tax,2)
      where id=v_doc_id;
  else
    raise exception 'Unsupported invoice kind %', p_kind;
  end if;
  return jsonb_build_object('success',true,'document_id',v_doc_id,'line_id',p_line_id,'kind',p_kind,'stock_posted',false,'accounting_posted',false);
end;
$$;

grant execute on function public.delete_draft_invoice_line(text,uuid) to authenticated;