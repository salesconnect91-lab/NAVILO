-- Permission-scoped supplier invoice expansion for page-first financial reads.
-- Includes every line of each purchase order touched by the selected Trip page.
-- Additive: does not change posted accounting or existing register functions.
create or replace function public.transport_register_supplier_invoice_scope(p_trip_ids uuid[])
returns table(trip_id uuid, purchase_order_id uuid, document_id uuid, rent_id uuid)
language plpgsql stable security definer
set search_path to 'public','pg_temp'
set statement_timeout to '12s'
as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id();
begin
 if auth.uid() is null or c is null or b is null or loc is null
    or not public.has_module_permission(c,'transport','view')
    or not public.transport_financial_read_allowed('supplier') then
   raise exception 'Supplier financial permission and active workspace required';
 end if;
 if p_trip_ids is null or cardinality(p_trip_ids) not between 1 and 100
   or (select count(distinct x.id) from unnest(p_trip_ids) x(id))<>cardinality(p_trip_ids)
   or (select count(*) from public.transport_trips t where t.id=any(p_trip_ids)
       and t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc)<>cardinality(p_trip_ids)
 then raise exception 'Invalid or out-of-scope Trip page'; end if;
 return query
 with orders as materialized (
   select distinct d.purchase_order_id
   from public.transport_supplier_document_rents l
   join public.transport_supplier_documents d on d.id=l.document_id
   where l.trip_id=any(p_trip_ids)
     and l.company_id=c and l.business_unit_id=b and l.operating_location_id=loc
 ),
 all_lines as (
   select l.trip_id,d.purchase_order_id,l.document_id,l.rent_id
   from orders o
   join public.transport_supplier_documents d on d.purchase_order_id=o.purchase_order_id
   join public.transport_supplier_document_rents l on l.document_id=d.id
   where l.company_id=c and l.business_unit_id=b and l.operating_location_id=loc
 )
 select x.trip_id,x.purchase_order_id,x.document_id,x.rent_id from all_lines x;
end $$;
revoke all on function public.transport_register_supplier_invoice_scope(uuid[]) from public;
grant execute on function public.transport_register_supplier_invoice_scope(uuid[]) to authenticated;
