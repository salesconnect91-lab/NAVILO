-- Compact transport dashboard metrics, isolated to current company/unit/location.
-- Read-only; no journal, trip, VAT, payment or stock changes.
create or replace function public.transport_dashboard_operational_summary(
  p_from date, p_to date
) returns jsonb
language plpgsql stable security definer
set search_path to 'public','pg_temp'
as $$
declare
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  loc uuid:=public.current_operating_location_id();
  result jsonb;
begin
  if auth.uid() is null or c is null or b is null or loc is null
     or not public.has_module_permission(c,'transport','view') then
    raise exception 'Active Transport view permission and operating location required';
  end if;
  if p_from is null or p_to is null or p_from>p_to then
    raise exception 'Valid Transport dashboard date range required';
  end if;
  with scoped as (
    select t.id,t.trip_status,t.lifecycle_status,t.status,t.ppr_status,
      t.ppr_received_date,t.ppr_received_by_name,t.ppr_received_by_employee_id,
      t.sales_order_id
    from public.transport_trips t
    where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
      and t.trip_date between p_from and p_to
  )
  select jsonb_build_object(
    'total_trips',count(*),
    'draft_trips',count(*) filter(where lower(coalesce(trip_status,lifecycle_status,status,''))='draft'),
    'incomplete_trips',count(*) filter(where lower(coalesce(trip_status,lifecycle_status,status,''))='incomplete'),
    'complete_trips',count(*) filter(where lower(coalesce(trip_status,lifecycle_status,status,''))='complete'),
    'locked_trips',count(*) filter(where lower(coalesce(trip_status,lifecycle_status,status,''))='locked'),
    'settled_trips',count(*) filter(where lower(coalesce(trip_status,lifecycle_status,status,''))='settled'),
    'ppr_pending',count(*) filter(where ppr_received_date is null and
      lower(coalesce(ppr_status,'')) not in ('received','yes')),
    'trips_without_linked_sales_invoice',count(*) filter(where sales_order_id is null),
    'customer_billed',count(*) filter(where sales_order_id is not null)
  ) into result from scoped;
  return result;
end;
$$;
revoke all on function public.transport_dashboard_operational_summary(date,date) from public,anon;
grant execute on function public.transport_dashboard_operational_summary(date,date) to authenticated;
