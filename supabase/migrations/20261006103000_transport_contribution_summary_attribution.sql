begin;
-- Attribute each canonical contribution row directly by its own vehicle account.
-- Party movement event ids and contribution event ids are intentionally different
-- for multi-trip customer documents, so joining them by event_id loses revenue.
create or replace function public.transport_contribution_summary(p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare answer jsonb;c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
begin
 if not (public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')) then raise exception 'Both Transport financial view permissions required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission required';end if;
 with attributed as (
  select v.trip_id,v.event_date,v.revenue,v.cost,v.account_id,o.owner_type
  from public.transport_vehicle_contributions v
  left join public.transport_trips t on t.id=v.trip_id and t.company_id=c and t.business_unit_id=b
  left join public.transport_vehicle_ownership o on o.vehicle_id=v.account_id and o.company_id=v.company_id and o.business_unit_id=v.business_unit_id
   and o.effective_from<=t.trip_date and (o.effective_to is null or t.trip_date<=o.effective_to)
  where v.company_id=c and v.business_unit_id=b and v.operating_location_id=loc
   and (p_from is null or v.event_date>=p_from) and (p_to is null or v.event_date<=p_to)
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