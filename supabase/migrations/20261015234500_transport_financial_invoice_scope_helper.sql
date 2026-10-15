-- Additive, permission-scoped invoice-line scope for page-first financial reads.
-- No replacement of canonical balances; retains ALL invoice lines for chosen Trips.
create or replace function public.transport_register_customer_invoice_scope(p_trip_ids uuid[])
returns table(trip_id uuid, sales_order_id uuid, document_id uuid)
language plpgsql stable security definer
set search_path to 'public','pg_temp'
set statement_timeout to '12s'
as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id();
begin
 if auth.uid() is null or c is null or b is null or loc is null
    or not public.has_module_permission(c,'transport','view')
    or not public.transport_financial_read_allowed('customer') then
   raise exception 'Customer financial permission and active workspace required';
 end if;
 if p_trip_ids is null or cardinality(p_trip_ids) not between 1 and 100
   or (select count(distinct x.id) from unnest(p_trip_ids) x(id))<>cardinality(p_trip_ids)
   or (select count(*) from public.transport_trips t where t.id=any(p_trip_ids)
       and t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc)<>cardinality(p_trip_ids)
 then raise exception 'Invalid or out-of-scope Trip page'; end if;
 return query
 with orders as materialized (
   select distinct d.sales_order_id
   from public.transport_customer_document_trips l
   join public.transport_customer_documents d on d.id=l.document_id
   where l.trip_id=any(p_trip_ids)
     and l.company_id=c and l.business_unit_id=b
 ),
 all_lines as (
   select l.trip_id,d.sales_order_id,l.document_id
   from orders o
   join public.transport_customer_documents d on d.sales_order_id=o.sales_order_id
   join public.transport_customer_document_trips l on l.document_id=d.id
   where l.company_id=c and l.business_unit_id=b
 )
 select x.trip_id,x.sales_order_id,x.document_id from all_lines x;
end $$;
revoke all on function public.transport_register_customer_invoice_scope(uuid[]) from public;
grant execute on function public.transport_register_customer_invoice_scope(uuid[]) to authenticated;
