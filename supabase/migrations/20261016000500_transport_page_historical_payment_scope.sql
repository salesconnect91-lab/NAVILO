-- Additive page-level historical payment evidence reader.
-- Never sum these values onto canonical posted payments without checking mode:
-- transport_financial_register selects either posted or historical evidence.
create or replace function public.transport_register_page_historical_payments(p_trip_ids uuid[])
returns table(trip_id uuid, received_gross numeric, paid_gross numeric, supplier_remaining numeric, customer_remaining numeric)
language plpgsql stable security definer
set search_path to 'public','pg_temp'
set statement_timeout to '15s'
as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id();
declare cv boolean:=public.transport_financial_read_allowed('customer'); sv boolean:=public.transport_financial_read_allowed('supplier');
begin
 if auth.uid() is null or c is null or b is null or loc is null
   or not public.has_module_permission(c,'transport','view') or not (cv or sv)
 then raise exception 'Transport financial view and active workspace required'; end if;
 if p_trip_ids is null or cardinality(p_trip_ids) not between 1 and 100
 or (select count(distinct x.id) from unnest(p_trip_ids) x(id))<>cardinality(p_trip_ids)
 or (select count(*) from public.transport_trips t where t.id=any(p_trip_ids)
   and t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc)<>cardinality(p_trip_ids)
 then raise exception 'Invalid or out-of-scope Trip page'; end if;
 return query
 select h.trip_id,
   case when cv then h.received_gross end,
   case when sv then h.paid_gross end,
   case when sv then h.supplier_remaining_effective end,
   case when cv then h.customer_remaining_effective end
 from public.transport_historical_payment_effective h
 where h.trip_id=any(p_trip_ids) and h.company_id=c
   and h.business_unit_id=b and h.operating_location_id=loc;
end $$;
revoke all on function public.transport_register_page_historical_payments(uuid[]) from public;
grant execute on function public.transport_register_page_historical_payments(uuid[]) to authenticated;
