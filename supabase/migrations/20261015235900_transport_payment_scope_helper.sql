-- Read-only scoped posted payment totals for all invoices touched by a Trip page.
-- Does not replace authoritative financial view, register RPC, or posted accounting.
create or replace function public.transport_register_page_payment_scope(p_trip_ids uuid[])
returns table(side text,order_id uuid,paid_gross numeric,last_payment_date date)
language plpgsql stable security definer
set search_path to 'public','pg_temp'
set statement_timeout to '12s'
as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id();
declare cv boolean:=public.transport_financial_read_allowed('customer');
declare sv boolean:=public.transport_financial_read_allowed('supplier');
begin
 if auth.uid() is null or c is null or b is null or loc is null
 or not public.has_module_permission(c,'transport','view') then
   raise exception 'Transport view permission and active workspace required';
 end if;
 if not (cv or sv) then raise exception 'Financial view permission required'; end if;
 if p_trip_ids is null or cardinality(p_trip_ids) not between 1 and 100
 or (select count(distinct u.id) from unnest(p_trip_ids) u(id))<>cardinality(p_trip_ids)
 or (select count(*) from public.transport_trips t where t.id=any(p_trip_ids)
 and t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc)<>cardinality(p_trip_ids)
 then raise exception 'Invalid or out-of-scope Trip page'; end if;
 return query
 with customer_orders as materialized (
   select distinct d.sales_order_id order_id
   from public.transport_customer_document_trips l
   join public.transport_customer_documents d on d.id=l.document_id
   where cv and l.trip_id=any(p_trip_ids)
     and l.company_id=c and l.business_unit_id=b and l.operating_location_id=loc
 ),
 supplier_orders as materialized (
   select distinct d.purchase_order_id order_id
   from public.transport_supplier_document_rents l
   join public.transport_supplier_documents d on d.id=l.document_id
   where sv and l.trip_id=any(p_trip_ids)
     and l.company_id=c and l.business_unit_id=b and l.operating_location_id=loc
 ),
 allocations as (
   select 'customer'::text side,a.sales_order_id order_id,a.amount,a.allocation_date
   from customer_orders o
   join public.invoice_payment_allocations a on a.sales_order_id=o.order_id
   join public.transport_active_journals j on j.id=a.journal_entry_id
   union all
   select 'supplier'::text side,a.purchase_order_id order_id,a.amount,a.allocation_date
   from supplier_orders o
   join public.purchase_payment_allocations a on a.purchase_order_id=o.order_id
   join public.transport_active_journals j on j.id=a.journal_entry_id
 )
 select a.side,a.order_id,sum(a.amount) paid_gross,max(a.allocation_date) last_payment_date
 from allocations a group by a.side,a.order_id;
end $$;
revoke all on function public.transport_register_page_payment_scope(uuid[]) from public;
grant execute on function public.transport_register_page_payment_scope(uuid[]) to authenticated;
