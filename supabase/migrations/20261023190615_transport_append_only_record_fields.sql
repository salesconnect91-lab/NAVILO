-- Shared evidence triggers run on tables with different row types. Read optional
-- journal links via JSON so PostgreSQL never resolves an absent record field.
-- Authorization, private transaction gates and immutable evidence checks stay intact.
BEGIN;
DO $fix$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.transport_financial_append_only()'::regprocedure) INTO definition;
 IF position('old.journal_entry_id' in definition)=0 THEN
  RAISE EXCEPTION 'Expected Draft evidence journal-link guard not found';
 END IF;
 definition:=replace(definition,'old.journal_entry_id',$replacement$(to_jsonb(old)->>'journal_entry_id')$replacement$);
 definition:=replace(definition,'new.journal_entry_id',$replacement$(to_jsonb(new)->>'journal_entry_id')$replacement$);
 EXECUTE definition;
END
$fix$;
COMMIT;
