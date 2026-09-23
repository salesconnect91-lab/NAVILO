drop view if exists public.sales_invoice_financials;

create or replace view public.sales_invoice_financials
with (security_invoker = true)
as
select
  so.id as sales_order_id,
  so.user_id,
  so.customer_id,
  so.order_no as invoice_no,
  so.order_date as invoice_date,
  coalesce(so.total, 0::numeric) as invoice_amount,
  coalesce(so.total, 0::numeric) as invoice_total,
  coalesce((
    select sum(coalesce(previous_so.outstanding_amount, 0::numeric))
    from public.sales_orders previous_so
    where previous_so.user_id = so.user_id
      and previous_so.company_id = so.company_id
      and previous_so.customer_id = so.customer_id
      and previous_so.id <> so.id
      and (
        previous_so.order_date < so.order_date
        or (
          previous_so.order_date = so.order_date
          and previous_so.created_at < so.created_at
        )
      )
  ), 0::numeric) as previous_balance,
  coalesce(so.paid_amount, 0::numeric) as total_received,
  coalesce((
    select sum(ipa.amount)
    from public.invoice_payment_allocations ipa
    where ipa.sales_order_id = so.id
      and ipa.user_id = so.user_id
      and ipa.company_id = so.company_id
      and ipa.allocation_date = current_date
  ), 0::numeric) as today_received,
  coalesce((
    select ipa.amount
    from public.invoice_payment_allocations ipa
    where ipa.sales_order_id = so.id
      and ipa.user_id = so.user_id
      and ipa.company_id = so.company_id
    order by ipa.allocation_date desc, ipa.created_at desc, ipa.id desc
    limit 1
  ), 0::numeric) as last_payment,
  coalesce(so.outstanding_amount, greatest(coalesce(so.total,0::numeric)-coalesce(so.paid_amount,0::numeric),0::numeric))
    + coalesce((
      select ipa.amount
      from public.invoice_payment_allocations ipa
      where ipa.sales_order_id = so.id
        and ipa.user_id = so.user_id
        and ipa.company_id = so.company_id
      order by ipa.allocation_date desc, ipa.created_at desc, ipa.id desc
      limit 1
    ), 0::numeric) as balance_before_last,
  coalesce(so.outstanding_amount, greatest(coalesce(so.total,0::numeric)-coalesce(so.paid_amount,0::numeric),0::numeric)) as invoice_outstanding,
  coalesce((
    select sum(coalesce(previous_so.outstanding_amount, 0::numeric))
    from public.sales_orders previous_so
    where previous_so.user_id = so.user_id
      and previous_so.company_id = so.company_id
      and previous_so.customer_id = so.customer_id
      and previous_so.id <> so.id
      and (
        previous_so.order_date < so.order_date
        or (
          previous_so.order_date = so.order_date
          and previous_so.created_at < so.created_at
        )
      )
  ), 0::numeric)
  + coalesce(so.outstanding_amount, greatest(coalesce(so.total,0::numeric)-coalesce(so.paid_amount,0::numeric),0::numeric)) as outstanding_amount,
  (
    select ipa.allocation_date
    from public.invoice_payment_allocations ipa
    where ipa.sales_order_id = so.id
      and ipa.user_id = so.user_id
      and ipa.company_id = so.company_id
    order by ipa.allocation_date desc, ipa.created_at desc, ipa.id desc
    limit 1
  ) as last_payment_date,
  so.due_date,
  case when coalesce(so.outstanding_amount,0) <= 0 or so.due_date is null then 0 else greatest(current_date-so.due_date,0) end as overdue_days,
  greatest(current_date-so.order_date,0) as days_outstanding,
  case
    when coalesce(so.outstanding_amount,0) <= 0 then 'Paid'
    when so.due_date is null then 'No Due Date'
    when current_date <= so.due_date then 'Current'
    when current_date-so.due_date between 1 and 30 then '1-30 Days'
    when current_date-so.due_date between 31 and 60 then '31-60 Days'
    when current_date-so.due_date between 61 and 90 then '61-90 Days'
    else '90+ Days'
  end as aging_bucket,
  case
    when coalesce(so.outstanding_amount,0) <= 0 then 'paid'
    when so.due_date is not null and current_date > so.due_date then 'overdue'
    when coalesce(so.paid_amount,0) > 0 then 'partial'
    else 'open'
  end as aging_status,
  so.payment_status
from public.sales_orders so;
