-- Additive page-order helper. This does not replace the authoritative
-- transport_register_query or alter financial register/accounting data.
-- Do NOT use in the UI until financial page enrichment and total parity pass.
create or replace function public.transport_register_driver_order_page(
  p_limit integer default 100,
  p_offset integer default 0,
  p_direction text default 'desc'
)
returns table(id uuid, driver_name text)
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
set statement_timeout to '15s'
as $$
declare
  v_company uuid := public.current_company_id();
  v_unit uuid := public.current_business_unit_id();
  v_location uuid := public.current_operating_location_id();
begin
  if auth.uid() is null or v_company is null or v_unit is null or v_location is null
     or not public.has_module_permission(v_company,'transport','view') then
    raise exception 'Transport view permission and active workspace required';
  end if;
  if p_limit not between 1 and 100 or p_offset < 0
     or p_direction not in ('asc','desc') then
    raise exception 'Invalid transport driver page request';
  end if;
  return query
  with labels as materialized (
    select t.id,
      case when hm.driver_master_id is not distinct from t.driver_id
        then coalesce(
          case when exists (
            select 1 from public.transport_trip_audit pa
            where pa.trip_id=t.id and pa.action='import_primary_assignment'
          ) then public.transport_import_primary_label(hi.driver_name_snapshot,'driver')
          else hi.driver_name_snapshot end, d.driver_name)
        else coalesce(d.driver_name,
          case when exists (
            select 1 from public.transport_trip_audit pa
            where pa.trip_id=t.id and pa.action='import_primary_assignment'
          ) then public.transport_import_primary_label(hi.driver_name_snapshot,'driver')
          else hi.driver_name_snapshot end)
      end as driver_label
    from public.transport_trips t
    left join public.transport_historical_trip_identity hi
      on hi.trip_id=t.id and hi.company_id=t.company_id
      and hi.business_unit_id=t.business_unit_id
      and hi.operating_location_id=t.operating_location_id
    left join public.transport_historical_operational_mapping hm
      on hm.trip_id=t.id and hm.company_id=t.company_id
      and hm.business_unit_id=t.business_unit_id
      and hm.operating_location_id=t.operating_location_id
    left join public.transport_drivers d on d.id=t.driver_id
    where t.company_id=v_company and t.business_unit_id=v_unit
      and t.operating_location_id=v_location
  )
  select labels.id, labels.driver_label::text
  from labels
  order by
    case when p_direction='asc' then labels.driver_label end asc nulls last,
    case when p_direction='desc' then labels.driver_label end desc nulls last,
    labels.id asc
  limit p_limit offset p_offset;
end;
$$;
revoke all on function public.transport_register_driver_order_page(integer,integer,text) from public;
grant execute on function public.transport_register_driver_order_page(integer,integer,text) to authenticated;
