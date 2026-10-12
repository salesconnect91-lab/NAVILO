create index if not exists transport_trips_linked_sales_scope_idx on public.transport_trips(company_id,business_unit_id,operating_location_id) where sales_order_id is not null;
