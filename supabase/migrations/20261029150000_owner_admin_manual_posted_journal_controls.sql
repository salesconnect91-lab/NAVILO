-- Allow authorized Owner/Admin users to correct only truly manual posted journals.
-- Source-linked, reversal, and closed-period entries remain protected by their own controls.
CREATE OR REPLACE FUNCTION public.guard_journal_entry_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_legacy_user_id uuid;
  v_company_id uuid;
  v_manual_posted boolean;
begin
  if coalesce(current_setting('app.maintenance_reset', true),'0') = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_legacy_user_id := public.legacy_data_user_id();
    v_company_id := public.current_company_id();
    if new.user_id is null then new.user_id := coalesce(v_legacy_user_id, auth.uid()); end if;
    if auth.uid() is not null and new.user_id is distinct from auth.uid()
       and new.user_id is distinct from v_legacy_user_id then
      raise exception 'Journal entry owner is invalid.';
    end if;
    if v_company_id is not null and new.company_id is not null
       and new.company_id is distinct from v_company_id then
      raise exception 'Journal entry company is invalid.';
    end if;
    if current_user = 'authenticated' and coalesce(new.status, 'draft') <> 'draft' then
      raise exception 'New journal entries must be created as draft.';
    end if;
    return new;
  end if;

  v_manual_posted := old.status = 'posted'
    and old.source_module is null and old.source_document_type is null
    and old.source_document_id is null and old.reversal_of_entry_id is null
    and old.fiscal_year_closure_id is null and old.monthly_profit_closure_id is null;

  if tg_op = 'DELETE' then
    if old.status = 'posted' and not (v_manual_posted and public.owner_posted_control_access()) then
      raise exception 'Posted journal entry is locked. Correct it through its source module; only authorized Owner/Admin may delete a manual posted journal.';
    end if;
    if old.status = 'posted' and v_manual_posted and not public.owner_posted_control_access() then
      raise exception 'Only authorized Owner/Admin can delete a posted manual journal.';
    end if;
    return old;
  end if;

  if new.user_id is distinct from old.user_id then raise exception 'Journal entry owner cannot be changed.'; end if;
  if old.status = 'posted' then
    if not (v_manual_posted and public.owner_posted_control_access()) then
      raise exception 'Posted journal entry is locked. Correct it through its source module.';
    end if;
    if new.source_module is not null or new.source_document_type is not null
       or new.source_document_id is not null or new.reversal_of_entry_id is not null
       or new.fiscal_year_closure_id is not null or new.monthly_profit_closure_id is not null then
      raise exception 'A manual journal cannot be converted into a source-linked or reversal entry.';
    end if;
    if new.status <> 'posted' then raise exception 'Posted manual journals must remain posted during authorized edits.'; end if;
    return new;
  end if;
  if old.status <> 'posted' and new.status = 'posted' and current_user = 'authenticated' then
    raise exception 'Use the journal posting process to post this entry.';
  end if;
  if new.status not in ('draft', 'posted') then raise exception 'Invalid journal status.'; end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.guard_posted_journal_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_policy public.company_accounting_policies%rowtype;
  v_manual_posted boolean;
begin
  if current_setting('app.maintenance_reset',true)='1' then return coalesce(new,old); end if;
  v_manual_posted := old.status='posted'
    and old.source_module is null and old.source_document_type is null
    and old.source_document_id is null and old.reversal_of_entry_id is null
    and old.fiscal_year_closure_id is null and old.monthly_profit_closure_id is null;

  if old.status='posted' and v_manual_posted and public.owner_posted_control_access() then
    if tg_op='DELETE' then return old; end if;
    if new.status='posted' and new.source_module is null
       and new.source_document_type is null and new.source_document_id is null
       and new.reversal_of_entry_id is null and new.fiscal_year_closure_id is null
       and new.monthly_profit_closure_id is null then
      return new;
    end if;
    raise exception 'Authorized edits are limited to manual posted journals; source and reversal links cannot be changed.';
  end if;

  select * into v_policy from public.company_accounting_policies where company_id=old.company_id;
  if old.status='posted' and coalesce(v_policy.enforce_posted_immutability,true) then
    if tg_op='DELETE' then raise exception 'Posted journal entries cannot be deleted directly; use the source module.'; end if;
    if new.status='posted' and row(old.entry_no,old.entry_date,old.description,old.company_id,old.business_unit_id,old.payment_mode,old.party_name,old.trans_type)
       is distinct from row(new.entry_no,new.entry_date,new.description,new.company_id,new.business_unit_id,new.payment_mode,new.party_name,new.trans_type) then
      raise exception 'Posted journal entries are immutable; edit manual journals only through authorized controls.';
    end if;
  end if;
  return coalesce(new,old);
end
$function$;
