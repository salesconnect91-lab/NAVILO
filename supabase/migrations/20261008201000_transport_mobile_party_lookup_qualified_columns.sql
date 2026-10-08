-- Fix SQLSTATE 42702 when Mobile Quick Entry reads Customer/Supplier names.
-- RETURNS TABLE(id, name, is_active) creates PL/pgSQL output variables; explicitly
-- qualify business_units columns to avoid ambiguous id/name references.
-- Permission checks, company scope and existing records are unchanged.
create or replace function public.transport_mobile_quick_list_parties(p_party_type text)
returns table(id uuid,name text,is_active boolean)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_company uuid:=public.current_company_id();
begin
 if auth.uid() is null or not public.can_transport_mobile_quick_create()
 then raise exception 'Mobile Quick Entry create permission required'; end if;
 if not exists(select 1 from public.business_units bu
   where bu.id=public.current_business_unit_id() and bu.company_id=v_company
     and bu.unit_type='transport' and bu.is_active)
 then raise exception 'Active Transport business unit required'; end if;
 if p_party_type='customer' then
   return query select c.id,c.name,c.is_active from public.customers c
   where c.company_id=v_company and c.is_active=true order by c.id;
 elsif p_party_type='supplier' then
   return query select s.id,s.name,s.is_active from public.suppliers s
   where s.company_id=v_company and s.is_active=true order by s.id;
 else
   raise exception 'Unsupported party type';
 end if;
end $$;
revoke all on function public.transport_mobile_quick_list_parties(text) from public, anon;
grant execute on function public.transport_mobile_quick_list_parties(text) to authenticated;
