begin;
create or replace function public.transport_contribution_summary(p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare answer jsonb;c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
begin
 if not (public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')) then raise exception 'Both Transport financial view permissions required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission required';end if;
 with contribution_rows as (
  select v.trip_id,v.event_date,v.revenue,v.cost,v.account_id,v.entry_no
  from public.transport_vehicle_contributions v
  where v.company_id=c and v.business_unit_id=b and v.operating_location_id=loc
   and (p_from is null or v.event_date>=p_from) and (p_to is null or v.event_date<=p_to)
 ),missing_customer_revenue as (
  select tid trip_id,m.event_date,
   case when cardinality(m.trip_ids)=1 then m.net_amount
        else coalesce((select case when m.event_type in ('credit_note','reversal_bill') then -l.amount else l.amount end
          from public.sales_service_lines l where l.order_id=m.order_id and l.source_module='transport_trip' and l.source_id=tid limit 1),0) end revenue,
   0::numeric cost,t.vehicle_id account_id,m.entry_no
  from public.transport_party_movements m cross join lateral unnest(m.trip_ids) tid
  join public.transport_trips t on t.id=tid and t.company_id=c and t.business_unit_id=b
  where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc and m.side='customer'
   and m.event_type in ('bill','credit_note','reversal_bill','reversal_credit_note')
   and (p_from is null or m.event_date>=p_from) and (p_to is null or m.event_date<=p_to)
   and not exists(select 1 from contribution_rows v where v.trip_id=tid and v.entry_no=m.entry_no and v.revenue<>0)
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
end $$;
revoke all on function public.transport_contribution_summary(date,date) from public,anon;
grant execute on function public.transport_contribution_summary(date,date) to authenticated;
notify pgrst,'reload schema';
commit;