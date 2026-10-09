-- Reporting only: never creates or changes financial postings.
-- Invoice aging remains an invoice-only source. The combined view adds the
-- party-ledger residual separately, without inventing invoices or due dates.
create or replace view public.customer_receivable_aging_report with (security_invoker=true) as
with party as (
 select p.company_id,p.business_unit_id,p.operating_location_id,p.party_id,
 min(p.entry_date) balance_date,sum(p.debit-p.credit) balance
 from public.party_ledgers p where p.party_type='customer'
 group by 1,2,3,4
), invoiced as (
 select company_id,business_unit_id,operating_location_id,customer_id,sum(outstanding_amount) balance
 from public.customer_invoice_aging group by 1,2,3,4
)
select a.*, 'Invoice'::text source_type,a.sales_order_id::text report_row_id
from public.customer_invoice_aging a
union all
select null::uuid,null::uuid,p.party_id,c.name,'Opening / Unallocated'::text,p.balance_date,null::date,
 0::numeric,0::numeric,p.balance-coalesce(i.balance,0),'unallocated'::text,
 greatest(current_date-p.balance_date,0),0,'unallocated'::text,'No Due Date'::text,
 p.company_id,p.business_unit_id,p.operating_location_id,'Opening / Unallocated'::text,
 concat('balance:',p.party_id,':',p.business_unit_id,':',p.operating_location_id)
from party p join public.customers c on c.id=p.party_id and c.company_id=p.company_id
left join invoiced i on i.company_id=p.company_id and i.business_unit_id is not distinct from p.business_unit_id
 and i.operating_location_id is not distinct from p.operating_location_id and i.customer_id=p.party_id
where abs(p.balance-coalesce(i.balance,0))>=0.005;
revoke all on public.customer_receivable_aging_report from public,anon;
grant select on public.customer_receivable_aging_report to authenticated;

create or replace view public.business_unit_performance_report with (security_invoker=true) as
with scopes as (
 select company_id,business_unit_id from public.sales_margin_report
 union select company_id,business_unit_id from public.purchase_register_report
 union select company_id,business_unit_id from public.ledgers
 union select company_id,business_unit_id from public.stock_godown_report
), s as (
 select company_id,business_unit_id,sum(net_sales_amount) net_sales,sum(gross_profit) gross_profit
 from public.sales_margin_report group by 1,2
), p as (
 select company_id,business_unit_id,sum(total) purchases from public.purchase_register_report group by 1,2
), balances as (
 select l.company_id,l.business_unit_id,
 sum(case when m.mapping_key='accounts_receivable' then l.debit-l.credit else 0 end) receivables,
 sum(case when m.mapping_key='accounts_payable' then l.credit-l.debit else 0 end) payables
 from public.ledgers l join public.account_mappings m on m.company_id=l.company_id and m.account_id=l.account_id
 and m.mapping_key in ('accounts_receivable','accounts_payable') group by 1,2
), st as (
 select company_id,business_unit_id,sum(stock_value) inventory_value from public.stock_godown_report group by 1,2
)
select null::uuid user_id,k.company_id,k.business_unit_id,coalesce(s.net_sales,0)::numeric net_sales,
 coalesce(s.gross_profit,0)::numeric gross_profit,coalesce(p.purchases,0)::numeric purchases,
 coalesce(b.receivables,0)::numeric receivables,coalesce(b.payables,0)::numeric payables,
 coalesce(st.inventory_value,0)::numeric inventory_value
from scopes k
left join s on s.company_id=k.company_id and s.business_unit_id is not distinct from k.business_unit_id
left join p on p.company_id=k.company_id and p.business_unit_id is not distinct from k.business_unit_id
left join balances b on b.company_id=k.company_id and b.business_unit_id is not distinct from k.business_unit_id
left join st on st.company_id=k.company_id and st.business_unit_id is not distinct from k.business_unit_id;
create or replace view public.monthly_business_performance_report with (security_invoker=true) as
with months as (
 select company_id,business_unit_id,date_trunc('month',current_date)::date month_start from public.business_unit_performance_report
 union
 select company_id,business_unit_id,date_trunc('month',invoice_date)::date month_start from public.sales_margin_report
 union select company_id,business_unit_id,date_trunc('month',order_date)::date from public.purchase_register_report
 union select company_id,business_unit_id,date_trunc('month',allocation_date)::date from public.invoice_payment_allocations
 union select company_id,business_unit_id,date_trunc('month',entry_date)::date from public.ledgers
), sales as (
 select company_id,business_unit_id,date_trunc('month',invoice_date)::date month_start,sum(net_sales_amount) net_sales,sum(gross_profit) gross_profit
 from public.sales_margin_report group by 1,2,3
), purch as (
 select company_id,business_unit_id,date_trunc('month',order_date)::date month_start,sum(total) purchases
 from public.purchase_register_report group by 1,2,3
), coll as (
 select company_id,business_unit_id,date_trunc('month',allocation_date)::date month_start,sum(amount) collections
 from public.invoice_payment_allocations group by 1,2,3
), pl as (
 select l.company_id,l.business_unit_id,date_trunc('month',l.entry_date)::date month_start,
 sum(case when a.type='revenue' then l.credit-l.debit else 0 end) ledger_revenue,
 sum(case when a.type='expense' then l.debit-l.credit else 0 end) expenses
 from public.ledgers l join public.chart_of_accounts a on a.id=l.account_id group by 1,2,3
), base as (
 select m.company_id,m.business_unit_id,m.month_start,coalesce(s.net_sales,0) net_sales,coalesce(p.purchases,0) purchases,coalesce(s.gross_profit,0) gross_profit,coalesce(pl.expenses,0) expenses,coalesce(pl.ledger_revenue,0)-coalesce(pl.expenses,0) net_profit,coalesce(c.collections,0) collections
 from months m left join sales s using(company_id,business_unit_id,month_start) left join purch p using(company_id,business_unit_id,month_start) left join coll c using(company_id,business_unit_id,month_start) left join pl using(company_id,business_unit_id,month_start)
)
select b.*,
 lag(net_sales) over(partition by company_id,business_unit_id order by month_start) previous_net_sales,
 case when lag(net_sales) over(partition by company_id,business_unit_id order by month_start)<>0 then round((net_sales-lag(net_sales) over(partition by company_id,business_unit_id order by month_start))*100/abs(lag(net_sales) over(partition by company_id,business_unit_id order by month_start)),2) end sales_change_percent,
 lag(gross_profit) over(partition by company_id,business_unit_id order by month_start) previous_gross_profit,
 lag(net_profit) over(partition by company_id,business_unit_id order by month_start) previous_net_profit,
 case when b.month_start=date_trunc('month',current_date)::date then (select coalesce(sum(a.receivables),0) from public.business_unit_performance_report a where a.company_id=b.company_id and a.business_unit_id is not distinct from b.business_unit_id) end current_ar,
 case when b.month_start=date_trunc('month',current_date)::date then (select coalesce(sum(a.payables),0) from public.business_unit_performance_report a where a.company_id=b.company_id and a.business_unit_id is not distinct from b.business_unit_id) end current_ap,
 case when b.month_start=date_trunc('month',current_date)::date then (select coalesce(sum(s.stock_value),0) from public.stock_godown_report s where s.company_id=b.company_id and s.business_unit_id is not distinct from b.business_unit_id) end current_inventory_value
from base b;


notify pgrst,'reload schema';
