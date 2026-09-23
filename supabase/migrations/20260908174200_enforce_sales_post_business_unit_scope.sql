DO $$
BEGIN
  IF to_regprocedure('public.post_sales_invoice_core(uuid)') IS NULL THEN
    ALTER FUNCTION public.post_sales_invoice(uuid)
      RENAME TO post_sales_invoice_core;
  END IF;
END $$;

create or replace function public.post_sales_invoice(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_company uuid:=public.current_company_id();
  v_bu uuid:=public.current_business_unit_id();
  v_uid uuid:=public.legacy_data_user_id();
begin
  perform public.assert_module_permission('sales','post');
  if auth.uid() is null or v_company is null or v_bu is null then
    raise exception 'Authentication, active company and business unit are required.';
  end if;
  if not exists(
    select 1 from public.sales_orders
    where id=p_order_id and user_id=v_uid and company_id=v_company and business_unit_id=v_bu
  ) then
    raise exception 'Sales invoice not found in active business unit.';
  end if;
  return public.post_sales_invoice_core(p_order_id);
end
$function$;

revoke all on function public.post_sales_invoice(uuid) from public, anon;
grant execute on function public.post_sales_invoice(uuid) to authenticated, service_role;
revoke all on function public.post_sales_invoice_core(uuid) from public, anon, authenticated;
