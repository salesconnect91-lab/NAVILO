-- Harden new Trip entry without rewriting historical trips.
create or replace function public.transport_assert_trip_driver(p_driver_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); d public.transport_drivers%rowtype;
begin
 if p_driver_id is null then return; end if;
 select * into d from public.transport_drivers where id=p_driver_id and company_id=c and business_unit_id=b and is_active for share;
 if not found then raise exception 'Active same-workspace Driver required'; end if;
 if d.driver_type='company' then
   if d.employee_id is null or d.supplier_id is not null
      or not exists(select 1 from public.employees e where e.id=d.employee_id and e.company_id=c and e.is_active)
   then raise exception 'Company Driver requires an active same-company Employee link'; end if;
 elsif d.driver_type='supplier' then
   if d.employee_id is not null or d.supplier_id is null
      or not exists(select 1 from public.suppliers s where s.id=d.supplier_id and s.company_id=c and s.is_active)
   then raise exception 'Supplier Driver requires an active same-company Supplier link'; end if;
 else
   raise exception 'Driver must be classified as Company Driver or Supplier Driver';
 end if;
end $$;
revoke all on function public.transport_assert_trip_driver(uuid) from public;
grant execute on function public.transport_assert_trip_driver(uuid) to authenticated;

