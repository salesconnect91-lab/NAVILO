-- Initial entry is deliberately separate from the reasoned correction RPC.
create function public.transport_finalize_initial_customer_rate(p_trip_id uuid,p_amount numeric)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;
begin
 select * into t from public.transport_trips where id=p_trip_id for update;
 if not found or t.company_id is distinct from public.current_company_id()
 or t.business_unit_id is distinct from public.current_business_unit_id() then raise exception 'Trip outside active business';end if;
 if not public.has_transport_action_permission(t.company_id,'customer_rate_finalize') then raise exception 'Rate finalization permission required';end if;
 if t.customer_rate_state='finalized' then raise exception 'Rate already finalized. Open the controlled rate correction workflow.';end if;
 if t.sales_order_id is not null or exists(select 1 from public.transport_customer_document_trips where trip_id=t.id) then raise exception 'Posted billing requires a controlled rate adjustment';end if;
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<0 or round(p_amount,2)<>p_amount then raise exception 'Enter a nonnegative rate with at most two decimal places';end if;
 perform public.transport_finalize_customer_rate(p_trip_id,p_amount,'manual','Initial rate from Trips');
end $$;
revoke all on function public.transport_finalize_initial_customer_rate(uuid,numeric) from public,anon;
grant execute on function public.transport_finalize_initial_customer_rate(uuid,numeric) to authenticated;

-- Use the assignment at ORIGINAL bill posting, also for later settlements,
-- credits and reversals. Never fall back to the Trip's current vehicle.
create view public.transport_vehicle_account_movements with(security_invoker=true) as
select m.*,a.vehicle_id account_id,a.vehicle_no_snapshot account_name,
 j.created_at attribution_at
from public.transport_party_movements m
join public.transport_party_document_sources d on d.side=m.side and d.order_id=m.order_id
join public.journal_entries j on j.id=d.journal_entry_id
join lateral (
 select a.vehicle_id,a.vehicle_no_snapshot from public.transport_trip_assignments a
 where cardinality(m.trip_ids)=1 and a.trip_id=m.trip_ids[1]
 and a.company_id=m.company_id and a.business_unit_id=m.business_unit_id
 and a.effective_at<=j.created_at and (a.ended_at is null or j.created_at<a.ended_at)
 order by a.effective_at desc limit 1
) a on a.vehicle_id is not null;
grant select on public.transport_vehicle_account_movements to authenticated;

-- Attachment replacement/clear is a received-document action and is audited.
create function public.transport_audit_ppr_attachment() returns trigger language plpgsql
security definer set search_path=public,pg_temp as $$
begin
 if (new.ppr_attachment_path,new.ppr_status,new.ppr_received_date,new.ppr_received_by_employee_id) is distinct from (old.ppr_attachment_path,old.ppr_status,old.ppr_received_date,old.ppr_received_by_employee_id) then
  if not public.has_transport_action_permission(new.company_id,'ppr_receive') then raise exception 'PPR receipt permission required';end if;
  insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
  values(new.company_id,new.business_unit_id,new.id,new.trip_no,case when new.ppr_attachment_path is distinct from old.ppr_attachment_path then 'ppr_attachment_change' else 'ppr_receipt_change' end,jsonb_build_object('path',old.ppr_attachment_path,'status',old.ppr_status,'employee',old.ppr_received_by_employee_id,'date',old.ppr_received_date),jsonb_build_object('path',new.ppr_attachment_path,'status',new.ppr_status,'employee',new.ppr_received_by_employee_id,'date',new.ppr_received_date),'PPR receipt changed',auth.uid());
 end if;
 return new;
end $$;
create trigger transport_ppr_attachment_audit after update of ppr_attachment_path,ppr_status,ppr_received_date,ppr_received_by_employee_id on public.transport_trips
for each row execute function public.transport_audit_ppr_attachment();
revoke all on function public.transport_audit_ppr_attachment() from public,anon,authenticated;

-- Economic contributions exclude cash settlements and VAT. Source account
-- names are retained instead of guessing fuel/repair categories from amounts.
create view public.transport_vehicle_contributions with(security_invoker=true) as
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
 and a.effective_at<=original.created_at and (a.ended_at is null or original.created_at<a.ended_at)
 order by a.effective_at desc limit 1) a on a.vehicle_id is not null
where m.event_type in ('salary_accrual','reversal_salary_accrual');
grant select on public.transport_vehicle_contributions to authenticated;
