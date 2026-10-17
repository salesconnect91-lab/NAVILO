-- Read-only accounting entry plan for Twakkal historical H-S credit correction.
-- This DOES NOT unpost, reverse, or free any Trip for rebilling.
create or replace function public.transport_credit_hs_unpaid_entry_plan(p_company_id uuid)
returns table(sales_order_id uuid, sales_journal_id uuid, opening_journal_id uuid, account_id uuid, account_name text, planned_debit numeric, planned_credit numeric, source_side text)
language sql security invoker set search_path to 'public','pg_temp'
as $fn$
with eligible as (
 select r.sales_order_id,r.sales_journal_id,r.opening_journal_id
 from public.transport_credit_hs_journal_pair_review(p_company_id) r
 join public.transport_credit_hs_correction_preflight(p_company_id) p on p.sales_order_id=r.sales_order_id
 where p.review_lane='UNPAID_CORRECTION_CANDIDATE' and r.verdict='BALANCED_PAIR_REVIEWED'
), journals as (
 select e.sales_order_id,e.sales_journal_id,e.opening_journal_id,e.sales_journal_id source_id,'SALES' source_side from eligible e
 union all
 select e.sales_order_id,e.sales_journal_id,e.opening_journal_id,e.opening_journal_id,'OPENING_RECLASS' from eligible e
)
select j.sales_order_id,j.sales_journal_id,j.opening_journal_id,l.account_id,a.name,
 round(coalesce(l.base_credit,0),2) planned_debit,round(coalesce(l.base_debit,0),2) planned_credit,j.source_side
from journals j
join public.journal_lines l on l.entry_id=j.source_id and l.company_id=p_company_id
join public.chart_of_accounts a on a.id=l.account_id and a.company_id=p_company_id
$fn$;
revoke all on function public.transport_credit_hs_unpaid_entry_plan(uuid) from public,anon,authenticated;