alter table public.purchase_orders add column if not exists due_date date;

drop view if exists public.sales_margin_report cascade;\ncreate or replace view public.sales_margin_report with (security_invoker=true) as
with line_cost as (
 select order_id,company_id,business_unit_id,sum(coalesce(cogs_total,coalesce(unit_cost_at_posting,0)*coalesce(qty,0),0)) cost_amount
 from public.sales_order_lines group by order_id,company_id,business_unit_id
), returns as (
 select sales_order_id,company_id,business_unit_id,sum(coalesce(total,0)) return_total,sum(coalesce(cost_total,0)) returned_cost
 from public.return_notes where note_type='sales_credit' and status='posted' group by sales_order_id,company_id,business_unit_id
)
select so.id sales_order_id,so.user_id,so.order_no invoice_no,so.order_date invoice_date,c.name customer_name,coalesce(so.sales_person,'') sales_person,
 round(coalesce(so.total,0),2) sales_amount,round(greatest(coalesce(lc.cost_amount,0)-coalesce(r.returned_cost,0),0),2) cost_amount,
 round((coalesce(so.total,0)-coalesce(r.return_total,0))-greatest(coalesce(lc.cost_amount,0)-coalesce(r.returned_cost,0),0),2) gross_profit,
 round(case when (coalesce(so.total,0)-coalesce(r.return_total,0))<>0 then (((coalesce(so.total,0)-coalesce(r.return_total,0))-greatest(coalesce(lc.cost_amount,0)-coalesce(r.returned_cost,0),0))/(coalesce(so.total,0)-coalesce(r.return_total,0)))*100 else 0 end,2) margin_percent,
 so.company_id,so.business_unit_id,so.operating_location_id,round(coalesce(r.return_total,0),2) return_amount,round(coalesce(so.total,0)-coalesce(r.return_total,0),2) net_sales_amount
from public.sales_orders so left join public.customers c on c.id=so.customer_id and c.company_id=so.company_id
left join line_cost lc on lc.order_id=so.id and lc.company_id=so.company_id and lc.business_unit_id is not distinct from so.business_unit_id
left join returns r on r.sales_order_id=so.id and r.company_id=so.company_id and r.business_unit_id is not distinct from so.business_unit_id where so.status='posted';

drop view if exists public.customer_item_history_report cascade;\ncreate or replace view public.customer_item_history_report with (security_invoker=true) as
select so.user_id,so.company_id,so.business_unit_id,so.operating_location_id,so.customer_id,c.name customer_name,so.id sales_order_id,so.order_no,so.order_date,
 sol.item_id,i.name item_name,i.sku,i.size,i.unit,coalesce(sol.qty,0) qty,coalesce(sol.unit_price,0) rate,coalesce(sol.line_total,0) line_total,
 coalesce(sol.cogs_total,coalesce(sol.unit_cost_at_posting,0)*coalesce(sol.qty,0),0) cost_total
from public.sales_orders so join public.sales_order_lines sol on sol.order_id=so.id and sol.company_id=so.company_id
left join public.customers c on c.id=so.customer_id and c.company_id=so.company_id left join public.items i on i.id=sol.item_id and i.company_id=so.company_id where so.status='posted';

drop view if exists public.supplier_item_history_report cascade;\ncreate or replace view public.supplier_item_history_report with (security_invoker=true) as
select po.user_id,po.company_id,po.business_unit_id,po.operating_location_id,po.supplier_id,s.name supplier_name,po.id purchase_order_id,po.order_no,po.order_date,
 pol.item_id,i.name item_name,i.sku,i.size,i.unit,coalesce(pol.qty,0) qty,coalesce(pol.unit_cost,0) rate,coalesce(pol.line_total,0) line_total
from public.purchase_orders po join public.purchase_order_lines pol on pol.order_id=po.id and pol.company_id=po.company_id
left join public.suppliers s on s.id=po.supplier_id and s.company_id=po.company_id left join public.items i on i.id=pol.item_id and i.company_id=po.company_id where po.status='posted';

drop view if exists public.customer_invoice_aging cascade;\ncreate or replace view public.customer_invoice_aging with (security_invoker=true) as
select so.id sales_order_id,so.user_id,so.customer_id,c.name customer_name,so.order_no invoice_no,so.order_date invoice_date,so.due_date,
coalesce(so.total,0) invoice_amount,coalesce(so.paid_amount,0) paid_amount,coalesce(so.outstanding_amount,0) outstanding_amount,so.payment_status,
greatest(current_date-so.order_date,0) days_outstanding,case when coalesce(so.outstanding_amount,0)<=0 then 0 when so.due_date is null then 0 else greatest(current_date-so.due_date,0) end overdue_days,
case when coalesce(so.outstanding_amount,0)<=0 then 'paid' when so.due_date is not null and current_date>so.due_date then 'overdue' when coalesce(so.paid_amount,0)>0 then 'partial' else 'open' end aging_status,
case when coalesce(so.outstanding_amount,0)<=0 then 'Paid' when so.due_date is null then 'No Due Date' when current_date<=so.due_date then 'Current' when current_date-so.due_date between 1 and 30 then '1-30 Days' when current_date-so.due_date between 31 and 60 then '31-60 Days' when current_date-so.due_date between 61 and 90 then '61-90 Days' else '90+ Days' end aging_bucket,
so.company_id,so.business_unit_id,so.operating_location_id
from public.sales_orders so left join public.customers c on c.id=so.customer_id and c.company_id=so.company_id where so.customer_id is not null and so.status='posted';

drop view if exists public.supplier_invoice_aging cascade;\ncreate or replace view public.supplier_invoice_aging with (security_invoker=true) as
select po.id purchase_order_id,po.user_id,po.company_id,po.business_unit_id,po.operating_location_id,po.supplier_id,s.name supplier_name,po.order_no invoice_no,po.order_date invoice_date,po.due_date,
coalesce(po.total,0) invoice_amount,coalesce(po.paid_amount,0) paid_amount,coalesce(po.outstanding_amount,greatest(coalesce(po.total,0)-coalesce(po.paid_amount,0),0)) outstanding_amount,po.payment_status,
greatest(current_date-po.order_date,0) days_outstanding,case when coalesce(po.outstanding_amount,0)<=0 then 0 when po.due_date is null then 0 else greatest(current_date-po.due_date,0) end overdue_days,
case when coalesce(po.outstanding_amount,0)<=0 then 'paid' when po.due_date is not null and current_date>po.due_date then 'overdue' when coalesce(po.paid_amount,0)>0 then 'partial' else 'open' end aging_status,
case when coalesce(po.outstanding_amount,0)<=0 then 'Paid' when po.due_date is null then 'No Due Date' when current_date<=po.due_date then 'Current' when current_date-po.due_date between 1 and 30 then '1-30 Days' when current_date-po.due_date between 31 and 60 then '31-60 Days' when current_date-po.due_date between 61 and 90 then '61-90 Days' else '90+ Days' end aging_bucket
from public.purchase_orders po left join public.suppliers s on s.id=po.supplier_id and s.company_id=po.company_id where po.supplier_id is not null and po.status='posted';

drop view if exists public.stock_godown_report cascade;\ncreate or replace view public.stock_godown_report with (security_invoker=true) as
select ws.id stock_id,ws.company_id,ws.item_id,i.name item_name,i.grade,i.size,i.unit,ws.warehouse_id,ws.godown_id,coalesce(g.name,ws.godown,'Main') godown,
coalesce(ws.quantity,0) quantity,coalesce(ic.avg_cost,i.cost,0) avg_cost,coalesce(ws.quantity,0)*coalesce(ic.avg_cost,i.cost,0) stock_value,ws.updated_at,ws.user_id,ws.business_unit_id,ws.operating_location_id
from public.warehouse_stock ws left join public.items i on i.id=ws.item_id and i.company_id=ws.company_id left join public.godowns g on g.id=ws.godown_id and g.company_id=ws.company_id
left join public.inventory_costs ic on ic.item_id=ws.item_id and ic.company_id=ws.company_id and ic.business_unit_id is not distinct from ws.business_unit_id;

drop view if exists public.purchase_register_report cascade;\ncreate or replace view public.purchase_register_report with (security_invoker=true) as
select po.id,po.user_id,po.company_id,po.business_unit_id,po.operating_location_id,po.order_no,po.order_date,s.name supplier_name,po.invoice_type,po.supplier_invoice_no,po.supplier_invoice_date,
coalesce(po.total,0) total,coalesce(po.paid_amount,0) paid_amount,coalesce(po.outstanding_amount,0) outstanding_amount,po.payment_status,po.due_date
from public.purchase_orders po left join public.suppliers s on s.id=po.supplier_id and s.company_id=po.company_id where po.status='posted';

grant select on public.sales_margin_report,public.customer_item_history_report,public.supplier_item_history_report,public.customer_invoice_aging,public.supplier_invoice_aging,public.stock_godown_report,public.purchase_register_report to authenticated;