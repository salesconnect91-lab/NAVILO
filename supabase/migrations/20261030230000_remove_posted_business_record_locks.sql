-- Remove status/history immutability guards from business records.
-- Tenant/company RLS boundaries and accounting side-effect triggers remain intact.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname, t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE NOT t.tgisinternal
      AND n.nspname='public'
      AND p.proname IN (
        'guard_posted_journal_immutability',
        'prevent_posted_sales_order_changes',
        'prevent_posted_sales_order_line_changes',
        'prevent_posted_purchase_order_changes',
        'prevent_posted_purchase_order_line_changes',
        'prevent_posted_return_note_changes',
        'prevent_posted_return_note_line_changes',
        'guard_stock_movement_immutability',
        'transport_financial_append_only',
        'transport_historical_billing_immutable',
        'transport_historical_operational_immutable',
        'transport_historical_payment_immutable',
        'transport_historical_identity_guard',
        'transport_opening_invoice_immutable',
        'transport_posted_rate_guard',
        'transport_customer_commercial_lock',
        'transport_driver_locked_month_guard',
        'transport_opening_trip_commercial_guard'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I',r.tgname,r.nspname,r.relname);
  END LOOP;
END $$;
