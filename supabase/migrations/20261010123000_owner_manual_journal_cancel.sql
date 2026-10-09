-- Owner-only cancellation for standalone base-currency manual journals.
-- Never deletes or mutates posted financial evidence; posts an opposite journal atomically.
create or replace function public.owner_cancel_manual_journal(
  p_entry_id uuid, p_reversal_date date, p_reason text
) returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp'
as $$
declare
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  loc uuid:=public.current_operating_location_id();
  u uuid:=public.legacy_data_user_id();
  src public.journal_entries%rowtype;
  rev_id uuid;
  rev_no text;
  post_result jsonb;
  base_ccy text;
  n_lines integer;
  n_ledgers integer;
  debit_total numeric;
  credit_total numeric;
begin
  if not public.owner_posted_control_access() then
    raise exception 'Only the active company owner or platform owner can cancel posted records.';
  end if;
  perform public.assert_module_permission('accounting','post');
  if p_entry_id is null or p_reversal_date is null then
    raise exception 'Journal and cancellation date are required.';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then
    raise exception 'A cancellation reason of at least 10 characters is required.';
  end if;
  if loc is null or u is null then
    raise exception 'Active operating location and accounting identity required.';
  end if;
  select * into src from public.journal_entries
    where id=p_entry_id and company_id=c and business_unit_id=b and user_id=u
      and operating_location_id=loc for update;
  if not found then raise exception 'Journal not found in active company, business unit and location.'; end if;
  if src.status <> 'posted' then raise exception 'Only posted journals can be cancelled.'; end if;
  if src.reversal_of_entry_id is not null or src.fiscal_year_closure_id is not null
     or src.monthly_profit_closure_id is not null then
    raise exception 'Reversal, period close and profit close journals cannot be cancelled here.';
  end if;
  if src.source_module is not null or src.source_document_type is not null
     or src.source_document_id is not null
     or coalesce(src.trans_type,'') not in ('','General','Journal Entry','Manual Journal')
     or src.entry_no like 'COB-%' then
    raise exception 'Only standalone manual journals are eligible. Use source-document correction.';
  end if;
  if exists(select 1 from public.cutover_opening_balance_batches
    where journal_entry_id=src.id) then
    raise exception 'Cutover opening balances require a separate controlled correction.';
  end if;
  if p_reversal_date < src.entry_date then
    raise exception 'Cancellation date cannot precede the original journal date.';
  end if;
  select base_currency_code into base_ccy from public.companies where id=c;
  if base_ccy is null or coalesce(src.currency_code,base_ccy) <> base_ccy
     or coalesce(src.exchange_rate,1) <> 1 then
    raise exception 'Foreign-currency journals require the FX-specific correction workflow.';
  end if;
  if exists(select 1 from public.journal_entries
     where reversal_of_entry_id=src.id and company_id=c and business_unit_id=b)
     or exists(select 1 from public.owner_posted_control_events
     where company_id=c and business_unit_id=b and document_type='manual_journal'
       and document_id=src.id and action_type='cancel') then
    raise exception 'This journal already has a cancellation or reversal.';
  end if;
  select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)
    into n_lines,debit_total,credit_total
    from public.journal_lines
    where entry_id=src.id and company_id=c and business_unit_id=b;
  select count(*) into n_ledgers from public.ledgers
    where journal_entry_id=src.id and company_id=c and business_unit_id=b;
  if n_lines=0 or n_ledgers<>n_lines or abs(debit_total-credit_total)>=0.01 then
    raise exception 'Original journal/ledger reconciliation failed; cancellation blocked.';
  end if;
  rev_no:='OWNER-REV-'||src.entry_no;
  insert into public.journal_entries(
    user_id,company_id,business_unit_id,operating_location_id,
    entry_no,entry_date,description,status,payment_mode,party_name,trans_type,
    reversal_of_entry_id,reversal_reason,currency_code,exchange_rate,
    accounting_dimension_id
  ) values(
    u,c,b,loc,rev_no,p_reversal_date,
    'Owner cancellation of '||src.entry_no||': '||btrim(p_reason),
    'draft',src.payment_mode,src.party_name,'Journal Reversal',
    src.id,btrim(p_reason),base_ccy,1,src.accounting_dimension_id
  ) returning id into rev_id;
  insert into public.journal_lines(
    user_id,company_id,business_unit_id,operating_location_id,entry_id,
    account_id,account,party_type,party_id,party_name,debit,credit,
    accounting_dimension_id,transport_vehicle_id,transport_vehicle_no
  )
  select u,c,b,loc,rev_id,account_id,account,party_type,party_id,party_name,
         round(coalesce(credit,0),2),round(coalesce(debit,0),2),
         accounting_dimension_id,transport_vehicle_id,transport_vehicle_no
  from public.journal_lines
  where entry_id=src.id and company_id=c and business_unit_id=b;
  post_result:=public.post_journal_entry(rev_id);
  if coalesce(post_result->>'status','')<>'posted' then
    raise exception 'Cancellation reversal did not post successfully.';
  end if;
  if (select count(*) from public.ledgers where journal_entry_id=rev_id
      and company_id=c and business_unit_id=b)<>n_lines then
    raise exception 'Reversal ledger reconciliation failed.';
  end if;
  insert into public.owner_posted_control_events(
    company_id,business_unit_id,document_type,document_id,action_type,
    reason,performed_by,reversal_document_id,metadata
  ) values(
    c,b,'manual_journal',src.id,'cancel',btrim(p_reason),auth.uid(),rev_id,
    jsonb_build_object('original_entry_no',src.entry_no,'reversal_entry_no',rev_no,
      'original_date',src.entry_date,'reversal_date',p_reversal_date,
      'debit',debit_total,'credit',credit_total,'currency',base_ccy)
  );
  perform public.log_admin_posted_action(c,'accounting','journal_entries',
    src.id,src.entry_no,'OWNER_CANCEL',btrim(p_reason),
    jsonb_build_object('status',src.status,'date',src.entry_date),
    jsonb_build_object('reversal_entry_id',rev_id,'reversal_entry_no',rev_no,
      'financial_evidence_preserved',true));
  return jsonb_build_object('success',true,'original_entry_id',src.id,
    'reversal_entry_id',rev_id,'reversal_entry_no',rev_no,
    'financial_evidence_preserved',true);
end;
$$;
revoke all on function public.owner_cancel_manual_journal(uuid,date,text) from public,anon;
grant execute on function public.owner_cancel_manual_journal(uuid,date,text) to authenticated;

-- Only IDs are exposed to active tenant users for ordinary journal-list filtering.
create or replace function public.owner_cancelled_journal_ids()
returns table(entry_id uuid) language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select x.id from (
    select e.document_id as id
    from public.owner_posted_control_events e
    where e.document_type='manual_journal' and e.action_type='cancel'
      and e.company_id=public.current_company_id()
      and e.business_unit_id=public.current_business_unit_id()
    union
    select e.reversal_document_id
    from public.owner_posted_control_events e
    where e.document_type='manual_journal' and e.action_type='cancel'
      and e.reversal_document_id is not null
      and e.company_id=public.current_company_id()
      and e.business_unit_id=public.current_business_unit_id()
  ) x
  where auth.uid() is not null
    and public.has_module_permission(public.current_company_id(),'accounting','view');
$$;
revoke all on function public.owner_cancelled_journal_ids() from public,anon;
grant execute on function public.owner_cancelled_journal_ids() to authenticated;
