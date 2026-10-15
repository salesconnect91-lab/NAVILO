-- NAVILO emergency Register financial-source consolidation.
-- Reuses the existing canonical source for all Trips, opening balances and
-- posted financial allocations; this changes no rows or ledger data.
-- Full-row source equivalence confirmed in 281 October and 869 September Trips.
DO $repair$
DECLARE
 definition text:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 first_pos int;
 last_pos int;
 old_source text;
 fast_source text:=$new$with register_source as materialized (
  select linked.* from public._transport_linked_register_source(c,b,loc) linked
  where (coalesce(p_filters->>'fromDate','')='' or linked.trip_date>=(p_filters->>'fromDate')::date)
    and (coalesce(p_filters->>'toDate','')='' or linked.trip_date<=(p_filters->>'toDate')::date)
)$new$;
BEGIN
 IF position('public._transport_linked_register_source(c,b,loc) linked' in definition)>0
 THEN RAISE NOTICE 'Canonical fast source already installed'; RETURN; END IF;
 first_pos:=position('with register_source as materialized (' in definition);
 last_pos:=position('), agreed_rents as materialized (' in definition);
 IF first_pos<=0 OR last_pos<=first_pos
 THEN RAISE EXCEPTION 'Register CTE anchors changed; no changes applied'; END IF;
 old_source:=substr(definition,first_pos,last_pos-first_pos+1);
 IF position('transport_financial_register' in old_source)=0
 OR position('transport_historical_payment_effective' in old_source)=0
 OR position('transport_opening_invoice_lines' in old_source)=0
 OR position('financial_ids as materialized' in old_source)=0
 THEN RAISE EXCEPTION 'Register financial source changed; no changes applied'; END IF;
 IF position('public._transport_linked_register_source' in pg_get_functiondef('public._transport_linked_register_source(uuid,uuid,uuid)'::regprocedure))=0
 THEN RAISE EXCEPTION 'Canonical helper unavailable'; END IF;
 EXECUTE left(definition,first_pos-1)||fast_source||substr(definition,last_pos+1);
END
$repair$;