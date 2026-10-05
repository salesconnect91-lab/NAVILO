-- Enforce Advanced Journal feature entitlements at the database write/RPC boundary.
-- Canonical Sales/Purchase/receipt posting remains available because those flows use
-- their own privileged posting functions and are not manual Journal feature actions.

create or replace function public.assert_manual_journal_feature(p_action text)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if not public.has_feature_access('journal',p_action) then
    raise exception 'Journal % feature permission required.', coalesce(nullif(p_action,''),'access');
  end if;
end
$$;

revoke all on function public.assert_manual_journal_feature(text) from public,anon,authenticated;
grant execute on function public.assert_manual_journal_feature(text) to service_role;

create or replace function public.assert_manual_journal_entry_feature(p_entry_id uuid,p_action text)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_type text;
begin
  select je.trans_type into v_type
  from public.journal_entries je
  where je.id=p_entry_id
    and je.company_id=public.current_company_id()
    and je.business_unit_id=public.current_business_unit_id()
    and je.operating_location_id=public.current_operating_location_id();

  if found and coalesce(v_type,'')='Manual Journal' then
    perform public.assert_manual_journal_feature(p_action);
  end if;
end
$$;

revoke all on function public.assert_manual_journal_entry_feature(uuid,text) from public,anon,authenticated;
grant execute on function public.assert_manual_journal_entry_feature(uuid,text) to service_role;

create or replace function public.create_manual_journal_entry(p_entry_date date,p_description text default null)
returns public.journal_entries
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company uuid:=public.current_company_id();
  v_unit uuid:=public.current_business_unit_id();
  v_location uuid:=public.current_operating_location_id();
  v_user uuid:=public.legacy_data_user_id();
  v_entry_no text;
  v_row public.journal_entries%rowtype;
begin
  perform public.assert_module_permission('accounting','create');
  perform public.assert_manual_journal_feature('create');
  if v_company is null or v_unit is null then raise exception 'Active company and business unit are required.'; end if;
  if v_location is null then raise exception 'Active branch/location is required.'; end if;
  if p_entry_date is null then raise exception 'Entry date is required.'; end if;
  v_entry_no:=public.next_document_number('manual_journal','JE-');
  insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type)
  values(v_user,v_company,v_unit,v_location,v_entry_no,p_entry_date,nullif(btrim(coalesce(p_description,'')),''),'draft','Manual Journal')
  returning * into v_row;
  return v_row;
end
$$;

revoke all on function public.create_manual_journal_entry(date,text) from public,anon;
grant execute on function public.create_manual_journal_entry(date,text) to authenticated;

do $migration$
declare
  v_oid oid;
  v_definition text;
  v_repaired text;
  v_guard text:='PERFORM public.assert_manual_journal_entry_feature(p_entry_id, ''post'');';
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='post_journal_entry'
    and pg_get_function_identity_arguments(p.oid)='p_entry_id uuid';

  if v_oid is null then raise exception 'post_journal_entry(uuid) is missing'; end if;
  v_definition:=pg_get_functiondef(v_oid);
  if position(v_guard in v_definition)=0 then
    v_repaired:=replace(
      v_definition,
      'PERFORM public.assert_module_permission(''accounting'', ''post'');',
      'PERFORM public.assert_module_permission(''accounting'', ''post'');'||chr(10)||'  '||v_guard
    );
    if v_repaired=v_definition then raise exception 'post_journal_entry feature patch pattern did not match'; end if;
    execute v_repaired;
  end if;
end
$migration$;

create or replace function public.post_foreign_manual_journal(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_entry public.journal_entries%rowtype; v_base text; v_count int;
  v_source_debit numeric; v_source_credit numeric; v_base_debit numeric; v_base_credit numeric;
begin
  perform public.assert_module_permission('accounting','post');
  perform public.assert_manual_journal_feature('post');
  select * into v_entry from public.journal_entries where id=p_entry_id
    and user_id=public.legacy_data_user_id() and company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
    and operating_location_id=public.current_operating_location_id() for update;
  if not found or v_entry.status<>'draft' then raise exception 'Draft journal not found in active workspace'; end if;
  if coalesce(v_entry.trans_type,'') not in ('','Journal Entry','Manual Journal') then
    raise exception 'Only manual journals may use foreign conversion';
  end if;
  select base_currency_code into v_base from public.companies where id=v_entry.company_id;
  if v_entry.currency_code=v_base or v_entry.exchange_rate<=0 then
    raise exception 'Use standard posting for base currency journals';
  end if;
  if exists(select 1 from public.ledgers where journal_entry_id=p_entry_id) or
     exists(select 1 from public.journal_lines where entry_id=p_entry_id
       and (source_debit is not null or source_credit is not null)) then
    raise exception 'This foreign journal was already converted or posted';
  end if;
  select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0),
    coalesce(sum(base_debit),0),coalesce(sum(base_credit),0)
  into v_count,v_source_debit,v_source_credit,v_base_debit,v_base_credit
  from public.journal_lines where entry_id=p_entry_id and company_id=v_entry.company_id
    and business_unit_id=v_entry.business_unit_id and operating_location_id=v_entry.operating_location_id;
  if v_count<2 or v_source_debit<=0 or abs(v_source_debit-v_source_credit)>=0.01 or
     abs(v_base_debit-v_base_credit)>=0.01 or v_base_debit<=0 then
    raise exception 'Foreign journal must balance in both source and base currency';
  end if;
  update public.journal_lines set source_debit=debit,source_credit=credit,
    debit=base_debit,credit=base_credit
  where entry_id=p_entry_id and company_id=v_entry.company_id
    and business_unit_id=v_entry.business_unit_id and operating_location_id=v_entry.operating_location_id;
  return public.post_journal_entry(p_entry_id);
end
$$;

revoke all on function public.post_foreign_manual_journal(uuid) from public,anon;
grant execute on function public.post_foreign_manual_journal(uuid) to authenticated;

do $migration$
declare
  v_oid oid;
  v_definition text;
  v_repaired text;
  v_guard text:='perform public.assert_manual_journal_feature(''post'');';
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='reverse_manual_journal_entry'
    and pg_get_function_identity_arguments(p.oid)='p_entry_id uuid, p_reversal_date date, p_reason text';

  if v_oid is null then raise exception 'reverse_manual_journal_entry(uuid,date,text) is missing'; end if;
  v_definition:=pg_get_functiondef(v_oid);
  if position(v_guard in lower(v_definition))=0 then
    v_repaired:=replace(
      v_definition,
      'perform public.assert_module_permission(''accounting'',''post'');',
      'perform public.assert_module_permission(''accounting'',''post'');'||chr(10)||' '||v_guard
    );
    if v_repaired=v_definition then raise exception 'reverse_manual_journal_entry feature patch pattern did not match'; end if;
    execute v_repaired;
  end if;
end
$migration$;

drop policy if exists tenant_insert_journal_entries on public.journal_entries;
create policy tenant_insert_journal_entries on public.journal_entries
for insert to authenticated
with check (
  company_id=public.current_company_id()
  and public.has_module_permission(company_id,'accounting','create')
  and public.has_feature_access('journal','create')
);

drop policy if exists tenant_update_journal_entries on public.journal_entries;
create policy tenant_update_journal_entries on public.journal_entries
for update to authenticated
using (
  public.has_module_permission(company_id,'accounting','edit')
  and public.has_feature_access('journal','edit')
)
with check (
  company_id=public.current_company_id()
  and public.has_module_permission(company_id,'accounting','edit')
  and public.has_feature_access('journal','edit')
);

drop policy if exists tenant_delete_journal_entries on public.journal_entries;
create policy tenant_delete_journal_entries on public.journal_entries
for delete to authenticated
using (
  public.has_module_permission(company_id,'accounting','delete')
  and public.has_feature_access('journal','delete')
);

drop policy if exists tenant_insert_journal_lines on public.journal_lines;
create policy tenant_insert_journal_lines on public.journal_lines
for insert to authenticated
with check (
  company_id=public.current_company_id()
  and public.has_module_permission(company_id,'accounting','create')
  and public.has_feature_access('journal','create')
);

drop policy if exists tenant_update_journal_lines on public.journal_lines;
create policy tenant_update_journal_lines on public.journal_lines
for update to authenticated
using (
  public.has_module_permission(company_id,'accounting','edit')
  and public.has_feature_access('journal','edit')
)
with check (
  company_id=public.current_company_id()
  and public.has_module_permission(company_id,'accounting','edit')
  and public.has_feature_access('journal','edit')
);

drop policy if exists tenant_delete_journal_lines on public.journal_lines;
create policy tenant_delete_journal_lines on public.journal_lines
for delete to authenticated
using (
  public.has_module_permission(company_id,'accounting','delete')
  and public.has_feature_access('journal','delete')
);

notify pgrst,'reload schema';
