DO $$
DECLARE v text; r record;
BEGIN
  v := pg_get_functiondef('public.guard_journal_line_changes()'::regprocedure);
  v := replace(v,
    '    if v_entry_status=''posted'' then raise exception ''Lines of a posted journal entry cannot be deleted.''; end if;' || chr(10),
    '');
  v := replace(v,
    '  if v_entry_status<>''draft'' then raise exception ''Lines of a posted journal entry cannot be modified.''; end if;' || chr(10),
    '');
  v := replace(v,
    '      if v_entry_status<>''draft'' then raise exception ''Lines of a posted journal entry cannot be moved.''; end if;' || chr(10),
    '');
  IF position('Lines of a posted journal entry cannot be' in v)>0 THEN
    RAISE EXCEPTION 'Journal line status lock remains';
  END IF;
  EXECUTE v;

  v := pg_get_functiondef('public.guard_journal_fx_snapshot()'::regprocedure);
  v := replace(v, '       new.entry_date is distinct from old.entry_date or' || chr(10), '');
  IF position('Posted journal currency, rate, date and company are immutable' in v)=0 THEN
    RAISE EXCEPTION 'Expected posted journal FX check was not found';
  END IF;
  EXECUTE v;

  FOR r IN
    SELECT n.nspname,c.relname,t.tgname
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE NOT t.tgisinternal AND n.nspname='public'
      AND p.proname IN ('guard_journal_line_delete','transport_opening_cutover_protect','guard_closed_accounting_period')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I',r.tgname,r.nspname,r.relname);
  END LOOP;
END $$;