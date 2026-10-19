-- Pre-filter Transport contribution views exactly once and replace per-trip scalar subqueries with indexed joins.
-- Do not change monetary signs, ownership attribution, or returned JSON shape.
DO $guard$ BEGIN
 IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='transport_contribution_summary')
 IS DISTINCT FROM 'e7819fe858a0130fc609510e1d10bf90'
 THEN RAISE EXCEPTION 'transport_contribution_summary changed: migration refused'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.transport_contribution_summary(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare answer jsonb;c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
begin
 if not (public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')) then raise exception 'Both Transport financial view permissions required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission required';end if;
 with contribution_rows as materialized (
  select v.trip_id,v.event_date,v.revenue,v.cost,v.account_id,v.entry_no
  from public.transport_vehicle_contributions v
  where v.company_id=c and v.business_unit_id=b and v.operating_location_id=loc
   and (p_from is null or v.event_date>=p_from) and (p_to is null or v.event_date<=p_to)
 ), customer_revenue_keys as materialized (
  select distinct trip_id,entry_no from contribution_rows where revenue<>0 and trip_id is not null
 ), customer_movements as materialized (
  select m.trip_ids,m.event_date,m.net_amount,m.event_type,m.entry_no,m.order_id
  from public.transport_party_movements m
  where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc and m.side='customer'
    and m.event_type in ('bill','credit_note','reversal_bill','reversal_credit_note')
    and (p_from is null or m.event_date>=p_from) and (p_to is null or m.event_date<=p_to)
 ), missing_customer_revenue as (
  select tid trip_id,m.event_date,
   case when cardinality(m.trip_ids)=1 then m.net_amount
        else coalesce(case when m.event_type in ('credit_note','reversal_bill') then -l.amount else l.amount end,0) end revenue,
   0::numeric cost,t.vehicle_id account_id,m.entry_no
  from customer_movements m
  cross join lateral unnest(m.trip_ids) tid
  join public.transport_trips t on t.id=tid and t.company_id=c and t.business_unit_id=b
  left join public.sales_service_lines l
    on l.order_id=m.order_id and l.source_module='transport_trip' and l.source_id=tid
  left join customer_revenue_keys k on k.trip_id=tid and k.entry_no=m.entry_no
  where k.trip_id is null
 ),sources as (
  select trip_id,event_date,revenue,cost,account_id from contribution_rows
  union all select trip_id,event_date,revenue,cost,account_id from missing_customer_revenue where revenue<>0
 ),attributed as (
  select s.*,o.owner_type from sources s
  left join public.transport_trips t on t.id=s.trip_id and t.company_id=c and t.business_unit_id=b
  left join public.transport_vehicle_ownership o on o.vehicle_id=s.account_id and o.company_id=c and o.business_unit_id=b
   and o.effective_from<=t.trip_date and (o.effective_to is null or t.trip_date<=o.effective_to)
 )
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
  select coalesce(owner_type,'unattributed') ownership,count(distinct case when account_id is not null then trip_id end) trips,
   coalesce(sum(revenue),0) revenue,coalesce(sum(cost),0) cost,coalesce(sum(revenue-cost),0) profit
  from attributed group by coalesce(owner_type,'unattributed')
 ) q;
 return answer;
end $function$;
