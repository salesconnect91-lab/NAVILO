-- Customer correction links must mirror supplier adjustment behavior:
-- one original billing link per Trip, unlimited adjustment links.
drop index if exists public.transport_trip_customer_document_uidx;
create unique index if not exists transport_original_customer_trip_uq
on public.transport_customer_document_trips(trip_id)
where not is_adjustment;
create index if not exists transport_customer_adjustment_trip_idx
on public.transport_customer_document_trips(trip_id, id)
where is_adjustment;
