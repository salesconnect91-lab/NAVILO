-- business_unit_id is added to operational tables by
-- 20260905013000_business_unit_transaction_isolation_phase1.sql.
-- Keep this historical slot replay-safe; executable indexes follow that migration.
do $do$ begin null; end $do$;