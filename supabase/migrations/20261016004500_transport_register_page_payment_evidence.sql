-- Additive evidence assembler; explicitly NOT a replacement for canonical balances.
-- Returns page IDs, separately scoped customer posted receipts and historical amounts.
-- Null means unavailable, never an estimated zero.
create or replace function public.transport_register_page_payment_evidence(p_trip_ids uuid[])
returns table(trip_id uuid, customer_posted_received numeric, customer_historical_received numeric,
  supplier_historical_paid numeric, supplier_historical_remaining numeric, customer_historical_remaining numeric)
language plpgsql stable security definer
set search_path to 'public','pg_temp'
set statement_timeout to '25s'
as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id();
declare loc uuid:=public.current_operating_location_id();
declare cv boolean:=public.transport_financial_read_allowed('customer');
declare sv boolean:=public.transport_financial_read_allowed('supplier');
begin
 if auth.uid() is null or c is null or b is null or loc is null
 or not public.has_module_permission(c,'transport','view') or not (cv or sv)
 then raise exception 'Active authorized financial workspace required'; end if;
 if p_trip_ids is null or cardinality(p_trip_ids) not between 1 and 100
 or (select count(distinct x.id) from unnest(p_trip_ids) x(id))<>cardinality(p_trip_ids)
 or (select count(*) from public.transport_trips t where t.id=any(p_trip_ids)
 and t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc)<>cardinality(p_trip_ids)
 then raise exception 'Invalid or out-of-scope Trip page'; end if;
 return query
 with selected as materialized (select t.id from public.transport_trips t
   where t.id=any(p_trip_ids) and t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc),
 customer as materialized (
   select x.trip_id,x.received_gross
   from public.transport_register_page_customer_received(p_trip_ids) x
   where cv
 ), historical as materialized (
   select x.* from public.transport_register_page_historical_payments(p_trip_ids) x
 )
 select s.id,
 case when cv then cr.received_gross end,
 case when cv then h.received_gross end,
 case when sv then h.paid_gross end,
 case when sv then h.supplier_remaining end,
 case when cv then h.customer_remaining end
 from selected s left join customer cr on cr.trip_id=s.id
 left join historical h on h.trip_id=s.id;
end $$;
revoke all on function public.transport_register_page_payment_evidence(uuid[]) from public;
grant execute on function public.transport_register_page_payment_evidence(uuid[]) to authenticated;
