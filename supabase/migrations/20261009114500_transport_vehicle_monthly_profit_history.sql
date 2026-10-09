-- Read-only, source-linked historical vehicle profit plus posted monthly operating economics.
-- No journal mutation, no partner allocation, no income recognition.
begin;
create table if not exists public.transport_vehicle_historical_profits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  business_unit_id uuid not null references public.business_units(id),
  vehicle_id uuid not null,
  month date not null,
  net_profit numeric(18,2) not null,
  source_journal_line_id uuid not null unique references public.journal_lines(id) on delete restrict,
  source_description text not null,
  created_at timestamptz not null default now(),
  constraint tvhp_scope_vehicle_fk foreign key (company_id,business_unit_id,vehicle_id)
    references public.transport_vehicles(company_id,business_unit_id,id),
  constraint tvhp_unique_month unique(company_id,business_unit_id,vehicle_id,month),
  constraint tvhp_month_start check (month=date_trunc('month',month)::date),
  constraint tvhp_nonzero check (net_profit<>0),
  constraint tvhp_source_description check (length(btrim(source_description))>=12)
);
create index if not exists tvhp_scope_month_idx
  on public.transport_vehicle_historical_profits(company_id,business_unit_id,month,vehicle_id);
alter table public.transport_vehicle_historical_profits enable row level security;
revoke all on public.transport_vehicle_historical_profits from public,anon,authenticated;
grant select on public.transport_vehicle_historical_profits to authenticated;
drop policy if exists tvhp_select on public.transport_vehicle_historical_profits;
create policy tvhp_select on public.transport_vehicle_historical_profits for select to authenticated
using(company_id=public.current_company_id()
  and business_unit_id=public.current_business_unit_id()
  and public.has_module_permission(company_id,'transport','view')
  and public.has_module_permission(company_id,'accounting','view'));
create or replace function public.transport_vehicle_monthly_profit_report(
  p_from date default null,p_to date default null)
returns table(
  vehicle_id uuid,vehicle_no text,month date,
  historical_net numeric,posted_revenue numeric,posted_cost numeric,
  net_profit numeric,source_kind text)
language plpgsql stable security definer set search_path=public,pg_temp
as $$
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
end $$;
revoke all on function public.transport_vehicle_monthly_profit_report(date,date) from public,anon;
grant execute on function public.transport_vehicle_monthly_profit_report(date,date) to authenticated;
comment on table public.transport_vehicle_historical_profits is
'Immutable-for-clients attribution of already posted opening GL lines to company-owned vehicles; informational only, not another journal.';
comment on function public.transport_vehicle_monthly_profit_report(date,date) is
'Monthly vehicle economics: historical posted opening net supersedes reconstructed posted operations for that same vehicle/month, preventing double counting.';
commit;