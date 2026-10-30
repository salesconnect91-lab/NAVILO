DO $$
DECLARE r record; v text;
BEGIN
  FOR r IN
    SELECT n.nspname,c.relname,t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE NOT t.tgisinternal AND n.nspname='public'
      AND p.proname IN (
        'guard_consolidated_purchase_child','guard_consolidated_purchase_parent',
        'guard_consolidated_sales_child_changes','guard_consolidated_sales_invoice_changes',
        'guard_work_order_changes','transport_finalized_commercial_dimension_guard',
        'transport_trip_customer_accounting_guard','transport_trip_customer_mode_guard',
        'transport_trip_delete_guard'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I',r.tgname,r.nspname,r.relname);
  END LOOP;

  -- Allow posted consolidated purchase lines to be added/edited; keep tenant validation.
  v := pg_get_functiondef('public.validate_consolidated_purchase_line()'::regprocedure);
  v := replace(v, '  if st <> ''draft'' then' || chr(10) ||
    '    raise exception ''Posted Consolidated Purchase Invoice is locked.'';' || chr(10) ||
    '  end if;' || chr(10), '');
  IF position('Posted Consolidated Purchase Invoice is locked' in v)>0 THEN
    RAISE EXCEPTION 'Consolidated Purchase line status lock remains';
  END IF;
  EXECUTE v;

  -- Keep company currency validation, but allow editing a posted document's currency snapshot.
  v := pg_get_functiondef('public.guard_document_base_currency_snapshot()'::regprocedure);
  v := replace(v, '  if tg_op=''UPDATE'' and old.status=''posted'' then' || chr(10) ||
    '    if new.company_id is distinct from old.company_id' || chr(10) ||
    '       or new.currency_code is distinct from old.currency_code' || chr(10) ||
    '       or new.exchange_rate is distinct from old.exchange_rate then' || chr(10) ||
    '      raise exception' || chr(10) ||
    '        ''Posted invoice company and currency snapshot are immutable'';' || chr(10) ||
    '    end if;' || chr(10) ||
    '    return new;' || chr(10) ||
    '  end if;' || chr(10) || chr(10), '');
  IF position('Posted invoice company and currency snapshot are immutable' in v)>0 THEN
    RAISE EXCEPTION 'Posted currency immutability remains';
  END IF;
  EXECUTE v;

  -- A Trip may be moved to another active branch within the same company and BU.
  v := pg_get_functiondef('public.transport_trip_branch_guard()'::regprocedure);
  v := replace(v,
    ' elsif new.operating_location_id is distinct from old.operating_location_id and coalesce(current_setting(''app.maintenance_reset'',true),'''')<>''1'' then' || chr(10) ||
    '  raise exception ''Transport Trip branch is immutable; use controlled correction'';' || chr(10),
    ' elsif new.operating_location_id is distinct from old.operating_location_id and not exists(select 1 from public.operating_locations ol where ol.id=new.operating_location_id and ol.company_id=new.company_id and ol.business_unit_id=new.business_unit_id and ol.is_active) then' || chr(10) ||
    '  raise exception ''Transport Trip branch must match the active Company/Business Unit'';' || chr(10));
  IF position('branch is immutable' in v)>0 THEN RAISE EXCEPTION 'Transport Trip branch lock remains'; END IF;
  EXECUTE v;
END $$;