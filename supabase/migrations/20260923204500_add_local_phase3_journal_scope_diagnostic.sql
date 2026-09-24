begin;

create or replace function public.debug_phase3_journal_scope(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_row public.journal_entries%rowtype;
begin
  if coalesce(current_setting('app.environment', true),'') <> 'local' then
    raise exception 'Local diagnostic only.';
  end if;

  select * into v_row from public.journal_entries where id=p_entry_id;

  return jsonb_build_object(
    'entry_exists', found,
    'entry_id', p_entry_id,
    'auth_uid', auth.uid(),
    'legacy_data_user_id', public.legacy_data_user_id(),
    'current_company_id', public.current_company_id(),
    'current_business_unit_id', public.current_business_unit_id(),
    'current_operating_location_id', public.current_operating_location_id(),
    'row_user_id', v_row.user_id,
    'row_company_id', v_row.company_id,
    'row_business_unit_id', v_row.business_unit_id,
    'row_operating_location_id', v_row.operating_location_id,
    'row_status', v_row.status,
    'company_match', v_row.company_id is not distinct from public.current_company_id(),
    'business_unit_match', v_row.business_unit_id is not distinct from public.current_business_unit_id(),
    'operating_location_match', v_row.operating_location_id is not distinct from public.current_operating_location_id(),
    'legacy_owner_match', v_row.user_id is not distinct from public.legacy_data_user_id()
  );
end;
$$;

revoke all on function public.debug_phase3_journal_scope(uuid) from public,anon;
grant execute on function public.debug_phase3_journal_scope(uuid) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
