drop index if exists public.uq_journal_entries_user_entry_no_normalized;
drop index if exists public.ux_journal_entries_company_entry_no;
create unique index if not exists uq_journal_entries_company_unit_entry_no_normalized
on public.journal_entries(company_id,business_unit_id,lower(btrim(entry_no)))
where company_id is not null and business_unit_id is not null and entry_no is not null;

create or replace function public.create_manual_journal_entry(p_entry_date date, p_description text default null)
returns public.journal_entries
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_company uuid := public.current_company_id();
  v_unit uuid := public.current_business_unit_id();
  v_location uuid := public.current_operating_location_id();
  v_user uuid := public.legacy_data_user_id();
  v_entry_no text;
  v_row public.journal_entries%rowtype;
begin
  perform public.assert_module_permission('accounting','create');
  if v_company is null or v_unit is null then raise exception 'Active company and business unit are required.'; end if;
  if v_location is null then raise exception 'Active branch/location is required.'; end if;
  if p_entry_date is null then raise exception 'Entry date is required.'; end if;
  v_entry_no := public.next_document_number('manual_journal','JE-');
  insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type)
  values(v_user,v_company,v_unit,v_location,v_entry_no,p_entry_date,nullif(btrim(coalesce(p_description,'')),''),'draft','Manual Journal')
  returning * into v_row;
  return v_row;
end;
$function$;

revoke all on function public.create_manual_journal_entry(date,text) from public, anon;
grant execute on function public.create_manual_journal_entry(date,text) to authenticated;
