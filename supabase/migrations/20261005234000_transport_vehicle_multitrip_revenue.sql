-- Attribute posted multi-Trip customer service invoice revenue to each saved Trip/Vehicle.
-- Accounting journals remain canonical and unchanged; this view is reporting attribution only.
create or replace view public.transport_vehicle_contributions
with (security_invoker=true)
as
with customer_lines as (
  select
    ('vehicle-line:'||m.event_id||':'||l.id::text) as event_id,
    m.company_id,m.business_unit_id,m.operating_location_id,
    t.id as trip_id,t.trip_no,
    a.vehicle_id as account_id,a.vehicle_no_snapshot as account_name,
    m.event_date,m.entry_no,m.event_type,
    'Revenue'::text as category,''::text as expense_accounts,
    case
      when m.event_type in ('credit_note','reversal_bill') then -l.amount
      when m.event_type in ('bill','reversal_credit_note') then l.amount
      else 0::numeric
    end as revenue,
    0::numeric as cost
  from public.transport_party_movements m
  join public.sales_service_lines l
    on m.side='customer' and l.order_id=m.order_id
   and l.source_module='transport_trip' and l.source_id=any(m.trip_ids)
  join public.transport_trips t on t.id=l.source_id
  join public.journal_entries j on j.id=m.journal_entry_id
  join lateral (
    select x.vehicle_id,x.vehicle_no_snapshot
    from public.transport_trip_assignments x
    where x.trip_id=t.id and x.company_id=m.company_id and x.business_unit_id=m.business_unit_id
      and x.created_at<=j.created_at and x.effective_at<=j.created_at
      and (x.ended_at is null or j.created_at<x.ended_at)
    order by x.effective_at desc limit 1
  ) a on a.vehicle_id is not null
  where m.event_type in ('bill','credit_note','reversal_bill','reversal_credit_note')
),
supplier_docs as (
 select m.event_id,m.company_id,m.business_unit_id,m.operating_location_id,m.trip_ids[1] trip_id,m.trip_no,
   m.account_id,m.account_name,m.event_date,m.entry_no,m.event_type,
   case when m.kind='rent' then 'Supplier rent' else 'Trip expense' end category,
   coalesce((select string_agg(distinct c.name,', ' order by c.name)
     from public.purchase_service_lines l join public.chart_of_accounts c on c.id=l.cost_account_id
     where l.order_id=m.order_id),'') expense_accounts,
   0::numeric revenue,m.net_amount cost
 from public.transport_vehicle_account_movements m
 where m.side='supplier' and m.event_type in ('bill','credit_note','reversal_bill','reversal_credit_note')
),
driver_costs as (
 select m.event_id,m.company_id,m.business_unit_id,m.operating_location_id,m.trip_id,m.trip_no,
   a.vehicle_id account_id,a.vehicle_no_snapshot account_name,m.event_date,m.entry_no,m.event_type,
   'Driver pay'::text category,''::text expense_accounts,0::numeric revenue,m.amount cost
 from public.transport_driver_account_movements m
 join public.journal_entries source on source.id=m.journal_entry_id
 join public.journal_entries original on original.id=coalesce(source.reversal_of_entry_id,source.id)
 join lateral (
   select x.vehicle_id,x.vehicle_no_snapshot from public.transport_trip_assignments x
   where x.trip_id=m.trip_id and x.company_id=m.company_id and x.business_unit_id=m.business_unit_id
     and x.created_at<=original.created_at and x.effective_at<=original.created_at
     and (x.ended_at is null or original.created_at<x.ended_at)
   order by x.effective_at desc limit 1
 ) a on a.vehicle_id is not null
 where m.event_type in ('salary_accrual','reversal_salary_accrual')
)
select * from customer_lines
union all select * from supplier_docs
union all select * from driver_costs;

comment on view public.transport_vehicle_contributions is
'Posted Transport vehicle economics. Customer service revenue is attributed per canonical sales_service_line source Trip, so multi-Trip invoices reconcile without duplicate revenue.';
