-- Parent/child BU triggers require business_unit_id on operational child tables.
-- Those columns are added by 20260905013000_business_unit_transaction_isolation_phase1.sql.
do $do$ begin null; end $do$;