-- Reconcile isolated migration replay with the already-correct production
-- Transport financial summary status source. Legacy t.status remains draft when
-- the controlled completion flow updates t.trip_status.
-- Preserve all view columns, accounting calculations, permissions and evidence.
do $$
declare v_definition text;
begin
 select pg_get_viewdef('public.transport_trip_financial_summary'::regclass,true)
   into v_definition;
 if position('t.trip_status AS operational_status' in v_definition)>0 then
   -- Production is already correct. Do not rewrite the view.
   return;
 end if;
 if position('t.status AS operational_status' in v_definition)=0 then
   raise exception 'Unrecognized Transport financial status view. No change applied.';
 end if;
 execute format(
   'create or replace view public.transport_trip_financial_summary as %s',
   replace(v_definition,'t.status AS operational_status','t.trip_status AS operational_status')
 );
end $$;

do $$
declare v_definition text;
begin
 select pg_get_viewdef('public.transport_trip_financial_summary'::regclass,true)
 into v_definition;
 if position('t.trip_status AS operational_status' in v_definition)=0
 then raise exception 'Transport financial status view alignment failed'; end if;
end $$;
