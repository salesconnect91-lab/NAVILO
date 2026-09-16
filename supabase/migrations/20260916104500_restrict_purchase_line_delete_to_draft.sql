create or replace function public.delete_purchase_invoice_line(p_line_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company uuid := public.current_company_id();
  v_bu uuid := public.current_business_unit_id();
  v_status text;
begin
  perform public.assert_module_permission('purchase','edit');

  select po.status
  into v_status
  from public.purchase_order_lines l
  join public.purchase_orders po on po.id=l.order_id
  where l.id=p_line_id
    and l.company_id=v_company
    and l.business_unit_id=v_bu
    and po.company_id=v_company
    and po.business_unit_id=v_bu;

  if not found then
    raise exception 'Purchase invoice line not found in active business unit.';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only Draft Purchase Invoice lines can be deleted.';
  end if;

  delete from public.purchase_order_lines
  where id=p_line_id and company_id=v_company and business_unit_id=v_bu;
  return found;
end
$function$;

revoke all on function public.delete_purchase_invoice_line(uuid) from public, anon;
grant execute on function public.delete_purchase_invoice_line(uuid) to authenticated, service_role;
