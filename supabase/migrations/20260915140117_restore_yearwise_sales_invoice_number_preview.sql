create or replace function public.preview_next_sales_invoice_number(p_invoice_type text default 'Sale Invoice'::text)
returns text language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_company_id uuid:=public.current_company_id(); v_prefix text; v_year text:=extract(year from current_date)::int::text; v_next bigint;
begin
 if auth.uid() is null or v_company_id is null then raise exception 'Authentication and active company are required.'; end if;
 perform public.assert_module_permission('sales','view');
 v_prefix:=case when p_invoice_type='Tax Invoice' then 'TAX' else 'INV' end;
 select coalesce(max((regexp_match(order_no,'^'||v_prefix||'-'||v_year||'-([0-9]+)$'))[1]::bigint),0)+1 into v_next from public.sales_orders where company_id=v_company_id and order_no ~ ('^'||v_prefix||'-'||v_year||'-[0-9]+$');
 return v_prefix||'-'||v_year||'-'||lpad(v_next::text,4,'0');
end $$;