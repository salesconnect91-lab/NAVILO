-- The production hardening for BU-scoped inventory uniqueness ran only after
-- business_unit_id existed on inventory_costs and warehouse_stock.
-- On a blank replay those columns are introduced by the following BU foundation,
-- so this historical slot must not reference them early. The executable indexes
-- are restored immediately after the BU columns exist.
do $do$ begin null; end $do$;