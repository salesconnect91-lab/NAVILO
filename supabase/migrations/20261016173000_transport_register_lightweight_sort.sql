-- NAVILO Transport Register lightweight snapshot sorting.
-- Reads source financial rows only for selected page. Does not alter financial source data.
-- Migration preflight compile verified in transaction/rollback on production.
DO $migration$
DECLARE
  original_sql text;
  next_sql text;
  old_decode constant text := 'jsonb_populate_record(null::public.transport_register_snapshot_item,cached.data)';
  new_decode constant text := 'jsonb_populate_record(null::public.transport_register_snapshot_item,cached.data - ''full_row'')';
  old_page constant text := 'from chosen cross join lateral jsonb_populate_record(null::public.transport_financial_register,chosen.full_row) fr';
  new_page constant text := 'from chosen join public.transport_register_snapshot_rows detail on detail.trip_id=chosen.id and detail.company_id=c and detail.business_unit_id=b and detail.operating_location_id=loc and detail.permission_mask=cache_mask cross join lateral jsonb_populate_record(null::public.transport_financial_register,detail.data->''full_row'') fr';
BEGIN
  original_sql := pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
  IF position(old_decode in original_sql)=0 OR position(old_page in original_sql)=0 THEN
    RAISE EXCEPTION 'Unexpected Register SQL structure: migration not applied';
  END IF;
  IF length(original_sql) - length(replace(original_sql,old_decode,'')) <> length(old_decode)
     OR length(original_sql) - length(replace(original_sql,old_page,'')) <> length(old_page) THEN
    RAISE EXCEPTION 'Expected exactly one occurrence of each replacement';
  END IF;
  next_sql := replace(replace(original_sql,old_decode,new_decode),old_page,new_page);
  EXECUTE next_sql;
END $migration$;