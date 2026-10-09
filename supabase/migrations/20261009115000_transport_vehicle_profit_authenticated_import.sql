-- Authenticated, auditable import queue for already posted historical vehicle profit.
-- Owner/admin approval is required in NAVILO; the migration does NOT create vehicle masters.
begin;
create table if not exists public.transport_vehicle_profit_import_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  business_unit_id uuid not null references public.business_units(id),
  vehicle_no text not null,
  truck_type_name text not null,
  confirmed_owned_on date not null,
  profit_month date not null,
  net_profit numeric(18,2) not null,
  source_journal_line_id uuid not null unique references public.journal_lines(id),
  status text not null default 'pending' check(status in ('pending','linked')),
  linked_vehicle_id uuid null references public.transport_vehicles(id),
  linked_at timestamptz,
  linked_by uuid,
  created_at timestamptz not null default now(),
  constraint tvpi_month_first check(profit_month=date_trunc('month',profit_month)::date),
  constraint tvpi_net_nonzero check(net_profit<>0),
  constraint tvpi_name_nonempty check(btrim(vehicle_no)<>'' and btrim(truck_type_name)<>''),
  constraint tvpi_scoped_plate_month unique(company_id,business_unit_id,vehicle_no,profit_month)
);
create index if not exists tvpi_company_status_idx on public.transport_vehicle_profit_import_queue(company_id,business_unit_id,status);
alter table public.transport_vehicle_profit_import_queue enable row level security;
revoke all on public.transport_vehicle_profit_import_queue from public,anon,authenticated;
grant select on public.transport_vehicle_profit_import_queue to authenticated;
drop policy if exists tvpi_owner_select on public.transport_vehicle_profit_import_queue;
create policy tvpi_owner_select on public.transport_vehicle_profit_import_queue for select to authenticated
using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
  and public.has_module_permission(company_id,'accounting','view')
  and public.has_module_permission(company_id,'transport','view'));

create or replace function public.transport_vehicle_profit_import_apply()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  row_import public.transport_vehicle_profit_import_queue%rowtype;
  type_id uuid; v uuid; source_net numeric; matched integer:=0;
  owner_period_ok boolean;
  source_label text;
  applied jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or c is null or b is null
    or public.current_operating_location_id() is null
    or not public.has_transport_action_permission(c,'master_manage')
    or not public.has_transport_action_permission(c,'vehicle_owner_change')
    or not public.has_module_permission(c,'accounting','view')
  then raise exception 'Authorized Transport owner/master and accounting permissions required';end if;
  perform pg_advisory_xact_lock(hashtextextended('historical-vehicle-profit:'||c||':'||b,0));
  for row_import in
    select * from public.transport_vehicle_profit_import_queue q
    where q.company_id=c and q.business_unit_id=b and q.status='pending'
    order by q.vehicle_no for update
  loop
    select round(l.credit-l.debit,2),a.name into source_net,source_label
    from public.journal_lines l
    join public.journal_entries j on j.id=l.entry_id
      and j.company_id=c and j.business_unit_id=b and j.status='posted'
      and j.source_document_type='cutover_opening_balances'
    join public.chart_of_accounts a on a.id=l.account_id
      and a.company_id=c and a.type='equity'
    where l.id=row_import.source_journal_line_id
      and l.company_id=c and l.business_unit_id=b
      and j.entry_date=(row_import.confirmed_owned_on+interval '1 day')::date
      and lower(a.name) like '%undistributed profit%';
    if source_net is null or source_net<>row_import.net_profit then
      raise exception 'Opening journal source mismatch for vehicle %',row_import.vehicle_no;
    end if;
    select t.id into type_id from public.transport_truck_types t
    where t.company_id=c and t.business_unit_id=b
      and lower(btrim(t.name))=lower(btrim(row_import.truck_type_name))
      and t.is_active order by t.id limit 1;
    if type_id is null then
      insert into public.transport_truck_types(company_id,business_unit_id,name)
      values(c,b,btrim(row_import.truck_type_name)) returning id into type_id;
    end if;
    select t.id into v from public.transport_vehicles t where t.company_id=c
      and t.business_unit_id=b
      and public.transport_master_normalized_key(t.vehicle_no)
        =public.transport_master_normalized_key(row_import.vehicle_no)
    limit 1;
    if v is null then
      -- Canonical authenticated master RPC creates vehicle and owner history atomically.
      v:=public.transport_create_vehicle_master(
        row_import.vehicle_no,type_id,'company',null,row_import.confirmed_owned_on);
    else
      select exists(select 1 from public.transport_vehicle_ownership o
        where o.vehicle_id=v and o.company_id=c and o.business_unit_id=b
          and o.owner_type='company'
          and o.effective_from<=row_import.confirmed_owned_on
          and (o.effective_to is null or o.effective_to>=row_import.confirmed_owned_on))
      into owner_period_ok;
      if not owner_period_ok then
        raise exception 'Vehicle % has no confirmed company-owned period on closing date',row_import.vehicle_no;
      end if;
    end if;
    if exists(select 1 from public.transport_vehicle_historical_profits h
      where h.source_journal_line_id=row_import.source_journal_line_id) then
      raise exception 'Opening journal line already attributed; avoid duplicate';
    end if;
    insert into public.transport_vehicle_historical_profits(
      company_id,business_unit_id,vehicle_id,month,net_profit,source_journal_line_id,source_description)
    values(c,b,v,row_import.profit_month,row_import.net_profit,
      row_import.source_journal_line_id,
      'Historical vehicle NET from already-posted opening journal; attribution only, no duplicate income.');
    update public.transport_vehicle_profit_import_queue
    set status='linked',linked_vehicle_id=v,linked_at=now(),linked_by=auth.uid()
    where id=row_import.id and status='pending';
    applied:=applied||jsonb_build_array(jsonb_build_object(
      'vehicle_no',row_import.vehicle_no,'vehicle_id',v,'net_profit',row_import.net_profit));
    matched:=matched+1;
  end loop;
  return jsonb_build_object('linked_count',matched,'vehicles',applied,'new_journals',0);
end $$;
revoke all on function public.transport_vehicle_profit_import_apply() from public,anon;
grant execute on function public.transport_vehicle_profit_import_apply() to authenticated;
comment on function public.transport_vehicle_profit_import_apply() is
'Owner-authorized, source-validated company vehicle master + historical profit attribution. Never posts journal or allocates partner shares.';
commit;