-- Forward-only, row-preserving optimization for New Sales Invoice > Bulk Customer Rate.
-- The initial (unposted-only) grid must not materialize and price every
-- historical posted invoice before showing new billable Trips.
-- The existing all/posted-corrections route remains unchanged on opt-in.
DO $migration$
DECLARE
  definition text;
  needle text := 'where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc';
  revised text;
BEGIN
  definition:=pg_get_functiondef('public.transport_bulk_rate_page(text,integer,integer,jsonb)'::regprocedure);
  IF position('unpostedOnly' in definition)>0 THEN RETURN; END IF;
  IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
    RAISE EXCEPTION 'Cannot safely patch bulk rate scoped Trips query: missing or repeated anchor';
  END IF;
  revised:=replace(definition,needle,needle||E'\n'
    ||'   and (p_side <> ''customer'' or coalesce(p_filters->>''unpostedOnly'',''false'') <> ''true'''
    ||E'\n'
    ||'    or (t.sales_order_id is null and not exists (select 1 from public.transport_customer_document_trips l'
    ||' where l.trip_id=t.id)))');
  EXECUTE revised;
END $migration$;
