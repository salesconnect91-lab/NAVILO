-- Tax rates are company settings selected by the document date. Existing posted snapshots remain untouched.
create function public.fixed_tax_rate_on(p_company uuid,p_context text,p_date date)
returns numeric language sql stable security definer set search_path=public,pg_temp as $$
 select tr.rate from public.tax_rates tr
 where (session_user='postgres' or (p_company=public.current_company_id() and public.has_company_access(p_company)))
 and tr.company_id=p_company and tr.is_active and tr.is_fixed
 and tr.applies_to in (p_context,'both')
 and (tr.effective_from is null or tr.effective_from<=p_date)
 and (tr.effective_to is null or tr.effective_to>=p_date)
 order by tr.effective_from desc nulls last,tr.created_at desc,tr.id desc limit 1
$$;
revoke all on function public.fixed_tax_rate_on(uuid,text,date) from public,anon;
grant execute on function public.fixed_tax_rate_on(uuid,text,date) to authenticated;

create or replace function public.standardize_invoice_classification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_context text;
  v_rate numeric;
begin
  v_context := case when tg_table_name = 'purchase_orders' then 'purchase' else 'sales' end;

  if tg_table_name = 'purchase_orders' then
    if new.invoice_type not in ('Purchase Invoice', 'Tax Invoice') then
      raise exception 'Purchase type must be Without Tax or With Tax.';
    end if;
  else
    -- Compatibility input only. Canonical stored value is Sale Invoice.
    if new.invoice_type = 'Cash Bill' then
      new.invoice_type := 'Sale Invoice';
    end if;
    if new.invoice_type not in ('Sale Invoice', 'Tax Invoice') then
      raise exception 'Invoice type must be Without Tax or With Tax.';
    end if;
  end if;

  if tg_table_name = 'sales_orders' then
    -- Settlement is independent from document classification. Receipts are
    -- posted separately and allocated to the receivable.
    new.payment_mode := 'Credit';
  end if;

  if tg_op='UPDATE' and old.status='posted' and new.invoice_type is not distinct from old.invoice_type
    and new.tax_percent is not distinct from old.tax_percent
    and new.company_id is not distinct from old.company_id
    and (to_jsonb(new)->>'order_date') is not distinct from (to_jsonb(old)->>'order_date')
    and (to_jsonb(new)->>'invoice_date') is not distinct from (to_jsonb(old)->>'invoice_date') then
    return new;
  end if;

  if new.invoice_type = 'Tax Invoice' then
    v_rate:=public.fixed_tax_rate_on(new.company_id,v_context,
      case when tg_table_name in ('sales_orders','purchase_orders')
      then (to_jsonb(new)->>'order_date')::date else (to_jsonb(new)->>'invoice_date')::date end);

    if v_rate is null then
      raise exception 'Configure one active fixed % tax rate before creating a tax invoice.', v_context;
    end if;

    if round(coalesce(new.tax_percent, 0), 4) <> round(v_rate, 4) then
      raise exception 'The configured fixed tax rate is %%%.', v_rate;
    end if;
  elsif coalesce(new.tax_percent, 0) <> 0 then
    raise exception 'Without Tax documents cannot contain VAT/tax.';
  end if;

  return new;
end;
$function$;

create or replace function public.enforce_document_tax_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_context text := case when tg_table_name = 'sales_orders' then 'sales' else 'purchase' end;
  v_rate numeric;
begin
  if new.company_id <> public.current_company_id() then
    raise exception 'Document company does not match the active company.';
  end if;
  if tg_op='UPDATE' and old.status='posted' and new.invoice_type is not distinct from old.invoice_type
    and new.tax_percent is not distinct from old.tax_percent
    and new.company_id is not distinct from old.company_id
    and (to_jsonb(new)->>'order_date') is not distinct from (to_jsonb(old)->>'order_date')
    and (to_jsonb(new)->>'invoice_date') is not distinct from (to_jsonb(old)->>'invoice_date') then
    return new;
  end if;

  if new.invoice_type = 'Tax Invoice' then
    v_rate:=public.fixed_tax_rate_on(new.company_id,v_context,new.order_date);
    if v_rate is null then raise exception 'Configure an effective fixed % tax rate.',v_context; end if;
    if round(coalesce(new.tax_percent,0),4) <> round(v_rate,4) then
      raise exception 'The configured fixed tax rate is %%%.',v_rate;
    end if;
  elsif coalesce(new.tax_percent,0) <> 0 then
    raise exception 'Non-tax documents cannot contain VAT/tax.';
  end if;
  return new;
end;
$function$;

create or replace function public.enforce_document_line_tax_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_context text := case when tg_table_name = 'sales_order_lines' then 'sales' else 'purchase' end;
  v_invoice_type text;
  v_company_id uuid;
  v_rate numeric;
begin
  if v_context='sales' then select invoice_type,company_id,tax_percent into v_invoice_type,v_company_id,v_rate from public.sales_orders where id=new.order_id;
  else select invoice_type,company_id,tax_percent into v_invoice_type,v_company_id,v_rate from public.purchase_orders where id=new.order_id; end if;
  if v_company_id is null or v_company_id<>public.current_company_id() or new.company_id<>v_company_id then raise exception 'Document line does not belong to the active company.'; end if;
  if v_invoice_type='Tax Invoice' then
    if round(coalesce(new.tax_percent,0),4)<>round(v_rate,4) then raise exception 'Document line tax rate must match its invoice snapshot: %%%.',v_rate; end if;
  elsif coalesce(new.tax_percent,0)<>0 then raise exception 'Non-tax document lines cannot contain VAT/tax.'; end if;
  return new;
end;
$function$;

create or replace function public.guard_document_tax_transition()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_date date;
  v_mode text;
  v_context text;
  v_rate numeric;
begin
  if tg_op='UPDATE' and old.status='posted' and
     (new.company_id is distinct from old.company_id or
      new.invoice_type is distinct from old.invoice_type or
      new.tax_percent is distinct from old.tax_percent or
      (case when tg_table_name in ('sales_orders','purchase_orders') then
         to_jsonb(new)->>'order_date' else to_jsonb(new)->>'invoice_date' end)
      is distinct from
      (case when tg_table_name in ('sales_orders','purchase_orders') then
         to_jsonb(old)->>'order_date' else to_jsonb(old)->>'invoice_date' end)) then
    raise exception 'Posted document tax treatment and date cannot be changed';
  end if;

  if tg_op='UPDATE' and old.status='posted' then return new; end if;

  v_date:=case when tg_table_name in ('sales_orders','purchase_orders')
    then (to_jsonb(new)->>'order_date')::date else (to_jsonb(new)->>'invoice_date')::date end;
  if new.invoice_type='Tax Invoice' then
    select e.tax_mode into v_mode from public.company_tax_events e
    where e.company_id=new.company_id and e.effective_from<=v_date
    order by e.effective_from desc limit 1;
    if v_mode='non_tax' then
      raise exception 'Tax invoices are unavailable while this company is Non-Tax registered on %',v_date;
    end if;
    v_context:=case when tg_table_name in ('purchase_orders','consolidated_purchase_invoices') then 'purchase' else 'sales' end;
    v_rate:=public.fixed_tax_rate_on(new.company_id,v_context,v_date);
    if v_rate is null then raise exception 'Configure an effective fixed % tax rate on %',v_context,v_date; end if;
    if round(new.tax_percent,4)<>round(v_rate,4) then
      raise exception 'Configured % tax rate on % is %%%',v_context,v_date,v_rate;
    end if;
  elsif coalesce(new.tax_percent,0)<>0 then
    raise exception 'Non-tax documents cannot contain VAT/tax.';
  end if;
  return new;
end $$;

create or replace function public.create_invoice_from_order_commitment(p_commitment_id uuid, p_qty numeric, p_godown_id uuid, p_invoice_type text default 'without_tax')
returns jsonb
language plpgsql
set search_path to public, pg_temp
as $$
declare
  c public.order_book_commitments%rowtype; h public.order_book_headers%rowtype; v_remaining numeric; v_tax numeric:=0; v_id uuid; v_no text; v_doc_type text;
  v_with_tax boolean:=lower(coalesce(p_invoice_type,'')) in ('tax','tax_invoice','with_tax');
begin
  select * into c from public.order_book_commitments where id=p_commitment_id; if not found then raise exception 'Order commitment not found.'; end if;
  select * into h from public.order_book_headers where id=c.order_id; if not found then raise exception 'Order header not found.'; end if;
  if h.company_id<>public.current_company_id() or h.business_unit_id<>public.current_business_unit_id() then raise exception 'Order commitment is outside active company/business unit.'; end if;
  if c.rate_status<>'agreed' or c.agreed_rate is null then raise exception 'Rate must be agreed before invoice creation.'; end if;
  if p_qty is null or p_qty<=0 then raise exception 'Invoice quantity must be greater than zero.'; end if;
  if p_godown_id is null or not exists(select 1 from public.godowns g where g.id=p_godown_id and g.company_id=h.company_id) then raise exception 'Select a valid godown.'; end if;
  v_remaining:=public.order_commitment_available_qty(c.id); if p_qty>v_remaining+0.0001 then raise exception 'Quantity exceeds available commitment quantity %.',v_remaining; end if;
  if h.order_type='sales' then
    perform public.assert_module_permission('sales','create'); v_doc_type:=case when v_with_tax then 'Tax Invoice' else 'Cash Bill' end;
    if v_with_tax then v_tax:=public.fixed_tax_rate_on(h.company_id,'sales',current_date); if v_tax is null then raise exception 'Configure one active fixed tax rate before creating a tax invoice.'; end if; else v_tax:=0; end if;
    insert into public.sales_orders(customer_id,sales_person,salesperson_id,order_date,status,total,invoice_type,payment_mode,tax_percent)
    values(h.party_id,h.salesperson_name,h.salesperson_id,current_date,'draft',round(p_qty*c.agreed_rate,2),v_doc_type,'Credit',v_tax)
    returning id,order_no,tax_percent into v_id,v_no,v_tax;
    insert into public.sales_order_lines(order_id,item_id,qty,unit_price,tax_percent,godown_id,line_total,description,order_book_commitment_id)
    values(v_id,c.item_id,p_qty,c.agreed_rate,v_tax,p_godown_id,round(p_qty*c.agreed_rate,2),concat('Order Book ',h.order_no,' / ',coalesce(c.remarks,'')),c.id);
    return jsonb_build_object('success',true,'type','sales','id',v_id,'document_no',v_no,'path','/sales/'||v_id||'/edit','order_no',h.order_no,'qty',p_qty,'rate',c.agreed_rate,'remaining_before',v_remaining);
  else
    perform public.assert_module_permission('purchase','create'); v_doc_type:=case when v_with_tax then 'Tax Invoice' else 'Purchase Invoice' end;
    if v_with_tax then v_tax:=public.fixed_tax_rate_on(h.company_id,'purchase',current_date); if v_tax is null then raise exception 'Configure one active fixed tax rate before creating a tax invoice.'; end if; else v_tax:=0; end if;
    select public.next_purchase_order_no() into v_no;
    insert into public.purchase_orders(order_no,supplier_id,order_date,status,invoice_type,tax_percent,total)
    values(v_no,h.party_id,current_date,'draft',v_doc_type,v_tax,round(p_qty*c.agreed_rate,2)) returning id,tax_percent into v_id,v_tax;
    insert into public.purchase_order_lines(order_id,item_id,godown_id,qty,unit_cost,tax_percent,description,line_total,order_book_commitment_id)
    values(v_id,c.item_id,p_godown_id,p_qty,c.agreed_rate,v_tax,concat('Order Book ',h.order_no,' / ',coalesce(c.remarks,'')),round(p_qty*c.agreed_rate,2),c.id);
    return jsonb_build_object('success',true,'type','purchase','id',v_id,'document_no',v_no,'path','/purchase/'||v_id,'order_no',h.order_no,'qty',p_qty,'rate',c.agreed_rate,'remaining_before',v_remaining);
  end if;
end $$;

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
    if v_doc_type='Tax Invoice' then v_tax:=public.fixed_tax_rate_on(h.company_id,'sales',current_date); if v_tax is null then raise exception 'Configure one active fixed Sales tax rate first.'; end if; end if;
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
    if v_doc_type='Tax Invoice' then v_tax:=public.fixed_tax_rate_on(h.company_id,'purchase',current_date); if v_tax is null then raise exception 'Configure one active fixed Purchase tax rate first.'; end if; end if;
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
