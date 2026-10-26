-- Keep the Admin credit/debit-note Trip unlock exceptions safe on every table
-- that shares transport_financial_append_only(). A trigger's OLD/NEW record is
-- table-specific, so access release-link fields through JSON after the table
-- check instead of binding fields on unrelated evidence tables.
DO $migration$
DECLARE
  definition text:=pg_get_functiondef('public.transport_financial_append_only()'::regprocedure);
  unsafe_fields text[]:=ARRAY[
    'old.is_adjustment=false',
    'new.is_adjustment=true',
    'd.id=old.document_id',
    'g.trip_id=old.trip_id'
  ];
  safe_customer text:=$safe$to_jsonb(old)->>'is_adjustment'$safe$;
  item text;
BEGIN
  IF position('transport_customer_document_trips' IN definition)=0 THEN
    RAISE EXCEPTION 'Customer credit-release guard is missing from transport_financial_append_only';
  END IF;
  FOREACH item IN ARRAY unsafe_fields LOOP
    definition:=replace(definition,item,CASE item
      WHEN 'old.is_adjustment=false' THEN '(to_jsonb(old)->>''is_adjustment'')::boolean=false'
      WHEN 'new.is_adjustment=true' THEN '(to_jsonb(new)->>''is_adjustment'')::boolean=true'
      WHEN 'd.id=old.document_id' THEN 'd.id=(to_jsonb(old)->>''document_id'')::uuid'
      WHEN 'g.trip_id=old.trip_id' THEN 'g.trip_id=(to_jsonb(old)->>''trip_id'')::uuid'
    END);
  END LOOP;
  IF position(safe_customer IN definition)=0 OR position('old.is_adjustment' IN definition)>0 THEN
    RAISE EXCEPTION 'Could not safely convert customer release trigger record fields';
  END IF;
  EXECUTE definition;
END
$migration$;

NOTIFY pgrst,'reload schema';
