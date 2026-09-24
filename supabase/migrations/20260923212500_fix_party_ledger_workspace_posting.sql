begin;

-- Payment journals are company-owned legacy rows.  The party-ledger bridge must
-- authorize them by the active tenant workspace, not by auth.uid() = row owner.
create or replace function public.post_party_ledger_for_journal(p_journal_entry_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid;
  v_company_id uuid;
  v_business_unit_id uuid;
  v_location_id uuid;
begin
  select je.user_id,je.company_id,je.business_unit_id,je.operating_location_id
    into v_user_id,v_company_id,v_business_unit_id,v_location_id
  from public.journal_entries je
  where je.id=p_journal_entry_id
    and je.company_id=public.current_company_id()
    and je.business_unit_id=public.current_business_unit_id()
    and je.operating_location_id=public.current_operating_location_id();

  if not found then
    raise exception 'Journal entry not found in active workspace.';
  end if;

  insert into public.party_ledgers(
    user_id,company_id,business_unit_id,operating_location_id,
    party_type,party_id,entry_date,description,reference,
    debit,credit,balance,journal_entry_id,journal_line_id
  )
  select
    v_user_id,v_company_id,v_business_unit_id,v_location_id,
    jl.party_type,jl.party_id,je.entry_date,
    coalesce(nullif(jl.account,''),je.description),je.entry_no,
    round(coalesce(jl.debit,0),2),round(coalesce(jl.credit,0),2),0,
    je.id,jl.id
  from public.journal_lines jl
  join public.journal_entries je on je.id=jl.entry_id
  where jl.entry_id=p_journal_entry_id
    and jl.user_id=v_user_id
    and jl.company_id=v_company_id
    and jl.business_unit_id=v_business_unit_id
    and jl.operating_location_id=v_location_id
    and je.user_id=v_user_id
    and je.company_id=v_company_id
    and je.business_unit_id=v_business_unit_id
    and je.operating_location_id=v_location_id
    and jl.party_type is not null
    and jl.party_id is not null
    and je.status='posted'
  on conflict (journal_line_id)
  where journal_line_id is not null
  do nothing;
end;
$function$;

revoke all on function public.post_party_ledger_for_journal(uuid) from public,anon;
grant execute on function public.post_party_ledger_for_journal(uuid) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
