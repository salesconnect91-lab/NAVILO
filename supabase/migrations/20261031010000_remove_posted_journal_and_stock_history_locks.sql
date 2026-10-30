DO $$
DECLARE v text; r record;
BEGIN
  v := pg_get_functiondef('public.guard_journal_entry_changes()'::regprocedure);
  v := replace(v,
    '  IF TG_OP = ''DELETE'' THEN' || chr(10) ||
    '    IF OLD.status = ''posted'' AND NOT (v_manual_posted AND public.owner_posted_control_access()) THEN' || chr(10) ||
    '      RAISE EXCEPTION ''Posted journal entry is locked. Correct it through its source module; only authorized Owner/Admin may delete a manual posted journal.'';' || chr(10) ||
    '    END IF;' || chr(10) ||
    '    IF OLD.status = ''posted'' AND v_manual_posted AND NOT public.owner_posted_control_access() THEN' || chr(10) ||
    '      RAISE EXCEPTION ''Only authorized Owner/Admin can delete a posted manual journal.'';' || chr(10) ||
    '    END IF;' || chr(10) ||
    '    RETURN OLD;' || chr(10) ||
    '  END IF;',
    '  IF TG_OP = ''DELETE'' THEN RETURN OLD; END IF;');
  v := replace(v,
    '  IF OLD.status = ''posted'' THEN' || chr(10) ||
    '    IF NOT (v_manual_posted AND public.owner_posted_control_access()) THEN' || chr(10) ||
    '      RAISE EXCEPTION ''Posted journal entry is locked. Correct it through its source module.'';' || chr(10) ||
    '    END IF;' || chr(10) ||
    '    IF NEW.source_module IS NOT NULL OR NEW.source_document_type IS NOT NULL' || chr(10) ||
    '       OR NEW.source_document_id IS NOT NULL OR NEW.reversal_of_entry_id IS NOT NULL' || chr(10) ||
    '       OR NEW.fiscal_year_closure_id IS NOT NULL OR NEW.monthly_profit_closure_id IS NOT NULL THEN' || chr(10) ||
    '      RAISE EXCEPTION ''A manual journal cannot be converted into a source-linked or reversal entry.'';' || chr(10) ||
    '    END IF;' || chr(10) ||
    '    IF NEW.status <> ''posted'' THEN RAISE EXCEPTION ''Posted manual journals must remain posted during authorized edits.''; END IF;' || chr(10) ||
    '    RETURN NEW;' || chr(10) ||
    '  END IF;',
    '');
  IF position('Posted journal entry is locked' in v)>0 OR position('Posted manual journals must remain posted' in v)>0 THEN
    RAISE EXCEPTION 'Posted journal header locks remain';
  END IF;
  EXECUTE v;

  v := pg_get_functiondef('public.guard_journal_line_accounting_rules()'::regprocedure);
  v := replace(v,
    '  if v_status=''posted''' || chr(10) ||
    '     and current_setting(''app.maintenance_reset'',true) is distinct from ''1'' then' || chr(10) ||
    '    raise exception ''Lines of a posted journal entry cannot be changed.'';' || chr(10) ||
    '  end if;' || chr(10),
    '');
  IF position('Lines of a posted journal entry cannot be changed' in v)>0 THEN
    RAISE EXCEPTION 'Posted journal line lock remains';
  END IF;
  EXECUTE v;

  v := pg_get_functiondef('public.guard_journal_vehicle_attribution()'::regprocedure);
  v := replace(v,
    ' if tg_op=''UPDATE'' and j.status=''posted'' and row(new.transport_vehicle_id,new.transport_vehicle_no) is distinct from row(old.transport_vehicle_id,old.transport_vehicle_no) then raise exception ''Posted vehicle attribution is immutable; use journal reversal'';end if;' || chr(10),
    '');
  IF position('Posted vehicle attribution is immutable' in v)>0 THEN RAISE EXCEPTION 'Posted vehicle attribution lock remains'; END IF;
  EXECUTE v;

  FOR r IN
    SELECT n.nspname,c.relname,t.tgname
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE NOT t.tgisinternal AND n.nspname='public'
      AND p.proname IN ('guard_transport_monthly_profit_close','transport_guard_financial_reversal',
                        'guard_stock_movement_immutability','guard_vehicle_expense_journal')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I',r.tgname,r.nspname,r.relname);
  END LOOP;
END $$;