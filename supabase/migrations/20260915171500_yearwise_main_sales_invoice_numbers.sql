create or replace function public.assign_sales_order_number()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_company_id uuid := coalesce(new.company_id, public.current_company_id());
  v_user_id uuid := coalesce(new.user_id, public.legacy_data_user_id());
  v_unit uuid := coalesce(new.business_unit_id, public.current_business_unit_id());
  v_prefix text;
  v_year text;
  v_next bigint;
begin
  if v_company_id is null or v_user_id is null or v_unit is null then
    raise exception 'Authentication, active company and business unit are required.';
  end if;
  if v_company_id <> public.current_company_id() or v_unit <> public.current_business_unit_id() then
    raise exception 'Sales invoice context does not match active company/business unit.';
  end if;
  perform public.assert_module_permission('sales','create');
  if new.order_date is null then new.order_date := current_date; end if;
  v_prefix := case when new.invoice_type = 'Tax Invoice' then 'TAX' else 'INV' end;
  v_year := extract(year from new.order_date)::int::text;
  if new.order_no is null or btrim(new.order_no) = '' or new.order_no like '%-AUTO' then
    perform pg_advisory_xact_lock(hashtextextended(v_company_id::text||':sales-order:'||v_prefix||':'||v_year,0));
    select coalesce(max((regexp_match(order_no,'^'||v_prefix||'-'||v_year||'-([0-9]+)$'))[1]::bigint),0)+1
      into v_next
      from public.sales_orders
     where company_id=v_company_id
       and order_no ~ ('^'||v_prefix||'-'||v_year||'-[0-9]+$');
    new.order_no := v_prefix||'-'||v_year||'-'||lpad(v_next::text,4,'0');
  end if;
  new.company_id := v_company_id;
  new.user_id := v_user_id;
  new.business_unit_id := v_unit;
  return new;
end;
$function$;
