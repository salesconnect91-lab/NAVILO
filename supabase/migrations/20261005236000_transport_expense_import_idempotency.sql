-- Transport expense import idempotency foundation.
-- Forward-only; no historical rows are rewritten.
alter table public.transport_trip_expenses
  add column if not exists source_reference text;

create unique index if not exists transport_trip_expenses_source_reference_uidx
  on public.transport_trip_expenses (company_id, business_unit_id, lower(btrim(source_reference)))
  where source_reference is not null and btrim(source_reference) <> '';

comment on column public.transport_trip_expenses.source_reference is
  'Stable external/import reference used to make Transport expense imports idempotent. Historical rows remain null.';
