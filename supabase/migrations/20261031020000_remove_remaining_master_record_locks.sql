DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname,c.relname,t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE NOT t.tgisinternal AND n.nspname='public'
      AND p.proname IN (
        'protect_customer_history',
        'protect_supplier_history',
        'protect_mapped_account_lifecycle',
        'protect_company_financial_history'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I',r.tgname,r.nspname,r.relname);
  END LOOP;
END $$;