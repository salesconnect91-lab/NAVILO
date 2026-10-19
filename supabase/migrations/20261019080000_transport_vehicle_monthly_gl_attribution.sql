-- Production-safe report change: add posted vehicle GL attribution, never mutate journals.
DO $guard$
BEGIN
 IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='transport_vehicle_monthly_profit_report')
    IS DISTINCT FROM 'a721087bb1eb033edb69b3106da3982b'
 THEN RAISE EXCEPTION 'Monthly Vehicle P&L function drift: migration aborted'; END IF;
END $guard$;

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
  has_trips boolean:=false;
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
  -- Preserve low-cost zero-Trips execution while also reading posted vehicle-tagged GL.
  select exists(select 1 from public.transport_trips t
    where t.company_id=c and t.business_unit_id=b
      and t.operating_location_id=loc) into has_trips;
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
    select rows.account_id as vehicle_id,date_trunc('month',rows.event_date)::date as event_month,
      round(sum(coalesce(rows.revenue,0)),2)::numeric as revenue,
      round(sum(coalesce(rows.cost,0)),2)::numeric as cost
    from (
      -- Existing Trip/service and normal invoice contributions remain canonical.
      select p.account_id,p.event_date,p.revenue,p.cost
      from public.transport_vehicle_contributions p
      where has_trips and p.company_id=c and p.business_unit_id=b
        and p.operating_location_id=loc and p.account_id is not null
      union all
      -- Independent posted GL adjustments and vehicle expense reversals.
      -- Cutover journal is excluded: it appears only in the historical branch.
      select l.transport_vehicle_id as account_id,j.entry_date as event_date,
        (case when a.type in ('revenue','income') then l.credit-l.debit else 0 end)::numeric as revenue,
        (case when a.type='expense' then l.debit-l.credit else 0 end)::numeric as cost
      from public.journal_lines l
      join public.journal_entries j on j.id=l.entry_id
        and j.company_id=l.company_id and j.business_unit_id=l.business_unit_id
        and j.status='posted'
      join public.chart_of_accounts a on a.id=l.account_id and a.company_id=l.company_id
        and a.type in ('revenue','income','expense')
      where l.company_id=c and l.business_unit_id=b and l.operating_location_id=loc
        and j.operating_location_id=loc and l.transport_vehicle_id is not null
        and coalesce(j.source_module,'') in ('','accounting')
        and coalesce(j.source_document_type,'')<>'cutover_opening_balances'
        and j.fiscal_year_closure_id is null and j.monthly_profit_closure_id is null
        and coalesce(j.trans_type,'') in ('','Journal Entry','Manual Journal','Journal Reversal')
        and not exists (
          select 1 from public.transport_vehicle_contributions prior
          where prior.event_id='vehicle-manual:'||l.id::text
            and prior.company_id=c and prior.business_unit_id=b
            and prior.operating_location_id=loc
        )
    ) rows
    group by rows.account_id,date_trunc('month',rows.event_date)::date
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
end $function$;
