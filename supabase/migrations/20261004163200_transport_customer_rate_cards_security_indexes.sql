begin;
revoke all on function public.transport_customer_commercial_lock() from public,anon,authenticated;
grant execute on function public.transport_customer_commercial_lock() to service_role;
create index if not exists transport_customer_charge_rates_customer_idx on public.transport_customer_charge_rates(customer_id);
create index if not exists transport_customer_charge_rates_charge_type_idx on public.transport_customer_charge_rates(charge_type_id);
create index if not exists transport_trip_customer_charges_charge_type_idx on public.transport_trip_customer_charges(charge_type_id);
create index if not exists transport_trip_customer_charges_source_rate_idx on public.transport_trip_customer_charges(source_rate_id) where source_rate_id is not null;
commit;