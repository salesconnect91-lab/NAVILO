create or replace function public.order_commitment_available_qty(p_commitment_id uuid)
returns numeric
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  c public.order_book_commitments%rowtype;
  h public.order_book_headers%rowtype;
  v_done numeric:=0;
  v_reserved numeric:=0;
begin
  select * into c from public.order_book_commitments where id=p_commitment_id;
  if not found then return 0; end if;
  select * into h from public.order_book_headers where id=c.order_id;
  select coalesce(sum(qty),0) into v_done from public.order_book_fulfillments where commitment_id=c.id;
  if h.order_type='sales' then
    select coalesce(sum(x.qty),0) into v_reserved from (
      select l.qty from public.sales_order_lines l join public.sales_orders o on o.id=l.order_id where l.order_book_commitment_id=c.id and o.status not in ('posted','closed','cancelled')
      union all
      select l.qty from public.consolidated_sales_invoice_lines l join public.consolidated_sales_invoices o on o.id=l.invoice_id where l.order_book_commitment_id=c.id and o.status='draft'
    ) x;
  else
    select coalesce(sum(x.qty),0) into v_reserved from (
      select l.qty from public.purchase_order_lines l join public.purchase_orders o on o.id=l.order_id where l.order_book_commitment_id=c.id and o.status not in ('posted','closed','cancelled')
      union all
      select l.qty from public.consolidated_purchase_invoice_lines l join public.consolidated_purchase_invoices o on o.id=l.invoice_id where l.order_book_commitment_id=c.id and o.status='draft'
    ) x;
  end if;
  return greatest(0,c.ordered_qty-c.cancelled_qty-v_done-v_reserved);
end
$function$;

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
    update public.sales_orders set total=(select coalesce(sum(line_total + case when invoice_type='Tax Invoice' then line_total*tax_percent/100 else 0 end),0) from public.sales_order_lines where order_id=v_doc) where id=v_doc;
  elsif p_kind='purchase_main' then
    perform public.assert_module_permission('purchase','edit');
    select l.order_book_commitment_id,l.order_id,o.status into v_commitment,v_doc,v_status from public.purchase_order_lines l join public.purchase_orders o on o.id=l.order_id where l.id=p_line_id and l.company_id=v_company and l.business_unit_id=v_bu;
    if v_commitment is null then raise exception 'This line is not linked to Order Book.'; end if;
    if v_status<>'draft' then raise exception 'Only draft Purchase Invoice lines can be changed.'; end if;
    select agreed_rate into v_rate from public.order_book_commitments where id=v_commitment;
    v_line_total:=round(p_qty*v_rate,2);
    update public.purchase_order_lines set qty=p_qty,godown_id=p_godown_id,unit_cost=v_rate,line_total=v_line_total where id=p_line_id;
    update public.purchase_orders set total=(select coalesce(sum(line_total + case when invoice_type='Tax Invoice' then line_total*tax_percent/100 else 0 end),0) from public.purchase_order_lines where order_id=v_doc) where id=v_doc;
  elsif p_kind='sales_consolidated' then
    perform public.assert_module_permission('sales','edit');
    select l.order_book_commitment_id,l.invoice_id,o.status into v_commitment,v_doc,v_status from public.consolidated_sales_invoice_lines l join public.consolidated_sales_invoices o on o.id=l.invoice_id where l.id=p_line_id and l.company_id=v_company and l.business_unit_id=v_bu;
    if v_commitment is null then raise exception 'This line is not linked to Order Book.'; end if;
    if v_status<>'draft' then raise exception 'Only draft Consolidated Sales lines can be changed.'; end if;
    select agreed_rate into v_rate from public.order_book_commitments where id=v_commitment;
    v_line_total:=round(p_qty*v_rate,2);
    update public.consolidated_sales_invoice_lines set qty=p_qty,godown_id=p_godown_id,unit_price=v_rate,line_total=v_line_total where id=p_line_id;
    update public.consolidated_sales_invoices set subtotal=(select coalesce(sum(line_total),0) from public.consolidated_sales_invoice_lines where invoice_id=v_doc), total=(select coalesce(sum(line_total + case when o.invoice_type='Tax Invoice' then line_total*tax_percent/100 else 0 end),0) from public.consolidated_sales_invoice_lines l cross join public.consolidated_sales_invoices o where l.invoice_id=v_doc and o.id=v_doc) where id=v_doc;
  elsif p_kind='purchase_consolidated' then
    perform public.assert_module_permission('purchase','edit');
    select l.order_book_commitment_id,l.invoice_id,o.status into v_commitment,v_doc,v_status from public.consolidated_purchase_invoice_lines l join public.consolidated_purchase_invoices o on o.id=l.invoice_id where l.id=p_line_id and l.company_id=v_company and l.business_unit_id=v_bu;
    if v_commitment is null then raise exception 'This line is not linked to Order Book.'; end if;
    if v_status<>'draft' then raise exception 'Only draft Consolidated Purchase lines can be changed.'; end if;
    select agreed_rate into v_rate from public.order_book_commitments where id=v_commitment;
    v_line_total:=round(p_qty*v_rate,2);
    update public.consolidated_purchase_invoice_lines set qty=p_qty,godown_id=p_godown_id,unit_cost=v_rate,line_total=v_line_total where id=p_line_id;
    update public.consolidated_purchase_invoices set subtotal=(select coalesce(sum(line_total),0) from public.consolidated_purchase_invoice_lines where invoice_id=v_doc), total=(select coalesce(sum(line_total + case when o.invoice_type='Tax Invoice' then line_total*tax_percent/100 else 0 end),0) from public.consolidated_purchase_invoice_lines l cross join public.consolidated_purchase_invoices o where l.invoice_id=v_doc and o.id=v_doc) where id=v_doc;
  else raise exception 'Invalid document kind.'; end if;
  return jsonb_build_object('success',true,'line_id',p_line_id,'qty',p_qty,'godown_id',p_godown_id);
end
$function$;

grant execute on function public.update_order_book_linked_line(uuid,numeric,uuid,text) to authenticated;

create or replace function public.create_consolidated_invoice_from_order_commitment(p_commitment_id uuid,p_qty numeric,p_godown_id uuid,p_invoice_type text default 'without_tax')
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  c public.order_book_commitments%rowtype;
  h public.order_book_headers%rowtype;
  v_remaining numeric;
  v_rate numeric:=0;
  v_id uuid;
  v_no text;
  v_doc_type text;
  v_tax numeric:=0;
  v_total numeric:=0;
begin
  select * into c from public.order_book_commitments where id=p_commitment_id;
  if not found then raise exception 'Order commitment not found.'; end if;
  select * into h from public.order_book_headers where id=c.order_id;
  if h.company_id<>public.current_company_id() or h.business_unit_id<>public.current_business_unit_id() then raise exception 'Order commitment is outside active company/business unit.'; end if;
  if c.rate_status<>'agreed' or c.agreed_rate is null then raise exception 'Rate must be agreed before invoice creation.'; end if;
  if p_qty is null or p_qty<=0 then raise exception 'Invoice quantity must be greater than zero.'; end if;
  if not exists(select 1 from public.godowns g where g.id=p_godown_id and g.company_id=h.company_id and g.warehouse_id is not null) then raise exception 'Select a valid Godown linked to a warehouse.'; end if;
  v_remaining:=public.order_commitment_available_qty(c.id);
  if p_qty>v_remaining+0.0001 then raise exception 'Quantity exceeds available commitment quantity %.',v_remaining; end if;

  if h.order_type='sales' then
    perform public.assert_module_permission('sales','create');
    v_doc_type:=case when lower(p_invoice_type) in ('tax','tax_invoice','with_tax') then 'Tax Invoice' else 'Cash Bill' end;
    if v_doc_type='Tax Invoice' then select rate into v_tax from public.tax_rates where company_id=h.company_id and is_active and is_fixed and applies_to in ('sales','both') order by created_at limit 1; if v_tax is null then raise exception 'Configure one active fixed Sales tax rate first.'; end if; end if;
    v_no:='HWL-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISSMS');
    v_total:=round(p_qty*c.agreed_rate*(1+coalesce(v_tax,0)/100),2);
    insert into public.consolidated_sales_invoices(invoice_no,invoice_date,customer_id,invoice_type,tax_percent,status,subtotal,item_tax,total,reference_notes)
    values(v_no,current_date,h.party_id,v_doc_type,coalesce(v_tax,0),'draft',round(p_qty*c.agreed_rate,2),round(p_qty*c.agreed_rate*coalesce(v_tax,0)/100,2),v_total,'Order Book '||h.order_no)
    returning id into v_id;
    insert into public.consolidated_sales_invoice_lines(invoice_id,item_id,godown_id,qty,unit_price,line_total,tax_percent,description,order_book_commitment_id)
    values(v_id,c.item_id,p_godown_id,p_qty,c.agreed_rate,round(p_qty*c.agreed_rate,2),coalesce(v_tax,0),'Order Book '||h.order_no||' / '||coalesce(c.remarks,''),c.id);
    return jsonb_build_object('success',true,'type','sales_consolidated','id',v_id,'document_no',v_no,'path','/sales/consolidated','order_no',h.order_no,'qty',p_qty,'rate',c.agreed_rate);
  else
    perform public.assert_module_permission('purchase','create');
    v_doc_type:=case when lower(p_invoice_type) in ('tax','tax_invoice','with_tax') then 'Tax Invoice' else 'Purchase Invoice' end;
    if v_doc_type='Tax Invoice' then select rate into v_tax from public.tax_rates where company_id=h.company_id and is_active and is_fixed and applies_to in ('purchase','both') order by created_at limit 1; if v_tax is null then raise exception 'Configure one active fixed Purchase tax rate first.'; end if; end if;
    v_no:='CP-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISSMS');
    v_total:=round(p_qty*c.agreed_rate*(1+coalesce(v_tax,0)/100),2);
    insert into public.consolidated_purchase_invoices(invoice_no,invoice_date,supplier_id,invoice_type,tax_percent,status,subtotal,item_tax,total,reference_notes)
    values(v_no,current_date,h.party_id,v_doc_type,coalesce(v_tax,0),'draft',round(p_qty*c.agreed_rate,2),round(p_qty*c.agreed_rate*coalesce(v_tax,0)/100,2),v_total,'Order Book '||h.order_no)
    returning id into v_id;
    insert into public.consolidated_purchase_invoice_lines(invoice_id,item_id,godown_id,qty,unit_cost,line_total,tax_percent,description,order_book_commitment_id)
    values(v_id,c.item_id,p_godown_id,p_qty,c.agreed_rate,round(p_qty*c.agreed_rate,2),coalesce(v_tax,0),'Order Book '||h.order_no||' / '||coalesce(c.remarks,''),c.id);
    return jsonb_build_object('success',true,'type','purchase_consolidated','id',v_id,'document_no',v_no,'path','/purchase/consolidated','order_no',h.order_no,'qty',p_qty,'rate',c.agreed_rate);
  end if;
end
$function$;

grant execute on function public.create_consolidated_invoice_from_order_commitment(uuid,numeric,uuid,text) to authenticated;

create or replace function public.capture_consolidated_order_fulfillment()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare r record; v_doc_type text; v_doc_no text; v_doc_date date;
begin
  if new.status<>'posted' or old.status='posted' then return new; end if;
  if tg_table_name='consolidated_sales_invoices' then
    v_doc_type:='sales_consolidated'; v_doc_no:=new.invoice_no; v_doc_date:=new.invoice_date;
    for r in select order_book_commitment_id commitment_id,sum(qty) qty,max(unit_price) rate from public.consolidated_sales_invoice_lines where invoice_id=new.id and order_book_commitment_id is not null group by order_book_commitment_id loop
      insert into public.order_book_fulfillments(company_id,user_id,business_unit_id,commitment_id,document_type,document_id,document_no,document_date,qty,rate)
      values(new.company_id,new.user_id,new.business_unit_id,r.commitment_id,v_doc_type,new.id,v_doc_no,v_doc_date,r.qty,r.rate)
      on conflict (company_id,business_unit_id,document_type,document_id,commitment_id) do update set qty=excluded.qty,rate=excluded.rate,document_no=excluded.document_no,document_date=excluded.document_date;
      perform public.refresh_order_book_commitment(r.commitment_id);
    end loop;
  else
    v_doc_type:='purchase_consolidated'; v_doc_no:=new.invoice_no; v_doc_date:=new.invoice_date;
    for r in select order_book_commitment_id commitment_id,sum(qty) qty,max(unit_cost) rate from public.consolidated_purchase_invoice_lines where invoice_id=new.id and order_book_commitment_id is not null group by order_book_commitment_id loop
      insert into public.order_book_fulfillments(company_id,user_id,business_unit_id,commitment_id,document_type,document_id,document_no,document_date,qty,rate)
      values(new.company_id,new.user_id,new.business_unit_id,r.commitment_id,v_doc_type,new.id,v_doc_no,v_doc_date,r.qty,r.rate)
      on conflict (company_id,business_unit_id,document_type,document_id,commitment_id) do update set qty=excluded.qty,rate=excluded.rate,document_no=excluded.document_no,document_date=excluded.document_date;
      perform public.refresh_order_book_commitment(r.commitment_id);
    end loop;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_sales_consolidated_order_book_fulfillment on public.consolidated_sales_invoices;
create trigger trg_sales_consolidated_order_book_fulfillment after update of status on public.consolidated_sales_invoices for each row execute function public.capture_consolidated_order_fulfillment();
drop trigger if exists trg_purchase_consolidated_order_book_fulfillment on public.consolidated_purchase_invoices;
create trigger trg_purchase_consolidated_order_book_fulfillment after update of status on public.consolidated_purchase_invoices for each row execute function public.capture_consolidated_order_fulfillment();