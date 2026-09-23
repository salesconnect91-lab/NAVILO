alter table public.sales_orders drop constraint if exists sales_orders_salesperson_id_fkey;
alter table public.sales_orders add constraint sales_orders_salesperson_id_fkey foreign key (salesperson_id) references public.employees(id) on delete set null;
alter table public.order_book_headers add column if not exists salesperson_id uuid references public.employees(id) on delete set null;

create or replace view public.salesperson_performance_report as
with payment_totals as (
 select ipa.user_id,ipa.sales_order_id,sum(coalesce(ipa.amount,0)) received_amount from public.invoice_payment_allocations ipa group by ipa.user_id,ipa.sales_order_id
), invoice_facts as (
 select so.id,so.user_id,so.company_id,so.salesperson_id,so.customer_id,c.name customer_name,so.order_date,coalesce(so.total,0) sale_amount,
 case when pt.sales_order_id is not null then coalesce(pt.received_amount,0) else coalesce(so.paid_amount,0) end received_amount
 from public.sales_orders so left join payment_totals pt on pt.user_id=so.user_id and pt.sales_order_id=so.id left join public.customers c on c.id=so.customer_id
 where so.status=any(array['posted','closed','approved']) and so.salesperson_id is not null
), summaries as (
 select user_id,company_id,salesperson_id,count(*)::int total_orders,count(distinct customer_id)::int customer_count,
 coalesce(sum(sale_amount),0) total_sales,coalesce(sum(received_amount),0) total_received,min(order_date) earliest_date,max(order_date) latest_date,
 array_remove(array_agg(distinct customer_name),null) customers from invoice_facts group by user_id,company_id,salesperson_id
)
select e.id,e.user_id,e.employee_code code,e.name sales_person,e.is_active,coalesce(s.total_orders,0) total_orders,coalesce(s.customer_count,0) customer_count,
coalesce(s.customers,array[]::text[]) customers,coalesce(s.total_sales,0::numeric) total_sales,coalesce(s.total_received,0::numeric) total_received,
greatest(coalesce(s.total_sales,0)-coalesce(s.total_received,0),0) debit_balance,greatest(coalesce(s.total_received,0)-coalesce(s.total_sales,0),0) credit_balance,
s.earliest_date,s.latest_date from public.employees e left join summaries s on s.company_id=e.company_id and s.salesperson_id=e.id;
grant select on public.salesperson_performance_report to authenticated;
drop table if exists public.salespersons;