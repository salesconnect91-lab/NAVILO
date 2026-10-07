begin;
create or replace view public.transport_driver_month_trip_costs with (security_invoker=true) as
select 'driver-month-trip:'||cl.id::text||':'||t.id::text event_id,cl.company_id,cl.business_unit_id,cl.operating_location_id,cl.id closing_id,cl.journal_entry_id,t.id trip_id,t.trip_no,t.trip_date,cl.employee_id,a.vehicle_id account_id,a.vehicle_no_snapshot account_name,round(coalesce(t.driver_pay,0),2) amount,'Driver pay'::text category
from public.transport_driver_month_closings cl join public.transport_drivers d on d.company_id=cl.company_id and d.business_unit_id=cl.business_unit_id and d.employee_id=cl.employee_id and lower(coalesce(d.driver_type,''))='company' and d.supplier_id is null
join public.transport_trips t on t.company_id=cl.company_id and t.business_unit_id=cl.business_unit_id and t.operating_location_id=cl.operating_location_id and t.driver_id=d.id and t.trip_date>=cl.month and t.trip_date<(cl.month+interval '1 month')::date and coalesce(t.driver_pay,0)>0
join public.journal_entries j on j.id=cl.journal_entry_id and j.status='posted'
join lateral(select x.vehicle_id,x.vehicle_no_snapshot from public.transport_trip_assignments x where x.trip_id=t.id and x.company_id=cl.company_id and x.business_unit_id=cl.business_unit_id and x.effective_at<=t.trip_date::timestamptz and (x.ended_at is null or t.trip_date::timestamptz<x.ended_at) order by x.effective_at desc limit 1)a on a.vehicle_id is not null
join public.transport_vehicle_ownership o on o.id=t.ownership_id and o.vehicle_id=a.vehicle_id and o.company_id=cl.company_id and o.business_unit_id=cl.business_unit_id and lower(coalesce(o.owner_type,'')) in ('company','company_owned','owned','self')
where cl.company_id=public.current_company_id() and cl.business_unit_id=public.current_business_unit_id() and cl.operating_location_id=public.current_operating_location_id() and public.has_module_permission(cl.company_id,'transport','view');
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
legacy_driver_costs as (
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
union all select * from legacy_driver_costs
union all
select x.event_id,x.company_id,x.business_unit_id,x.operating_location_id,x.trip_id,x.trip_no,x.account_id,x.account_name,x.trip_date event_date,j.entry_no,'driver_month_closing'::text event_type,x.category,''::text expense_accounts,0::numeric revenue,x.amount cost
from public.transport_driver_month_trip_costs x join public.journal_entries j on j.id=x.journal_entry_id;

comment on view public.transport_vehicle_contributions is 'Posted Transport vehicle economics, including exact Trip-level Driver Khata pay for historically company-owned vehicles.';
commit;
