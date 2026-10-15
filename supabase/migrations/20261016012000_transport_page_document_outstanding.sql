-- Scoped document outstanding evidence for selected transport Trips.
-- Preserves full purchase/sales order line weights and last-line rounding.
-- NULL means no linked posted-document balance or unauthorized side, not zero.
-- Does not change the existing financial register or posted accounting records.
create or replace function public.transport_register_page_document_outstanding(p_trip_ids uuid[])
returns table(trip_id uuid, customer_outstanding_gross numeric, supplier_outstanding_gross numeric)
language plpgsql stable security definer
set search_path to 'public','pg_temp'
set statement_timeout to '25s'
as $fn$
declare c uuid:=public.current_company_id();
declare bu uuid:=public.current_business_unit_id();
declare loc uuid:=public.current_operating_location_id();
declare can_customer boolean:=public.transport_financial_read_allowed('customer');
declare can_supplier boolean:=public.transport_financial_read_allowed('supplier');
begin
 if auth.uid() is null or c is null or bu is null or loc is null
 or not public.has_module_permission(c,'transport','view')
 or not (can_customer or can_supplier)
 then raise exception 'Active authorized financial workspace required'; end if;
 if p_trip_ids is null or cardinality(p_trip_ids) not between 1 and 100
   or (select count(distinct x.id) from unnest(p_trip_ids) x(id))<>cardinality(p_trip_ids)
   or (select count(*) from public.transport_trips t where t.id=any(p_trip_ids)
    and t.company_id=c and t.business_unit_id=bu and t.operating_location_id=loc)<>cardinality(p_trip_ids)
 then raise exception 'Invalid or out-of-scope Trip page'; end if;
 return query
 with eligible as materialized (
  select t.id from public.transport_trips t
  where t.id=any(p_trip_ids) and t.company_id=c
   and t.business_unit_id=bu and t.operating_location_id=loc
 ), orders as materialized (
  select distinct 'customer'::text side,d.sales_order_id order_id
  from eligible p join public.transport_customer_document_trips l on l.trip_id=p.id
  join public.transport_customer_documents d on d.id=l.document_id
  where can_customer
  union
  select distinct 'supplier'::text side,d.purchase_order_id
  from eligible p join public.transport_supplier_document_rents l on l.trip_id=p.id
  join public.transport_supplier_documents d on d.id=l.document_id
  where can_supplier
 ), invoice_lines as materialized (
  select 'customer'::text side,l.id,l.trip_id,d.sales_order_id order_id,
    l.rate_snapshot+coalesce(l.vat_snapshot,0) gross_weight
  from orders o join public.transport_customer_documents d on d.sales_order_id=o.order_id
  join public.transport_customer_document_trips l on l.document_id=d.id
  where o.side='customer'
  union all
  select 'supplier'::text side,l.id,l.trip_id,d.purchase_order_id,
    l.amount_snapshot+coalesce(l.vat_snapshot,0)
  from orders o join public.transport_supplier_documents d on d.purchase_order_id=o.order_id
  join public.transport_supplier_document_rents l on l.document_id=d.id
  where o.side='supplier'
 ), balances as materialized (
  select b.side,b.order_id,
    case when b.side='supplier' then greatest(b.outstanding_gross,0)
         else b.outstanding_gross end outstanding
  from public.transport_service_document_balances_fast b
  join orders o on o.side=b.side and o.order_id=b.order_id
 ), weighted as (
  select l.*,
    row_number() over(partition by l.side,l.order_id order by l.id) rn,
    count(*) over(partition by l.side,l.order_id) line_count,
    l.gross_weight/nullif(sum(l.gross_weight)over(partition by l.side,l.order_id),0) w
  from invoice_lines l
 ), parts as (
  select w.*,b.outstanding,
    round(b.outstanding*w.w,2) portion
  from weighted w
  join balances b on b.side=w.side and b.order_id=w.order_id
 ), exact as (
  select p.side,p.trip_id,
    case when p.rn=p.line_count then
      p.outstanding-(sum(p.portion)over(partition by p.side,p.order_id)-p.portion)
    else p.portion end outstanding
  from parts p
 ), summed as (
  select x.trip_id,
    sum(x.outstanding)filter(where x.side='customer') customer_balance,
    sum(x.outstanding)filter(where x.side='supplier') supplier_balance
  from exact x
  where x.trip_id=any(p_trip_ids)
  group by x.trip_id
 )
 select e.id,
   case when can_customer then s.customer_balance end,
   case when can_supplier then s.supplier_balance end
 from eligible e left join summed s on s.trip_id=e.id;
end $fn$;
revoke all on function public.transport_register_page_document_outstanding(uuid[]) from public;
grant execute on function public.transport_register_page_document_outstanding(uuid[]) to authenticated;
