create or replace function public.restore_order_book_draft_links(p_kind text, p_document_id uuid, p_bindings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := public.current_company_id();
  v_bu uuid := public.current_business_unit_id();
  v_status text;
  v_customer uuid;
  v_binding jsonb;
  v_line_id uuid;
  v_commitment uuid;
  v_restored int := 0;
  v_expected int := 0;
  v_item uuid;
  v_godown uuid;
  v_qty numeric;
  v_rate numeric;
  v_party uuid;
begin
  if v_company is null or v_bu is null then
    raise exception 'Active company and business unit are required.';
  end if;
  if jsonb_typeof(coalesce(p_bindings, '[]'::jsonb)) <> 'array' then
    raise exception 'Bindings must be a JSON array.';
  end if;

  if p_kind = 'sales_main' then
    perform public.assert_module_permission('sales','edit');
    select status, customer_id into v_status, v_customer
    from public.sales_orders
    where id = p_document_id and company_id = v_company and business_unit_id = v_bu;
  elsif p_kind = 'sales_consolidated' then
    perform public.assert_module_permission('sales','edit');
    select status, customer_id into v_status, v_customer
    from public.consolidated_sales_invoices
    where id = p_document_id and company_id = v_company and business_unit_id = v_bu;
  else
    raise exception 'Unsupported document kind.';
  end if;

  if v_status is null then raise exception 'Draft invoice not found in active business unit.'; end if;
  if v_status <> 'draft' then raise exception 'Only draft invoices can restore Order Book links.'; end if;

  for v_binding in select value from jsonb_array_elements(coalesce(p_bindings, '[]'::jsonb))
  loop
    v_expected := v_expected + 1;
    v_commitment := nullif(v_binding->>'commitment_id','')::uuid;
    v_item := nullif(v_binding->>'item_id','')::uuid;
    v_godown := nullif(v_binding->>'godown_id','')::uuid;
    v_qty := nullif(v_binding->>'qty','')::numeric;
    v_rate := nullif(v_binding->>'rate','')::numeric;

    select h.party_id into v_party
    from public.order_book_commitments c
    join public.order_book_headers h on h.id = c.order_id
    where c.id = v_commitment
      and c.company_id = v_company
      and c.business_unit_id = v_bu
      and c.item_id = v_item
      and c.rate_status = 'agreed'
      and abs(coalesce(c.agreed_rate,0) - coalesce(v_rate,0)) < 0.0001;

    if v_party is distinct from v_customer then
      raise exception 'Order Book commitment does not belong to this invoice customer.';
    end if;

    v_line_id := null;
    if p_kind = 'sales_main' then
      select l.id into v_line_id
      from public.sales_order_lines l
      where l.order_id = p_document_id
        and l.company_id = v_company
        and l.business_unit_id = v_bu
        and l.order_book_commitment_id is null
        and l.item_id = v_item
        and l.godown_id = v_godown
        and abs(coalesce(l.qty,0) - coalesce(v_qty,0)) < 0.0001
        and abs(coalesce(l.unit_price,0) - coalesce(v_rate,0)) < 0.0001
      order by l.created_at, l.id
      limit 1
      for update;
      if v_line_id is not null then
        update public.sales_order_lines set order_book_commitment_id = v_commitment where id = v_line_id;
      end if;
    else
      select l.id into v_line_id
      from public.consolidated_sales_invoice_lines l
      where l.invoice_id = p_document_id
        and l.company_id = v_company
        and l.business_unit_id = v_bu
        and l.order_book_commitment_id is null
        and l.item_id = v_item
        and l.godown_id = v_godown
        and abs(coalesce(l.qty,0) - coalesce(v_qty,0)) < 0.0001
        and abs(coalesce(l.unit_price,0) - coalesce(v_rate,0)) < 0.0001
      order by l.created_at, l.id
      limit 1
      for update;
      if v_line_id is not null then
        update public.consolidated_sales_invoice_lines set order_book_commitment_id = v_commitment where id = v_line_id;
      end if;
    end if;

    if v_line_id is not null then v_restored := v_restored + 1; end if;
  end loop;

  return jsonb_build_object('success', true, 'expected', v_expected, 'restored', v_restored);
end;
$$;

grant execute on function public.restore_order_book_draft_links(text, uuid, jsonb) to authenticated;