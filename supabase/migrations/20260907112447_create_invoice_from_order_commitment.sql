create or replace function public.create_invoice_from_order_commitment(
  p_commitment_id uuid,
  p_qty numeric,
  p_godown_id uuid,
  p_invoice_type text default 'without_tax'
)
returns jsonb
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  c public.order_book_commitments%rowtype;
  h public.order_book_headers%rowtype;
  v_remaining numeric;
  v_tax numeric:=0;
  v_id uuid;
  v_no text;
  v_doc_type text;
begin
  select * into c from public.order_book_commitments where id=p_commitment_id;
  if not found then raise exception 'Order commitment not found.'; end if;
  select * into h from public.order_book_headers where id=c.order_id;
  if not found then raise exception 'Order header not found.'; end if;
  if h.company_id<>public.current_company_id() or h.business_unit_id<>public.current_business_unit_id() then raise exception 'Order commitment is outside active company/business unit.'; end if;
  if c.rate_status<>'agreed' or c.agreed_rate is null then raise exception 'Rate must be agreed before invoice creation.'; end if;
  if p_qty is null or p_qty<=0 then raise exception 'Invoice quantity must be greater than zero.'; end if;
  if p_godown_id is null or not exists(select 1 from public.godowns g where g.id=p_godown_id and g.company_id=h.company_id) then raise exception 'Select a valid godown.'; end if;
  select c.ordered_qty-c.cancelled_qty-coalesce(sum(f.qty),0) into v_remaining from public.order_book_fulfillments f where f.commitment_id=c.id;
  v_remaining:=coalesce(v_remaining,c.ordered_qty-c.cancelled_qty);
  if p_qty>v_remaining+0.0001 then raise exception 'Quantity exceeds remaining commitment quantity %.',v_remaining; end if;

  if h.order_type='sales' then
    perform public.assert_module_permission('sales','create');
    v_doc_type:=case when lower(p_invoice_type) in ('tax','tax_invoice','with_tax') then 'Tax Invoice' else 'Sale Invoice' end;
    insert into public.sales_orders(customer_id,sales_person,order_date,status,total,invoice_type,payment_mode,tax_percent)
    values(h.party_id,h.salesperson_name,current_date,'draft',round(p_qty*c.agreed_rate,2),v_doc_type,'Credit',0)
    returning id,order_no,tax_percent into v_id,v_no,v_tax;
    insert into public.sales_order_lines(order_id,item_id,qty,unit_price,tax_percent,godown_id,line_total,description,order_book_commitment_id)
    values(v_id,c.item_id,p_qty,c.agreed_rate,case when v_doc_type='Tax Invoice' then v_tax else 0 end,p_godown_id,round(p_qty*c.agreed_rate,2),concat('Order Book ',h.order_no,' / ',coalesce(c.remarks,'')),c.id);
    return jsonb_build_object('success',true,'type','sales','id',v_id,'document_no',v_no,'path','/sales/'||v_id,'order_no',h.order_no,'qty',p_qty,'rate',c.agreed_rate,'remaining_before',v_remaining);
  else
    perform public.assert_module_permission('purchase','create');
    v_doc_type:=case when lower(p_invoice_type) in ('tax','tax_invoice','with_tax') then 'Tax Invoice' else 'Purchase Invoice' end;
    select public.next_purchase_order_no() into v_no;
    insert into public.purchase_orders(order_no,supplier_id,order_date,status,invoice_type,tax_percent,total)
    values(v_no,h.party_id,current_date,'draft',v_doc_type,0,round(p_qty*c.agreed_rate,2))
    returning id,tax_percent into v_id,v_tax;
    insert into public.purchase_order_lines(order_id,item_id,godown_id,qty,unit_cost,tax_percent,description,line_total,order_book_commitment_id)
    values(v_id,c.item_id,p_godown_id,p_qty,c.agreed_rate,case when v_doc_type='Tax Invoice' then v_tax else 0 end,concat('Order Book ',h.order_no,' / ',coalesce(c.remarks,'')),round(p_qty*c.agreed_rate,2),c.id);
    return jsonb_build_object('success',true,'type','purchase','id',v_id,'document_no',v_no,'path','/purchase/'||v_id,'order_no',h.order_no,'qty',p_qty,'rate',c.agreed_rate,'remaining_before',v_remaining);
  end if;
end $$;
grant execute on function public.create_invoice_from_order_commitment(uuid,numeric,uuid,text) to authenticated;