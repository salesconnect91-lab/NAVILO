-- Include directly postable mapped Cash account alongside Petty Cash children in dashboard breakdown.
-- Preserve every existing dashboard KPI formula, company scope, and journal evidence.
CREATE OR REPLACE FUNCTION public.dashboard_professional_analytics(p_start_date date, p_end_date date, p_bucket text DEFAULT 'month'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with recursive ctx as (
  select public.current_company_id() company_id,
         public.current_business_unit_id() business_unit_id,
         public.current_operating_location_id() operating_location_id,
         least(p_start_date,p_end_date) start_date,
         greatest(p_start_date,p_end_date) end_date,
         case when p_bucket in ('day','week','month') then p_bucket else 'month' end bucket
), mapped_roots as (
  select am.mapping_key, am.account_id
  from public.account_mappings am, ctx
  where am.company_id=ctx.company_id
    and am.mapping_key in ('cash','bank','accounts_receivable','accounts_payable','inventory')
), mapped_tree as (
  select mr.mapping_key, coa.id account_id, coa.parent_id, coa.code, coa.name, 0 depth
  from mapped_roots mr join public.chart_of_accounts coa on coa.id=mr.account_id
  union all
  select mt.mapping_key, c.id, c.parent_id, c.code, c.name, mt.depth+1
  from mapped_tree mt join public.chart_of_accounts c on c.parent_id=mt.account_id
  where c.company_id=(select company_id from ctx)
), scoped_lines as (
  select jl.account_id, jl.base_debit, jl.base_credit, jl.debit, jl.credit, je.entry_date
  from public.journal_lines jl join public.journal_entries je on je.id=jl.entry_id, ctx
  where lower(coalesce(je.status,''))='posted'
    and jl.company_id=ctx.company_id
    and (ctx.business_unit_id is null or jl.business_unit_id=ctx.business_unit_id)
    and (ctx.operating_location_id is null or jl.operating_location_id=ctx.operating_location_id)
), balances as (
  select mt.mapping_key,
         coalesce(sum(coalesce(sl.base_debit,sl.debit,0)-coalesce(sl.base_credit,sl.credit,0)) filter (where sl.entry_date <= (select end_date from ctx)),0)::numeric balance
  from mapped_tree mt left join scoped_lines sl on sl.account_id=mt.account_id
  group by mt.mapping_key
), account_breakdown as (
  select mt.mapping_key,
         jsonb_agg(jsonb_build_object('account_id',mt.account_id,'code',mt.code,'name',mt.name,'balance',coalesce(x.balance,0)) order by mt.code,mt.name) filter (where mt.depth>0 or not exists (select 1 from public.chart_of_accounts c where c.parent_id=mt.account_id) or exists (select 1 from public.chart_of_accounts c where c.id=mt.account_id and c.is_group=false and c.allow_manual_entries=true)) data
  from mapped_tree mt
  left join lateral (
    select sum(coalesce(sl.base_debit,sl.debit,0)-coalesce(sl.base_credit,sl.credit,0))::numeric balance
    from scoped_lines sl where sl.account_id=mt.account_id and sl.entry_date <= (select end_date from ctx)
  ) x on true
  where mt.mapping_key in ('cash','bank')
  group by mt.mapping_key
), sales_period as (
  select coalesce(sum(so.total),0)::numeric amount, count(*)::int documents
  from public.sales_orders so,ctx
  where so.company_id=ctx.company_id and (ctx.business_unit_id is null or so.business_unit_id=ctx.business_unit_id)
    and (ctx.operating_location_id is null or so.operating_location_id=ctx.operating_location_id)
    and lower(coalesce(so.status,'')) in ('posted','closed') and so.order_date between ctx.start_date and ctx.end_date
), purchase_period as (
  select coalesce(sum(po.total),0)::numeric amount, count(*)::int documents
  from public.purchase_orders po,ctx
  where po.company_id=ctx.company_id and (ctx.business_unit_id is null or po.business_unit_id=ctx.business_unit_id)
    and (ctx.operating_location_id is null or po.operating_location_id=ctx.operating_location_id)
    and lower(coalesce(po.status,'')) in ('posted','closed') and po.order_date between ctx.start_date and ctx.end_date
), bucket_rows as (
  select case (select bucket from ctx)
      when 'day' then d::date
      when 'week' then date_trunc('week',d)::date
      else date_trunc('month',d)::date end bucket_start
  from generate_series((select start_date from ctx)::timestamp,(select end_date from ctx)::timestamp,
       case (select bucket from ctx) when 'day' then interval '1 day' when 'week' then interval '1 week' else interval '1 month' end) d
), buckets as (select distinct bucket_start from bucket_rows),
sales_by_bucket as (
  select case (select bucket from ctx) when 'day' then so.order_date when 'week' then date_trunc('week',so.order_date)::date else date_trunc('month',so.order_date)::date end bucket_start,
         sum(so.total)::numeric amount
  from public.sales_orders so,ctx where so.company_id=ctx.company_id and (ctx.business_unit_id is null or so.business_unit_id=ctx.business_unit_id)
    and (ctx.operating_location_id is null or so.operating_location_id=ctx.operating_location_id)
    and lower(coalesce(so.status,'')) in ('posted','closed') and so.order_date between ctx.start_date and ctx.end_date group by 1
), purchase_by_bucket as (
  select case (select bucket from ctx) when 'day' then po.order_date when 'week' then date_trunc('week',po.order_date)::date else date_trunc('month',po.order_date)::date end bucket_start,
         sum(po.total)::numeric amount
  from public.purchase_orders po,ctx where po.company_id=ctx.company_id and (ctx.business_unit_id is null or po.business_unit_id=ctx.business_unit_id)
    and (ctx.operating_location_id is null or po.operating_location_id=ctx.operating_location_id)
    and lower(coalesce(po.status,'')) in ('posted','closed') and po.order_date between ctx.start_date and ctx.end_date group by 1
), gp_by_bucket as (
  select case (select bucket from ctx) when 'day' then sm.invoice_date when 'week' then date_trunc('week',sm.invoice_date)::date else date_trunc('month',sm.invoice_date)::date end bucket_start,
         sum(sm.net_sales_amount)::numeric net_sales, sum(sm.gross_profit)::numeric gross_profit
  from public.sales_margin_report sm,ctx where sm.company_id=ctx.company_id and (ctx.business_unit_id is null or sm.business_unit_id=ctx.business_unit_id)
    and (ctx.operating_location_id is null or sm.operating_location_id=ctx.operating_location_id)
    and sm.invoice_date between ctx.start_date and ctx.end_date group by 1
), treasury_accounts as (select account_id from mapped_tree where mapping_key in ('cash','bank')),
treasury_by_bucket as (
  select case (select bucket from ctx) when 'day' then sl.entry_date when 'week' then date_trunc('week',sl.entry_date)::date else date_trunc('month',sl.entry_date)::date end bucket_start,
         sum(coalesce(sl.base_debit,sl.debit,0))::numeric cash_in,
         sum(coalesce(sl.base_credit,sl.credit,0))::numeric cash_out
  from scoped_lines sl join treasury_accounts ta on ta.account_id=sl.account_id,ctx
  where sl.entry_date between ctx.start_date and ctx.end_date group by 1
), trend as (
 select jsonb_agg(jsonb_build_object('date',b.bucket_start,
   'sales',coalesce(s.amount,0),'purchase',coalesce(p.amount,0),
   'cash_in',coalesce(t.cash_in,0),'cash_out',coalesce(t.cash_out,0),
   'gross_profit',coalesce(g.gross_profit,0),
   'margin_percent',case when coalesce(g.net_sales,0)<>0 then round(g.gross_profit*100/g.net_sales,2) else 0 end) order by b.bucket_start) data
 from buckets b left join sales_by_bucket s using(bucket_start) left join purchase_by_bucket p using(bucket_start)
 left join treasury_by_bucket t using(bucket_start) left join gp_by_bucket g using(bucket_start)
), stock_state as (
 select coalesce(sum(ws.quantity),0)::numeric quantity,count(*) filter(where coalesce(ws.quantity,0)<=0)::int alerts
 from public.warehouse_stock ws,ctx where ws.company_id=ctx.company_id and (ctx.business_unit_id is null or ws.business_unit_id=ctx.business_unit_id)
   and (ctx.operating_location_id is null or ws.operating_location_id=ctx.operating_location_id)
), work_state as (
 select count(*) filter(where lower(coalesce(wo.status,'')) not in ('completed','closed','cancelled'))::int pending
 from public.work_orders wo,ctx where wo.company_id=ctx.company_id and (ctx.business_unit_id is null or wo.business_unit_id=ctx.business_unit_id)
   and (ctx.operating_location_id is null or wo.operating_location_id=ctx.operating_location_id)
)
select jsonb_build_object(
 'start_date',(select start_date from ctx),'end_date',(select end_date from ctx),'bucket',(select bucket from ctx),
 'sales_total',(select amount from sales_period),'sales_documents',(select documents from sales_period),
 'purchase_total',(select amount from purchase_period),'purchase_documents',(select documents from purchase_period),
 'cash_balance',coalesce((select balance from balances where mapping_key='cash'),0),
 'bank_balance',coalesce((select balance from balances where mapping_key='bank'),0),
 'receivables',coalesce((select balance from balances where mapping_key='accounts_receivable'),0),
 'payables',-coalesce((select balance from balances where mapping_key='accounts_payable'),0),
 'inventory_value',coalesce((select balance from balances where mapping_key='inventory'),0),
 'cash_accounts',coalesce((select data from account_breakdown where mapping_key='cash'),'[]'::jsonb),
 'bank_accounts',coalesce((select data from account_breakdown where mapping_key='bank'),'[]'::jsonb),
 'stock_quantity',(select quantity from stock_state),'stock_alerts',(select alerts from stock_state),
 'pending_work_orders',(select pending from work_state),'trend',coalesce((select data from trend),'[]'::jsonb),'as_of',now());
$function$

