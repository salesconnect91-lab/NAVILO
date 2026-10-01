-- Sequence state is private to the checked number-generation RPC.
alter table public.transport_trip_sequences enable row level security;
revoke all on table public.transport_trip_sequences from anon,authenticated;
-- Trigger functions do not need a caller-controlled name resolution path.
do $$begin
 if to_regprocedure('public.sync_transport_vehicle_ownership_columns()') is not null then
   alter function public.sync_transport_vehicle_ownership_columns() set search_path=public,pg_temp;
 end if;
end $$;
alter function public.transport_trip_delete_guard() set search_path=public,pg_temp;
alter function public.transport_number_registry_guard() set search_path=public,pg_temp;
alter function public.transport_audit_guard() set search_path=public,pg_temp;
alter function public.transport_financial_append_only() set search_path=public,pg_temp;
