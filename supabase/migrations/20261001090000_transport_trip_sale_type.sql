alter table public.transport_trips
  add column if not exists sale_type text;

alter table public.transport_trips
  drop constraint if exists transport_trips_sale_type_check;

alter table public.transport_trips
  add constraint transport_trips_sale_type_check
  check (sale_type is null or sale_type in ('cash','credit'));

comment on column public.transport_trips.sale_type is
  'Transport trip sale type: cash or credit. Nullable for historical trips not yet classified.';
