begin;

-- Transport register scale hardening.
-- Read-path indexes only: no accounting, posting, mapping, evidence or business-rule changes.
-- All indexes are company/BU scoped because transport_register_query always enforces that scope.

create index if not exists transport_trips_ppr_date_idx
  on public.transport_trips (company_id, business_unit_id, ppr_status, trip_date desc, trip_no desc);

create index if not exists transport_trips_from_date_idx
  on public.transport_trips (company_id, business_unit_id, from_location, trip_date desc, trip_no desc);

create index if not exists transport_trips_to_date_idx
  on public.transport_trips (company_id, business_unit_id, to_location, trip_date desc, trip_no desc);

create index if not exists transport_trips_job_date_idx
  on public.transport_trips (company_id, business_unit_id, po_do_job_no, trip_date desc, trip_no desc);

create index if not exists transport_trips_sale_type_date_idx
  on public.transport_trips (company_id, business_unit_id, sale_type, trip_date desc, trip_no desc);

-- Supplier header/rent filtering resolves through structured supplier-rent rows.
create index if not exists transport_trip_supplier_rents_scope_supplier_trip_idx
  on public.transport_trip_supplier_rents (company_id, business_unit_id, supplier_id, trip_id);

commit;
