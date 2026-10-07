-- Wire grouped Supplier invoice Trip allocation into the canonical Transport financial summary.
-- Downstream register/dashboard/report functions already read this summary.
create or replace view public.transport_trip_financial_summary
with (security_invoker=true) as
with evidence as (
 select t.id,t.company_id,t.business_unit_id,
 coalesce(c.net,0) customer_net,coalesce(c.gross,0) customer_gross,coalesce(c.paid_net,0) customer_received_net,coalesce(c.paid_gross,0) customer_received_gross,
 coalesce(c.outstanding,0) customer_outstanding_gross,coalesce(c.outstanding_net,0) customer_outstanding_net,coalesce(c.credit,0) customer_credit_gross,coalesce(c.docs,0) customer_documents,
 coalesce(s.net,0) supplier_net,coalesce(s.gross,0) supplier_gross,coalesce(s.paid_net,0) supplier_paid_net,coalesce(s.paid_gross,0) supplier_paid_gross,
 coalesce(s.outstanding,0) supplier_outstanding_gross,coalesce(s.credit,0) supplier_credit_gross,s.last_date supplier_payment_date,
 coalesce(dr.accrued,0) driver_accrued,coalesce(dp.paid,0) driver_paid,
 greatest(t.driver_pay-coalesce(dp.paid,0),0) driver_outstanding,
 coalesce(costs.net,0) other_cost_net,coalesce(costs.commission_paid,0) commission_paid_net,
 coalesce(costs.required_outstanding,0) required_cost_outstanding,
 exists(select 1 from public.transport_trip_supplier_rents where trip_id=t.id) structured_rents,
 exists(select 1 from public.transport_trip_supplier_rents r where r.trip_id=t.id and not exists(select 1 from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.transport_active_journals j on j.id=d.journal_entry_id where l.rent_id=r.id and not l.is_adjustment)) unbilled_rent,
 t.customer_rate original_customer_rate,t.owner_rent legacy_owner_rent,t.driver_pay agreed_driver_pay,t.status operational_status,t.job_status,
 (t.sales_order_id is not null or exists(select 1 from public.transport_customer_document_trips where trip_id=t.id)) customer_rate_locked,
 exists(select 1 from public.transport_supplier_document_rents where trip_id=t.id and not is_adjustment) supplier_rate_locked
 from public.transport_trips t
 left join lateral(
  select sum(b.billed_net) net,sum(b.billed_gross) gross,sum(b.paid_net) paid_net,sum(b.paid_gross-b.refunded_gross) paid_gross,
  sum(b.outstanding_gross) outstanding,sum(b.outstanding_net) outstanding_net,sum(b.credit_gross) credit,count(*) docs
  from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id
  join public.transport_service_document_balances b on b.side='customer' and b.order_id=d.sales_order_id
  where l.trip_id=t.id
 ) c on true
 left join lateral(
  select sum(x.billed_net) net,sum(x.billed_gross) gross,sum(x.paid_net) paid_net,sum(x.paid_gross) paid_gross,
         sum(x.outstanding_gross) outstanding,sum(x.credit_gross) credit,max(x.last_payment_date) last_date
  from public.transport_supplier_trip_document_balances x
  where x.trip_id=t.id
 ) s on true
 left join lateral(select sum(a.amount) accrued from public.transport_driver_accrual_attributions a
  join public.employee_salary_accruals p on p.id=a.accrual_id join public.transport_active_journals j on j.id=p.journal_entry_id where a.trip_id=t.id) dr on true
 left join lateral(select sum(a.amount) paid from public.transport_driver_payment_attributions a
  join public.employee_salary_payments p on p.id=a.salary_payment_id join public.transport_active_journals j on j.id=p.journal_entry_id where a.trip_id=t.id) dp on true
 left join lateral(select sum(b.billed_net) net,sum(b.paid_net) filter(where x.cost_kind='commission') commission_paid,
  sum(b.outstanding_gross+b.credit_gross) required_outstanding
  from public.transport_service_cost_links x join public.transport_service_document_balances b on b.side='supplier' and b.order_id=x.purchase_order_id where x.trip_id=t.id) costs on true
)
select *,case when customer_documents=0 then null else customer_net-supplier_net-driver_accrued-other_cost_net end posted_profit,
 case when operational_status='cancelled' then 'Cancelled'
 when customer_documents>0 and operational_status in ('completed','ready_to_invoice','invoiced','paid') and job_status='completed'
 and customer_outstanding_gross<=0.005 and customer_credit_gross<=0.005 and supplier_outstanding_gross<=0.005 and supplier_credit_gross<=0.005
 and driver_outstanding<=0.005 and driver_accrued>=agreed_driver_pay-0.005 and not unbilled_rent
 and (legacy_owner_rent<=0 or structured_rents) and required_cost_outstanding<=0.005 then 'Closed'
 when customer_rate_locked or supplier_rate_locked or driver_accrued>0 or driver_paid>0 or other_cost_net>0 then 'Under Settlement'
 when operational_status='draft' then 'Draft'
 when original_customer_rate>0 and (legacy_owner_rent>0 or structured_rents) then 'Complete' else 'Not Complete' end financial_status
from evidence;

revoke all on public.transport_trip_financial_summary from public,anon;
grant select on public.transport_trip_financial_summary to authenticated;
