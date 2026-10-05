begin;

-- Transport register join/subquery scale hardening.
-- Read-path indexes only. No accounting/posting/mapping/evidence mutation.

create index if not exists transport_trip_supplier_charges_trip_only_idx
  on public.transport_trip_supplier_charges (trip_id, sort_order, id);

create index if not exists customers_company_name_idx
  on public.customers (company_id, name);

create index if not exists suppliers_company_name_idx
  on public.suppliers (company_id, name);

commit;
