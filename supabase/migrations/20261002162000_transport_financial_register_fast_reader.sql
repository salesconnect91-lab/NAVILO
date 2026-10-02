-- Fast, permission-checked Transport register reader.
-- Evaluate tenant/module authorization once, then read the security-invoker financial view
-- under the definer so nested evidence RLS does not repeatedly execute auth helpers per row.
create or replace function public.transport_financial_register_page(
  p_limit integer default 1000,
  p_offset integer default 0
) returns setof public.transport_financial_register
language plpgsql
security definer
set search_path=public,pg_temp
stable
as $$
declare
  c uuid := public.current_company_id();
  b uuid := public.current_business_unit_id();
begin
  if c is null or b is null then
    raise exception 'Active company and business unit required';
  end if;
  if not public.has_module_permission(c,'transport','view') then
    raise exception 'Transport view permission required';
  end if;
  return query
    select r.*
    from public.transport_financial_register r
    where r.company_id=c and r.business_unit_id=b
    order by r.trip_date desc, r.trip_no desc
    limit greatest(1,least(coalesce(p_limit,1000),1000))
    offset greatest(coalesce(p_offset,0),0);
end $$;

revoke all on function public.transport_financial_register_page(integer,integer) from public,anon;
grant execute on function public.transport_financial_register_page(integer,integer) to authenticated;
