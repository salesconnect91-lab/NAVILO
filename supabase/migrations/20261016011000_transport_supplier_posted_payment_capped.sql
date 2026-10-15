-- Additive supplier payment evidence. Includes every line of each linked
-- purchase order so allocation weights and final-line rounding are not lost.
-- This is NOT canonical billed/credit/outstanding; do not switch register
-- until note/refund/clamping and full parity tests are complete.
create or replace function public.transport_register_page_supplier_posted_payment(p_trip_ids uuid[])
returns table(trip_id uuid, posted_paid_gross numeric)
language plpgsql stable security definer
set search_path to 'public','pg_temp'
set statement_timeout to '20s'
as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id();
begin
 if auth.uid() is null or c is null or b is null or loc is null
 or not public.has_module_permission(c,'transport','view')
 or not public.transport_financial_read_allowed('supplier')
 then raise exception 'Supplier financial permission and active workspace required'; end if;
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
  where l.trip_id=any(p_trip_ids) and l.company_id=c and l.business_unit_id=b
  and l.operating_location_id=loc
 ), lines as materialized (
  select l.id,l.trip_id,d.purchase_order_id,
    l.amount_snapshot+coalesce(l.vat_snapshot,0) gross_weight
  from orders o
  join public.transport_supplier_documents d on d.purchase_order_id=o.purchase_order_id
  join public.transport_supplier_document_rents l on l.document_id=d.id
  where l.company_id=c and l.business_unit_id=b and l.operating_location_id=loc
 ), balances as materialized (
  select b.order_id,
    least(greatest(b.paid_gross-b.refunded_gross,0::numeric),
          greatest(b.billed_gross,0::numeric)) paid
  from public.transport_service_document_balances_fast b
  join orders o on o.purchase_order_id=b.order_id
  where b.side='supplier'
 ), weighted as (
  select l.*,
    row_number() over(partition by l.purchase_order_id order by l.id) rn,
    count(*) over(partition by l.purchase_order_id) n,
    l.gross_weight/nullif(sum(l.gross_weight) over(partition by l.purchase_order_id),0) w
  from lines l
 ), parts as (
  select w.*,coalesce(a.paid,0) paid,round(coalesce(a.paid,0)*coalesce(w.w,0),2) part
  from weighted w left join balances a on a.order_id=w.purchase_order_id
 ), exact as (
  select p.trip_id,
    case when p.rn=p.n then p.paid-(sum(p.part) over(partition by p.purchase_order_id)-p.part)
    else p.part end amount
  from parts p
 )
 select e.trip_id,sum(e.amount) from exact e
 where e.trip_id=any(p_trip_ids) group by e.trip_id;
end $$;
revoke all on function public.transport_register_page_supplier_posted_payment(uuid[]) from public;
grant execute on function public.transport_register_page_supplier_posted_payment(uuid[]) to authenticated;
