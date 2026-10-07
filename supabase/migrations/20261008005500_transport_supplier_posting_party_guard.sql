-- Supplier posting boundary: selected Transport rents must still point to an active same-company Supplier.
-- Historical posted evidence is not changed.
create or replace function public.transport_assert_active_supplier(p_supplier_id uuid)
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();
begin
 if p_supplier_id is null or not exists(
   select 1 from public.suppliers s
   where s.id=p_supplier_id and s.company_id=c and s.is_active
 ) then
   raise exception 'Active same-company Supplier required';
 end if;
end $$;
revoke all on function public.transport_assert_active_supplier(uuid) from public,anon;
grant execute on function public.transport_assert_active_supplier(uuid) to authenticated,service_role;

-- Used by current and future supplier-posting RPCs immediately before creating canonical Purchase/AP evidence.
