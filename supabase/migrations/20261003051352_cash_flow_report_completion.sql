-- Direct-method cash flow uses posted cash/bank journal movements, not changes
-- in asset book values. Mixed/unknown classifications remain visible for review.
begin;
create function public.accounting_cash_flow_report(p_from date,p_to date)
returns jsonb language plpgsql security invoker stable set search_path=public,pg_temp as $$
declare answer jsonb;
begin
 if auth.uid() is null or not public.has_module_permission(public.current_company_id(),'accounting','view') then raise exception 'Accounting view permission required';end if;
 if p_from is null or p_to is null or p_from>p_to then raise exception 'Valid reporting period required';end if;
 with account_text as materialized (
 select a.*,regexp_replace(lower(coalesce(a.detail_type,'')),'[^a-z0-9]','','g') detail,
 regexp_replace(lower(concat_ws(' ',a.detail_type,a.parent_head)),'[^a-z0-9]','','g') classification
 from public.chart_of_accounts a where not a.is_group
 ), accounts as materialized (
 select a.*,a.type='asset' and a.detail in ('cashonhand','cashandcashequivalents','cash','bank','bankaccount','cashandcashequivalent') is_cash,
 case when a.type='equity' or (a.type='liability' and a.classification~'(loan|borrowing|longtermdebt|shorttermdebt|noncurrentliabilit)') then 'financing'
 when a.type='asset' and a.classification~'(fixedasset|noncurrentasset|propertyplant|machinery|equipment|landandbuilding|investment|loansreceivable|intangible)' then 'investing'
 when a.type in ('revenue','income','expense') or (a.type='asset' and a.classification~'(receivable|inventory|currentasset|inputvat|inputtax|prepaid)')
 or (a.type='liability' and a.classification~'(payable|currentliabilit|outputvat|outputtax|creditcard|accrued)') then 'operating'
 else 'unclassified' end category
 from account_text a
 ), posted as materialized (
 select l.journal_entry_id,l.entry_date,l.debit-l.credit movement,a.is_cash,a.category
 from public.ledgers l join public.journal_entries j on j.id=l.journal_entry_id join accounts a on a.id=l.account_id
 where j.status='posted' and l.entry_date<=p_to
 ), vouchers as (
 select journal_entry_id,sum(movement) filter(where is_cash) cash_movement,
 array_agg(distinct category) filter(where not is_cash and abs(movement)>=0.005) categories
 from posted where entry_date>=p_from group by journal_entry_id
 ), classified as (
 select cash_movement,case when cardinality(categories)=1 then categories[1] else 'unclassified' end category
 from vouchers where abs(coalesce(cash_movement,0))>=0.005
 ), activity as (
 select category,count(*) vouchers,sum(cash_movement) amount from classified group by category
 ), balances as (
 select coalesce(sum(movement) filter(where is_cash and entry_date<p_from),0) opening,
 coalesce(sum(movement) filter(where is_cash),0) closing from posted
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(activity) order by category) from activity),'[]'),
 'opening',(select opening from balances),'closing',(select closing from balances),
 'movement',(select closing-opening from balances),
 'difference',(select closing-opening from balances)-coalesce((select sum(amount) from activity),0)) into answer;
 return answer;
end $$;
revoke all on function public.accounting_cash_flow_report(date,date) from public,anon;
grant execute on function public.accounting_cash_flow_report(date,date) to authenticated;
commit;
