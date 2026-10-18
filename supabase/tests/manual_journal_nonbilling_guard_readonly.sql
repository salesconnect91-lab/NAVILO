-- Read-only release verification. Never creates financial records.
-- Expect one trigger and a non-security-definer function.
select t.tgname, pg_get_triggerdef(t.oid) definition,
       p.prosecdef as security_definer
from pg_trigger t
join pg_proc p on p.oid=t.tgfoid
where t.tgrelid='public.journal_entries'::regclass
  and t.tgname='zzz_manual_journal_nonbilling_post';

-- Source invoice/expense mapped accounts remain available to canonical posting.
select m.company_id,m.mapping_key,coa.code,coa.name,coa.allow_manual_entries
from public.account_mappings m
join public.chart_of_accounts coa on coa.id=m.account_id
where m.mapping_key in ('input_vat','output_vat')
order by m.company_id,m.mapping_key;
