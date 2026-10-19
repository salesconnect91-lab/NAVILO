-- Read-only, company-/BU-/branch-scoped attribution for the Transport General P&L.
-- No historical data changes, COA changes or new financial postings.
-- This is display detail for existing posted Normal Sale GL revenue only.
create or replace function public.transport_pl_normal_sales_vehicle_income_scoped(
 p_from date,p_to date,p_scope text default 'branch'
) returns jsonb
language plpgsql stable security definer
set search_path = public,pg_temp
as $function$
declare
 c uuid:=public.current_company_id();
 b uuid:=public.current_business_unit_id();
 loc uuid:=public.current_operating_location_id();
 result jsonb;
begin
 if auth.uid() is null or c is null or not public.has_module_permission(c,'accounting','view')
   or not public.has_module_permission(c,'sales','view')
 then raise exception 'Accounting and Sales view permissions required';end if;
 if p_from is null or p_to is null or p_from>p_to
 then raise exception 'Valid P&L date range required';end if;
 if p_scope not in ('branch','business_unit','company')
 then raise exception 'Invalid P&L scope';end if;
 if (p_scope in ('branch','business_unit') and b is null)
   or (p_scope='branch' and loc is null)
 then raise exception 'Active business unit and location required';end if;
 if p_scope<>'company' and not exists (
   select 1 from public.business_units u
   where u.id=b and u.company_id=c and u.unit_type='transport'
 ) then raise exception 'Transport business unit required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('vehicle_id',v.account_id,
   'vehicle_no',v.account_name,'amount',v.amount) order by v.account_name),'[]'::jsonb)
 into result
 from (
  select a.account_id,a.account_name,round(sum(a.revenue),2) amount
  from public.transport_normal_vehicle_contributions a
  where a.company_id=c
    and (p_scope='company' or a.business_unit_id=b)
    and (p_scope<>'branch' or a.operating_location_id=loc)
    and a.event_date between p_from and p_to
    and a.category='Sale Invoice'
  group by a.account_id,a.account_name
 ) v;
 return jsonb_build_object('rows',result);
end
$function$;
revoke all on function public.transport_pl_normal_sales_vehicle_income_scoped(date,date,text) from public,anon;
grant execute on function public.transport_pl_normal_sales_vehicle_income_scoped(date,date,text) to authenticated;
