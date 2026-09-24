alter table public.purchase_orders add column if not exists due_date date;

drop view if exists public.supplier_invoice_aging cascade;
create or replace view public.supplier_invoice_aging as
select
  po.id as purchase_order_id,
  po.user_id,
  po.company_id,
  po.business_unit_id,
  po.operating_location_id,
  po.supplier_id,
  s.name as supplier_name,
  po.order_no as invoice_no,
  po.order_date as invoice_date,
  po.due_date,
  coalesce(po.total,0) as invoice_amount,
  coalesce(po.paid_amount,0) as paid_amount,
  coalesce(po.outstanding_amount, greatest(coalesce(po.total,0)-coalesce(po.paid_amount,0),0)) as outstanding_amount,
  po.payment_status,
  greatest(current_date-po.order_date,0) as days_outstanding,
  case when coalesce(po.outstanding_amount, greatest(coalesce(po.total,0)-coalesce(po.paid_amount,0),0)) <= 0 then 0
       else greatest(current_date-coalesce(po.due_date,po.order_date),0) end as overdue_days,
  case when coalesce(po.outstanding_amount, greatest(coalesce(po.total,0)-coalesce(po.paid_amount,0),0)) <= 0 then 'paid'
       when current_date > coalesce(po.due_date,po.order_date) then 'overdue'
       when coalesce(po.paid_amount,0) > 0 then 'partial'
       else 'open' end as aging_status,
  case when coalesce(po.outstanding_amount, greatest(coalesce(po.total,0)-coalesce(po.paid_amount,0),0)) <= 0 then 'Paid'
       when current_date <= coalesce(po.due_date,po.order_date) then 'Current'
       when current_date-coalesce(po.due_date,po.order_date) between 1 and 30 then '1-30 Days'
       when current_date-coalesce(po.due_date,po.order_date) between 31 and 60 then '31-60 Days'
       when current_date-coalesce(po.due_date,po.order_date) between 61 and 90 then '61-90 Days'
       else '90+ Days' end as aging_bucket
from public.purchase_orders po
left join public.suppliers s on s.id=po.supplier_id and s.company_id=po.company_id
where po.supplier_id is not null and po.status='posted';

grant select on public.supplier_invoice_aging to authenticated;

drop view if exists public.customer_invoice_aging cascade;
create or replace view public.customer_invoice_aging as
select
  so.id as sales_order_id,
  so.user_id,
  so.customer_id,
  c.name as customer_name,
  so.order_no as invoice_no,
  so.order_date as invoice_date,
  so.due_date,
  coalesce(so.total,0) as invoice_amount,
  coalesce(so.paid_amount,0) as paid_amount,
  coalesce(so.outstanding_amount,0) as outstanding_amount,
  so.payment_status,
  greatest(current_date-so.order_date,0) as days_outstanding,
  case when coalesce(so.outstanding_amount,0)<=0 then 0 when so.due_date is null then 0 else greatest(current_date-so.due_date,0) end as overdue_days,
  case when coalesce(so.outstanding_amount,0)<=0 then 'paid' when so.due_date is not null and current_date>so.due_date then 'overdue' when coalesce(so.paid_amount,0)>0 then 'partial' else 'open' end as aging_status,
  case when coalesce(so.outstanding_amount,0)<=0 then 'Paid' when so.due_date is null then 'No Due Date' when current_date<=so.due_date then 'Current' when current_date-so.due_date between 1 and 30 then '1-30 Days' when current_date-so.due_date between 31 and 60 then '31-60 Days' when current_date-so.due_date between 61 and 90 then '61-90 Days' else '90+ Days' end as aging_bucket
from public.sales_orders so
left join public.customers c on c.id=so.customer_id and c.company_id=so.company_id
where so.customer_id is not null and so.status='posted';

grant select on public.customer_invoice_aging to authenticated;
