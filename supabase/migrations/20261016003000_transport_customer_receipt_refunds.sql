-- Additive and opt-in; does not alter canonical financial views or accounting.
-- Page-level customer posted payment allocation with complete order lines.
create or replace function public.transport_register_page_customer_received(p_trip_ids uuid[])
returns table(trip_id uuid, received_gross numeric)
language plpgsql stable security definer
set search_path to 'public','pg_temp'
set statement_timeout to '15s'
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
 with relevant_orders as materialized (
 select distinct d.sales_order_id
 from public.transport_customer_document_trips l
 join public.transport_customer_documents d on d.id=l.document_id
 where l.trip_id=any(p_trip_ids) and l.company_id=c and l.business_unit_id=b and l.operating_location_id=loc
 ), all_lines as materialized (
 select l.id,l.trip_id,d.sales_order_id,l.rate_snapshot,coalesce(l.vat_snapshot,0) vat_snapshot
 from relevant_orders o
 join public.transport_customer_documents d on d.sales_order_id=o.sales_order_id
 join public.transport_customer_document_trips l on l.document_id=d.id
 where l.company_id=c and l.business_unit_id=b and l.operating_location_id=loc
 ), allocations as materialized (
 select a.sales_order_id,sum(a.amount) paid
 from relevant_orders o join public.invoice_payment_allocations a on a.sales_order_id=o.sales_order_id
 join public.transport_active_journals j on j.id=a.journal_entry_id
 group by a.sales_order_id
 ), refunds as materialized (
 select r.order_id,sum(r.amount) refunded
 from relevant_orders o join public.transport_service_refunds r
   on r.order_id=o.sales_order_id and r.side='customer'
 join public.transport_active_journals j on j.id=r.journal_entry_id
 group by r.order_id
 ), weighted as (
 select l.*,row_number() over(partition by l.sales_order_id order by l.id) rn,
 count(*) over(partition by l.sales_order_id) cnt,
 (l.rate_snapshot+l.vat_snapshot)/nullif(sum(l.rate_snapshot+l.vat_snapshot) over(partition by l.sales_order_id),0) weight
 from all_lines l
 ), portions as (
 select w.*,(coalesce(a.paid,0)-coalesce(r.refunded,0)) total_paid,
 round((coalesce(a.paid,0)-coalesce(r.refunded,0))*coalesce(w.weight,0),2) part
 from weighted w left join allocations a on a.sales_order_id=w.sales_order_id
 left join refunds r on r.order_id=w.sales_order_id
 ), exact as (
 select p.trip_id,case when p.rn=p.cnt
 then p.total_paid-(sum(p.part) over(partition by p.sales_order_id)-p.part)
 else p.part end value
 from portions p
 )
 select e.trip_id,sum(e.value) received_gross from exact e
 where e.trip_id=any(p_trip_ids) group by e.trip_id;
end $$;
revoke all on function public.transport_register_page_customer_received(uuid[]) from public;
grant execute on function public.transport_register_page_customer_received(uuid[]) to authenticated;
