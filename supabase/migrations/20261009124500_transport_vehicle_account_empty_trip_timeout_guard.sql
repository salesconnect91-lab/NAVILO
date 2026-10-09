-- Performance guard for empty Transport company/branch in Gari Hisaab.
-- Existing auth, source journal evidence, dates, financial permissions preserved.
-- No edits to journals, vehicles, profit or balances.
begin;
CREATE OR REPLACE FUNCTION public.transport_account_report_page(p_kind text, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb; begin if not (public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')) then raise exception 'Both Transport financial view permissions required';end if; if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active Company/Business Unit/branch required';end if; if p_kind='driver' and not public.has_module_permission(c,'accounting','view') then raise exception 'Accounting view permission required for payroll detail';end if; if p_kind in ('vehicle','contributions') and not exists(
 select 1 from public.transport_trips t where t.company_id=c and t.business_unit_id=b
 and t.operating_location_id=loc
) then return '[]'::jsonb; end if;
if p_kind='driver' then select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select m.* from public.transport_driver_account_movements m where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc and exists(select 1 from public.transport_drivers d where d.company_id=c and d.business_unit_id=b and d.employee_id=m.employee_id and d.is_active and lower(coalesce(d.driver_type,''))='company' and d.supplier_id is null) order by m.event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q; elsif p_kind='vehicle' then select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select m.* from public.transport_vehicle_account_movements m join public.transport_trips t on cardinality(m.trip_ids)=1 and t.id=m.trip_ids[1] and t.company_id=c and t.business_unit_id=b join public.transport_vehicle_ownership o on o.id=t.ownership_id and o.vehicle_id=m.account_id and o.company_id=c and o.business_unit_id=b where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc and lower(coalesce(o.owner_type,'')) in ('company','company_owned','owned','self') order by m.event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q; elsif p_kind='contributions' then select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select x.* from public.transport_vehicle_contributions x join public.transport_trips t on t.id=x.trip_id and t.company_id=c and t.business_unit_id=b join public.transport_vehicle_ownership o on o.id=t.ownership_id and o.vehicle_id=x.account_id and o.company_id=c and o.business_unit_id=b where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc and lower(coalesce(o.owner_type,'')) in ('company','company_owned','owned','self') and (x.category<>'Driver pay' or public.has_module_permission(c,'accounting','view')) order by x.event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q; else raise exception 'Invalid account report kind';end if; return answer; end $function$

CREATE OR REPLACE FUNCTION public.transport_vehicle_monthly_profit_report(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(vehicle_id uuid, vehicle_no text, month date, historical_net numeric, posted_revenue numeric, posted_cost numeric, net_profit numeric, source_kind text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  loc uuid:=public.current_operating_location_id();
begin
  if auth.uid() is null or c is null or b is null or loc is null
     or not public.has_module_permission(c,'transport','view')
     or not public.has_module_permission(c,'accounting','view')
     or not public.transport_financial_read_allowed('customer')
     or not public.transport_financial_read_allowed('supplier')
  then raise exception 'Company vehicle profit view and accounting permissions required'; end if;
  if p_from is not null and p_to is not null and p_from>p_to
  then raise exception 'From must be on or before To'; end if;
  -- A fresh business may carry audited opening fleet profits before its first Trip.
  -- The operational contribution view joins many financial tables; do not execute
  -- it when the scoped branch has no Trips. Keep posted GL proof and owner dates.
  if not exists(select 1 from public.transport_trips t
       where t.company_id=c and t.business_unit_id=b
         and t.operating_location_id=loc) then
    return query
    select v.id,v.vehicle_no::text,h.month,
      h.net_profit::numeric,0::numeric,0::numeric,
      h.net_profit::numeric,'historical_opening'::text
    from public.transport_vehicle_historical_profits h
    join public.transport_vehicles v on v.id=h.vehicle_id
       and v.company_id=c and v.business_unit_id=b
    join public.journal_lines l on l.id=h.source_journal_line_id
       and l.company_id=c and l.business_unit_id=b
       and round(l.credit-l.debit,2)=h.net_profit
    join public.journal_entries j on j.id=l.entry_id
       and j.company_id=c and j.business_unit_id=b
       and j.status='posted' and j.source_document_type='cutover_opening_balances'
    where h.company_id=c and h.business_unit_id=b
      and (p_from is null or h.month>=date_trunc('month',p_from)::date)
      and (p_to is null or h.month<=date_trunc('month',p_to)::date)
      and exists(select 1 from public.transport_vehicle_ownership o
        where o.vehicle_id=v.id and o.company_id=c and o.business_unit_id=b
         and o.owner_type='company'
         and o.effective_from<=(h.month+interval '1 month - 1 day')::date
         and (o.effective_to is null or o.effective_to>=h.month))
    order by h.month desc,v.vehicle_no;
    return;
  end if;
  return query
  with historical as (
    select h.vehicle_id, h.month, sum(h.net_profit)::numeric as net
    from public.transport_vehicle_historical_profits h
    join public.journal_lines l on l.id=h.source_journal_line_id
      and l.company_id=c and l.business_unit_id=b
      and round(l.credit-l.debit,2)=h.net_profit
    join public.journal_entries j on j.id=l.entry_id
      and j.company_id=c and j.business_unit_id=b and j.status='posted'
      and j.source_document_type='cutover_opening_balances'
    where h.company_id=c and h.business_unit_id=b
    group by h.vehicle_id,h.month
  ),
  operational as (
    select p.account_id as vehicle_id,date_trunc('month',p.event_date)::date as event_month,
      round(sum(coalesce(p.revenue,0)),2)::numeric as revenue,
      round(sum(coalesce(p.cost,0)),2)::numeric as cost
    from public.transport_vehicle_contributions p
    where p.company_id=c and p.business_unit_id=b
      and p.operating_location_id=loc and p.account_id is not null
    group by p.account_id,date_trunc('month',p.event_date)::date
  ),
  period_keys as (
    select h.vehicle_id,h.month from historical h
    union select p.vehicle_id,p.event_month from operational p
  )
  select v.id,v.vehicle_no::text,k.month,
    coalesce(h.net,0)::numeric,
    coalesce(p.revenue,0)::numeric,
    coalesce(p.cost,0)::numeric,
    (case when h.vehicle_id is not null then h.net
      else coalesce(p.revenue,0)-coalesce(p.cost,0) end)::numeric,
    (case when h.vehicle_id is not null then 'historical_opening'
      else 'posted_operations' end)::text
  from period_keys k
  join public.transport_vehicles v on v.id=k.vehicle_id
    and v.company_id=c and v.business_unit_id=b
  left join historical h on h.vehicle_id=k.vehicle_id and h.month=k.month
  left join operational p on p.vehicle_id=k.vehicle_id and p.event_month=k.month
  where (p_from is null or k.month>=date_trunc('month',p_from)::date)
    and (p_to is null or k.month<=date_trunc('month',p_to)::date)
    and exists(select 1 from public.transport_vehicle_ownership o
      where o.vehicle_id=v.id and o.company_id=c and o.business_unit_id=b
        and o.owner_type='company'
        and o.effective_from<=(k.month+interval '1 month - 1 day')::date
        and (o.effective_to is null or o.effective_to>=k.month))
  order by k.month desc,v.vehicle_no;
end $function$

commit;
