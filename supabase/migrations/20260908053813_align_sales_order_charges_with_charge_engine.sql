alter table public.sales_order_charges
  add column if not exists quantity numeric,
  add column if not exists rate numeric;

create or replace function public.add_draft_sales_invoice_charge(
  p_kind text,
  p_document_id uuid,
  p_charge_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := public.current_company_id();
  v_bu uuid := public.current_business_unit_id();
  v_status text;
  v_invoice_type text;
  v_tax_rate numeric := 0;
  v_charge public.charge_master%rowtype;
  v_base numeric := 0;
  v_total_kg numeric := 0;
  v_total_pieces numeric := 0;
  v_quantity numeric := 0;
  v_rate numeric := 0;
  v_amount numeric := 0;
  v_charge_tax numeric := 0;
  v_user uuid := auth.uid();
begin
  if v_company is null or v_bu is null then
    raise exception 'Active company and business unit are required.';
  end if;
  if p_kind not in ('sales_main','sales_consolidated') then
    raise exception 'Unsupported sales document kind.';
  end if;
  perform public.assert_module_permission('sales','edit');

  select * into v_charge
  from public.charge_master
  where company_id = v_company
    and charge_key = p_charge_key
    and is_active = true
    and applies_to in ('sales','both')
  order by created_at desc
  limit 1;
  if not found then raise exception 'Selected charge is not active for Sales.'; end if;

  if p_kind = 'sales_main' then
    select status, invoice_type, coalesce(tax_percent,0)
      into v_status, v_invoice_type, v_tax_rate
    from public.sales_orders
    where id = p_document_id and company_id = v_company and business_unit_id = v_bu;
    if v_status is null then raise exception 'Draft Sales Invoice not found.'; end if;
    if v_status <> 'draft' then raise exception 'Charges can only be changed on a draft Sales Invoice.'; end if;

    select
      coalesce(sum(l.line_total),0),
      coalesce(sum(case
        when lower(trim(coalesce(i.unit,''))) in ('kg','kgs','kilogram','kilograms') then l.qty
        when lower(trim(coalesce(i.unit,''))) in ('t','mt','ton','tons','tonne','tonnes','metric ton') then l.qty * 1000
        else 0 end),0),
      coalesce(sum(case
        when lower(trim(coalesce(i.unit,''))) in ('pc','pcs','piece','pieces') then l.qty
        else 0 end),0)
      into v_base, v_total_kg, v_total_pieces
    from public.sales_order_lines l
    left join public.items i on i.id = l.item_id
    where l.order_id = p_document_id;
  else
    select status, invoice_type, coalesce(tax_percent,0)
      into v_status, v_invoice_type, v_tax_rate
    from public.consolidated_sales_invoices
    where id = p_document_id and company_id = v_company and business_unit_id = v_bu;
    if v_status is null then raise exception 'Draft Consolidated Sales Invoice not found.'; end if;
    if v_status <> 'draft' then raise exception 'Charges can only be changed on a draft Consolidated Sales Invoice.'; end if;

    select
      coalesce(sum(l.line_total),0),
      coalesce(sum(case
        when lower(trim(coalesce(i.unit,''))) in ('kg','kgs','kilogram','kilograms') then l.qty
        when lower(trim(coalesce(i.unit,''))) in ('t','mt','ton','tons','tonne','tonnes','metric ton') then l.qty * 1000
        else 0 end),0),
      coalesce(sum(case
        when lower(trim(coalesce(i.unit,''))) in ('pc','pcs','piece','pieces') then l.qty
        else 0 end),0)
      into v_base, v_total_kg, v_total_pieces
    from public.consolidated_sales_invoice_lines l
    left join public.items i on i.id = l.item_id
    where l.invoice_id = p_document_id;
  end if;

  v_rate := coalesce(v_charge.default_rate,0);
  v_quantity := case v_charge.unit
    when 'fixed' then 1
    when 'percent' then greatest(v_base,0)
    when 'per_kg' then greatest(v_total_kg,0)
    when 'per_ton' then greatest(v_total_kg,0) / 1000
    when 'per_piece' then greatest(v_total_pieces,0)
    else 0 end;
  v_amount := round(case when v_charge.unit='percent' then v_quantity*v_rate/100 else v_quantity*v_rate end,2);
  v_charge_tax := case when v_invoice_type='Tax Invoice' and coalesce(v_charge.tax_applicable,false) then v_tax_rate else 0 end;

  if p_kind = 'sales_main' then
    delete from public.sales_order_charges where order_id=p_document_id and charge_key=p_charge_key;
    insert into public.sales_order_charges(
      order_id, charge_key, charge_label, quantity, rate, amount, tax_percent, account_id,
      charge_type, cost_amount, cost_account_id, company_id, business_unit_id
    ) values (
      p_document_id, v_charge.charge_key, v_charge.charge_name, v_quantity, v_rate, v_amount, v_charge_tax,
      v_charge.revenue_account_id, coalesce(v_charge.charge_type,'recovery'), 0,
      v_charge.cost_account_id, v_company, v_bu
    );

    update public.sales_orders o
    set total = (
      select coalesce(sum(l.line_total + case when o.invoice_type='Tax Invoice' then l.line_total*coalesce(l.tax_percent,0)/100 else 0 end),0)
      from public.sales_order_lines l where l.order_id=o.id
    ) + (
      select coalesce(sum(c.amount + case when o.invoice_type='Tax Invoice' then c.amount*coalesce(c.tax_percent,0)/100 else 0 end),0)
      from public.sales_order_charges c where c.order_id=o.id
    )
    where o.id=p_document_id;
  else
    insert into public.consolidated_sales_invoice_charges(
      user_id, invoice_id, charge_key, amount, tax_percent, company_id, business_unit_id,
      quantity, rate, account_id, cost_account_id, charge_type
    ) values (
      v_user, p_document_id, v_charge.charge_key, v_amount, v_charge_tax, v_company, v_bu,
      v_quantity, v_rate, v_charge.revenue_account_id, v_charge.cost_account_id,
      coalesce(v_charge.charge_type,'recovery')
    )
    on conflict (invoice_id, charge_key) do update set
      amount=excluded.amount,
      tax_percent=excluded.tax_percent,
      quantity=excluded.quantity,
      rate=excluded.rate,
      account_id=excluded.account_id,
      cost_account_id=excluded.cost_account_id,
      charge_type=excluded.charge_type;

    update public.consolidated_sales_invoices o
    set subtotal=(select coalesce(sum(l.line_total),0) from public.consolidated_sales_invoice_lines l where l.invoice_id=o.id),
        charges_total=(select coalesce(sum(c.amount),0) from public.consolidated_sales_invoice_charges c where c.invoice_id=o.id),
        charge_tax=(select coalesce(sum(c.amount*coalesce(c.tax_percent,0)/100),0) from public.consolidated_sales_invoice_charges c where c.invoice_id=o.id),
        total=(select coalesce(sum(l.line_total + case when o.invoice_type='Tax Invoice' then l.line_total*coalesce(l.tax_percent,0)/100 else 0 end),0) from public.consolidated_sales_invoice_lines l where l.invoice_id=o.id)
          +(select coalesce(sum(c.amount + case when o.invoice_type='Tax Invoice' then c.amount*coalesce(c.tax_percent,0)/100 else 0 end),0) from public.consolidated_sales_invoice_charges c where c.invoice_id=o.id)
    where o.id=p_document_id;
  end if;

  return jsonb_build_object(
    'success',true,
    'charge_key',v_charge.charge_key,
    'charge_name',v_charge.charge_name,
    'quantity',v_quantity,
    'rate',v_rate,
    'amount',v_amount,
    'tax_percent',v_charge_tax
  );
end;
$$;

grant execute on function public.add_draft_sales_invoice_charge(text,uuid,text) to authenticated;
notify pgrst, 'reload schema';