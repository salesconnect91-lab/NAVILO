-- NAVILO owner-only posted opening-account identity correction.
-- Never delete or edit posted journals, opening batches, journal lines or ledger rows.
-- Correct the COA identity in place only when its ONLY activity is a posted opening.
create or replace function public.owner_correct_opening_only_account(
  p_account_id uuid,
  p_new_name text,
  p_new_code text,
  p_new_parent_id uuid,
  p_reason text default '',
  p_preview boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $body$
declare
  v_company uuid := public.current_company_id();
  v_unit uuid := public.current_business_unit_id();
  v_actor uuid := auth.uid();
  v_old public.chart_of_accounts%rowtype;
  v_parent public.chart_of_accounts%rowtype;
  v_journal_id uuid;
  v_journal_count integer;
  v_line_count integer;
  v_ledger_count integer;
  v_debit numeric;
  v_credit numeric;
  v_ledger_debit numeric;
  v_ledger_credit numeric;
  v_name text := btrim(coalesce(p_new_name,''));
  v_code text := btrim(coalesce(p_new_code,''));
  v_fk record;
  v_used boolean;
begin
  if v_actor is null or not public.is_platform_owner() then
    raise exception 'Only the NAVILO Software Owner can correct a posted opening account.';
  end if;
  if v_company is null or v_unit is null then
    raise exception 'Select a company and business unit before correcting an account.';
  end if;
  if p_account_id is null or p_new_parent_id is null then
    raise exception 'Original account and new receivables parent are required.';
  end if;
  if length(v_name) < 2 or length(v_name) > 160 then
    raise exception 'Enter a valid replacement account name.';
  end if;
  if v_code !~ '^[0-9A-Za-z._-]{1,32}$' then
    raise exception 'Enter a valid account code (letters, numbers, dot, dash or underscore).';
  end if;
  select * into v_old from public.chart_of_accounts
   where id=p_account_id and company_id=v_company for update;
  if not found then raise exception 'Original account not found in the active company.'; end if;
  if not v_old.is_active or v_old.is_group or coalesce(v_old.is_system_account,false) then
    raise exception 'Only an active, non-system posting account can be corrected.';
  end if;
  select * into v_parent from public.chart_of_accounts
   where id=p_new_parent_id and company_id=v_company
     and type='asset' and is_group=true and is_active=true;
  if not found then
    raise exception 'Choose an active Asset group as the new parent; the mapped A/R posting account cannot be a parent.';
  end if;
  if p_new_parent_id=p_account_id then raise exception 'An account cannot be its own parent.'; end if;
  if exists (select 1 from public.chart_of_accounts
       where company_id=v_company and code=v_code and id<>p_account_id) then
    raise exception 'The replacement account code is already in use.';
  end if;
  -- Forbid silently changing an account referenced by ANY setup/document.
  -- Only original journal/ledger rows for one posted opening may remain.
  for v_fk in
    select con.conrelid::regclass as table_name, att.attname as column_name
    from pg_constraint con
    join pg_attribute att on att.attrelid=con.conrelid and att.attnum=con.conkey[1]
    where con.contype='f' and con.confrelid='public.chart_of_accounts'::regclass
      and array_length(con.conkey,1)=1
      and con.conrelid not in ('public.journal_lines'::regclass,'public.ledgers'::regclass)
  loop
    execute format('select exists (select 1 from %s where %I=$1)',v_fk.table_name,v_fk.column_name)
      into v_used using p_account_id;
    if v_used then
      raise exception 'This account is referenced by % and cannot be replaced automatically.',v_fk.table_name;
    end if;
  end loop;
  -- One and only one posted opening journal; no other draft/posted activity in any BU.
  select count(*),count(distinct jl.entry_id),min(jl.entry_id::text)::uuid,
         coalesce(sum(jl.debit),0),coalesce(sum(jl.credit),0)
    into v_line_count,v_journal_count,v_journal_id,v_debit,v_credit
    from public.journal_lines jl
    where jl.account_id=p_account_id and jl.company_id=v_company;
  if v_line_count=0 or v_journal_count<>1 or v_debit<=v_credit then
    raise exception 'Eligible accounts must have only a positive Debit opening balance and no other journal activity.';
  end if;
  if exists(select 1 from public.journal_lines jl where jl.account_id=p_account_id
         and (jl.party_id is not null or jl.party_type is not null)) then
    raise exception 'Party-linked opening balances need a separate controlled customer correction.';
  end if;
  if not exists (
    select 1 from public.journal_entries je
    where je.id=v_journal_id and je.company_id=v_company and je.business_unit_id=v_unit
      and je.status='posted' and lower(coalesce(je.trans_type,'')) in ('opening balance','opening_balance')
      and (exists(select 1 from public.opening_balance_batches ob
                where ob.journal_entry_id=je.id and ob.company_id=v_company and ob.business_unit_id=v_unit)
        or exists(select 1 from public.cutover_opening_balance_batches cb
                where cb.journal_entry_id=je.id and cb.company_id=v_company and cb.business_unit_id=v_unit))
  ) then
    raise exception 'Original balance must belong to the active BU posted Opening Balance batch.';
  end if;
  select count(*),coalesce(sum(l.debit),0),coalesce(sum(l.credit),0)
    into v_ledger_count,v_ledger_debit,v_ledger_credit
  from public.ledgers l where l.account_id=p_account_id and l.company_id=v_company;
  if v_ledger_count<>v_line_count or v_ledger_debit<>v_debit or v_ledger_credit<>v_credit
     or exists(select 1 from public.ledgers l where l.account_id=p_account_id
               and (l.journal_entry_id is distinct from v_journal_id
                    or l.business_unit_id is distinct from v_unit)) then
    raise exception 'Ledger activity does not exclusively match the posted opening journal.';
  end if;
  if not p_preview and length(btrim(coalesce(p_reason,'')))<10 then
    raise exception 'A correction reason of at least 10 characters is required.';
  end if;
  if p_preview then
    return jsonb_build_object(
      'eligible',true,'account_id',p_account_id,'old_name',v_old.name,
      'old_code',v_old.code,'new_name',v_name,'new_code',v_code,
      'new_parent',v_parent.name,'original_opening_journal',v_journal_id,
      'opening_debit',v_debit,'opening_credit',v_credit,
      'net_debit',v_debit-v_credit,
      'note','Original posted journals and ledger records remain unchanged; this corrects only the COA identity.');
  end if;
  update public.chart_of_accounts
  set name=v_name,code=v_code,parent_id=p_new_parent_id,
      type='asset',detail_type='accounts_receivable',account_role='general'
  where id=p_account_id and company_id=v_company;
  if not found then raise exception 'Account correction was not saved.'; end if;
  insert into public.owner_posted_control_events
    (company_id,business_unit_id,document_type,document_id,action_type,reason,performed_by,metadata)
  values
    (v_company,v_unit,'chart_of_accounts',p_account_id,'correct',btrim(p_reason),v_actor,
     jsonb_build_object('operation','opening_account_identity_correction',
       'opening_journal',v_journal_id,'old_name',v_old.name,'old_code',v_old.code,
       'old_type',v_old.type,'old_parent_id',v_old.parent_id,
       'new_name',v_name,'new_code',v_code,'new_parent_id',p_new_parent_id,
       'opening_debit',v_debit,'opening_credit',v_credit,
       'original_posting_unchanged',true));
  return jsonb_build_object('success',true,'account_id',p_account_id,
    'old_name',v_old.name,'new_name',v_name,'opening_debit',v_debit,
    'opening_credit',v_credit,'original_posting_unchanged',true);
end
$body$;

revoke all on function public.owner_correct_opening_only_account(uuid,text,text,uuid,text,boolean) from public,anon;
grant execute on function public.owner_correct_opening_only_account(uuid,text,text,uuid,text,boolean) to authenticated;
comment on function public.owner_correct_opening_only_account(uuid,text,text,uuid,text,boolean)
is 'Software-owner-only in-place account identity correction, eligible only for an otherwise unused posted debit Opening Balance account; preserves source posting and audit.';
