-- Allow Mobile Quick Entry Create entitlement to create only the Transport masters needed by New Trip.
-- Full Master Data permissions remain unchanged; vehicle ownership keeps its separate protection.
create or replace function public.can_transport_mobile_quick_create()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.current_company_id() is not null
   and public.current_business_unit_id() is not null
   and public.has_feature_access('transport-mobile-quick-entry','create');
$$;
revoke all on function public.can_transport_mobile_quick_create() from public;
grant execute on function public.can_transport_mobile_quick_create() to authenticated;

drop policy if exists transport_mobile_quick_insert_truck_types on public.transport_truck_types;
create policy transport_mobile_quick_insert_truck_types on public.transport_truck_types for insert to authenticated
with check(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.can_transport_mobile_quick_create());

drop policy if exists transport_mobile_quick_insert_locations on public.transport_locations;
create policy transport_mobile_quick_insert_locations on public.transport_locations for insert to authenticated
with check(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.can_transport_mobile_quick_create());

drop policy if exists transport_mobile_quick_insert_drivers on public.transport_drivers;
create policy transport_mobile_quick_insert_drivers on public.transport_drivers for insert to authenticated
with check(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.can_transport_mobile_quick_create());
