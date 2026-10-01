-- Do not back-attribute a pre-history bill to an assignment first recorded later.
-- Such entries remain explicitly unattributed rather than guessing a vehicle.
create or replace view public.transport_vehicle_account_movements with(security_invoker=true) as
select m.*,a.vehicle_id account_id,a.vehicle_no_snapshot account_name,
 j.created_at attribution_at
from public.transport_party_movements m
join public.transport_party_document_sources d on d.side=m.side and d.order_id=m.order_id
join public.journal_entries j on j.id=d.journal_entry_id
join lateral (
 select a.vehicle_id,a.vehicle_no_snapshot from public.transport_trip_assignments a
 where cardinality(m.trip_ids)=1 and a.trip_id=m.trip_ids[1]
 and a.company_id=m.company_id and a.business_unit_id=m.business_unit_id
 and a.created_at<=j.created_at and a.effective_at<=j.created_at and (a.ended_at is null or j.created_at<a.ended_at)
 order by a.effective_at desc limit 1
) a on a.vehicle_id is not null;
grant select on public.transport_vehicle_account_movements to authenticated;


create or replace view public.transport_vehicle_contributions with(security_invoker=true) as
select m.event_id,m.company_id,m.business_unit_id,m.operating_location_id,m.trip_ids[1] trip_id,m.trip_no,
 m.account_id,m.account_name,m.event_date,m.entry_no,m.event_type,
 case when m.side='customer' then 'Revenue' when m.kind='rent' then 'Supplier rent' else 'Trip expense' end category,
 coalesce((select string_agg(distinct c.name,', ' order by c.name) from public.purchase_service_lines l
 join public.chart_of_accounts c on c.id=l.cost_account_id where l.order_id=m.order_id),'') expense_accounts,
 case when m.side='customer' then m.net_amount else 0 end revenue,
 case when m.side='supplier' then m.net_amount else 0 end cost
from public.transport_vehicle_account_movements m
where m.event_type in ('bill','credit_note','reversal_bill','reversal_credit_note')
union all
select m.event_id,m.company_id,m.business_unit_id,m.operating_location_id,m.trip_id,m.trip_no,
 a.vehicle_id,a.vehicle_no_snapshot,m.event_date,m.entry_no,m.event_type,'Driver pay','',0,m.amount
from public.transport_driver_account_movements m
join public.journal_entries source on source.id=m.journal_entry_id
join public.journal_entries original on original.id=coalesce(source.reversal_of_entry_id,source.id)
join lateral(select a.vehicle_id,a.vehicle_no_snapshot from public.transport_trip_assignments a
 where a.trip_id=m.trip_id and a.company_id=m.company_id and a.business_unit_id=m.business_unit_id
 and a.created_at<=original.created_at and a.effective_at<=original.created_at and (a.ended_at is null or original.created_at<a.ended_at)
 order by a.effective_at desc limit 1) a on a.vehicle_id is not null
where m.event_type in ('salary_accrual','reversal_salary_accrual');
grant select on public.transport_vehicle_contributions to authenticated;
