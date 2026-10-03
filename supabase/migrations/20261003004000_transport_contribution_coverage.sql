-- Preserve full posted source amounts when original vehicle provenance is absent.
-- No current vehicle is substituted for a missing historical assignment.
begin;
create or replace function public.transport_contribution_summary(p_from date,p_to date)
returns jsonb language plpgsql security invoker stable set search_path=public,pg_temp as $$
declare answer jsonb;
begin
 if auth.uid() is null or not public.has_module_permission(public.current_company_id(),'transport','view') then raise exception 'Transport view permission required';end if;
 with sources as (
 select m.event_id,m.trip_ids[1] trip_id,m.event_date,m.company_id,m.business_unit_id,
 case when m.side='customer' then m.net_amount else 0 end revenue,
 case when m.side='supplier' then m.net_amount else 0 end cost
 from public.transport_party_movements m
 where m.event_type in ('bill','credit_note','reversal_bill','reversal_credit_note')
 union all
 select m.event_id,m.trip_id,m.event_date,m.company_id,m.business_unit_id,0,m.amount
 from public.transport_driver_account_movements m where m.event_type in ('salary_accrual','reversal_salary_accrual')
 ), attributed as (
 select src.*,v.account_id,o.owner_type from sources src
 left join public.transport_vehicle_contributions v on v.event_id=src.event_id
 left join public.transport_trips t on t.id=src.trip_id
 left join public.transport_vehicle_ownership o on o.vehicle_id=v.account_id and o.company_id=src.company_id and o.business_unit_id=src.business_unit_id
 and o.effective_from<=t.trip_date and (o.effective_to is null or t.trip_date<=o.effective_to)
 where (p_from is null or src.event_date>=p_from) and (p_to is null or src.event_date<=p_to)
 )
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
 select coalesce(owner_type,'unattributed') ownership,count(distinct case when account_id is not null then trip_id end) trips,
 sum(revenue) revenue,sum(cost) cost,sum(revenue-cost) profit
 from attributed group by coalesce(owner_type,'unattributed')
 ) q;return answer;
end $$;
revoke all on function public.transport_contribution_summary(date,date) from public,anon;
grant execute on function public.transport_contribution_summary(date,date) to authenticated;
commit;
