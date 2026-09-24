begin;

-- Make journal posting tenant-scope failures diagnosable without exposing tenant IDs.
-- This preserves the same authorization boundary, but reports which active workspace
-- dimension rejected the journal instead of collapsing every mismatch to "not found".
do $migration$
declare
  v_oid oid;
  v_definition text;
  v_old text := $old$
  SELECT
    je.user_id,
    je.status
  INTO
    v_user_id,
    v_status
  FROM public.journal_entries je
  WHERE je.id = p_entry_id
    AND je.company_id = public.current_company_id()
    AND je.business_unit_id = public.current_business_unit_id()
    AND je.operating_location_id = public.current_operating_location_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found.';
  END IF;
$old$;
  v_new text := $new$
  SELECT je.user_id, je.status
    INTO v_user_id, v_status
  FROM public.journal_entries je
  WHERE je.id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries je
    WHERE je.id = p_entry_id
      AND je.company_id = public.current_company_id()
  ) THEN
    RAISE EXCEPTION 'Journal company context mismatch.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries je
    WHERE je.id = p_entry_id
      AND je.business_unit_id = public.current_business_unit_id()
  ) THEN
    RAISE EXCEPTION 'Journal business unit context mismatch.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries je
    WHERE je.id = p_entry_id
      AND je.operating_location_id = public.current_operating_location_id()
  ) THEN
    RAISE EXCEPTION 'Journal operating location context mismatch.';
  END IF;
$new$;
  v_repaired text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='post_journal_entry'
    and pg_get_function_identity_arguments(p.oid)='p_entry_id uuid';

  if v_oid is null then raise exception 'post_journal_entry(uuid) is missing'; end if;
  v_definition := pg_get_functiondef(v_oid);
  v_repaired := replace(v_definition, v_old, v_new);
  if v_repaired = v_definition then
    raise exception 'post_journal_entry diagnostic scope patch pattern did not match';
  end if;
  execute v_repaired;
end;
$migration$;

revoke all on function public.post_journal_entry(uuid) from public,anon;
grant execute on function public.post_journal_entry(uuid) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
