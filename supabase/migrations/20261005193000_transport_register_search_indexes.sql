begin;

-- Transport register textual lookup hardening for large histories.
-- Read-path only. No accounting/posting/mapping/evidence changes.
-- text_pattern_ops supports index-assisted prefix lookups used by the scalable register reader
-- without requiring pg_trgm or any paid/external service.

create index if not exists transport_trips_trip_no_lower_prefix_idx
  on public.transport_trips (company_id, business_unit_id, lower(trip_no) text_pattern_ops);

create index if not exists transport_trips_job_no_lower_prefix_idx
  on public.transport_trips (company_id, business_unit_id, lower(po_do_job_no) text_pattern_ops)
  where po_do_job_no is not null;

create index if not exists transport_trips_source_invoice_lower_prefix_idx
  on public.transport_trips (company_id, business_unit_id, lower(source_invoice_no) text_pattern_ops)
  where source_invoice_no is not null;

commit;
