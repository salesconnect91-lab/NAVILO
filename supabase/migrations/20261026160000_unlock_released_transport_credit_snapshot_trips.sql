-- Ignore released/credited adjustment links when building Trip lock state.
DO $migration$
DECLARE
 v_definition text:=pg_get_functiondef('public._transport_register_snapshot_source(uuid,uuid,uuid,uuid[])'::regprocedure);
 v_old text:='WHERE o.status = ''posted''::text';
 v_new text:='WHERE NOT l.is_adjustment AND o.status = ''posted''::text';
BEGIN
 IF strpos(v_definition,'customer_link_flags AS MATERIALIZED (')=0 THEN
   RAISE EXCEPTION 'Expected snapshot customer_link_flags CTE was not found';
 END IF;
 IF (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 THEN
   RAISE EXCEPTION 'Expected exactly one snapshot customer lock predicate';
 END IF;
 v_definition:=replace(v_definition,v_old,v_new);
 EXECUTE v_definition;
END
$migration$;

UPDATE public.transport_register_snapshots s
SET built=false,refreshed_at=NULL
WHERE s.company_id='bda6d9fe-f530-42f8-8f4d-870a2ef02951';