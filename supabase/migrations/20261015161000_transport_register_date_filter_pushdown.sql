-- NAVILO Transport Register: push scoped date constraints to the eligible
-- Trip ID set before joining the expensive financial view.
-- It is algebraically identical to the existing later date filter.
-- No Trips, invoices, payments, balances or permissions are modified.
DO $patch$
DECLARE
  def text := pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
  before_fragment text := $old$where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
 and (o.trip_id is null or f.trip_id is not null or t.sales_order_id is not null)$old$;
  after_fragment text := $new$where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
 and (coalesce(p_filters->>'fromDate','')='' or t.trip_date>=(p_filters->>'fromDate')::date)
 and (coalesce(p_filters->>'toDate','')='' or t.trip_date<=(p_filters->>'toDate')::date)
 and (o.trip_id is null or f.trip_id is not null or t.sales_order_id is not null)$new$;
  matches integer;
BEGIN
  IF position(after_fragment IN def)>0 THEN
    RAISE NOTICE 'Scoped date pushdown already active';
    RETURN;
  END IF;
  matches := (length(def)-length(replace(def,before_fragment,'')))/length(before_fragment);
  IF matches<>1 THEN
    RAISE EXCEPTION 'Register query baseline changed (expected 1 eligible Trip ID predicate; found %)',matches;
  END IF;
  -- Required: later filtering remains intact, so the same set of matched Trips
  -- and all financial totals are retained for both inclusive date boundaries.
  IF position($later$(coalesce(p_filters->>'fromDate','')='' or r.trip_date>=(p_filters->>'fromDate')::date)$later$ IN def)=0
     OR position($later$(coalesce(p_filters->>'toDate','')='' or r.trip_date<=(p_filters->>'toDate')::date)$later$ IN def)=0
  THEN RAISE EXCEPTION 'Canonical downstream date filter missing'; END IF;
  EXECUTE replace(def,before_fragment,after_fragment);
END
$patch$;