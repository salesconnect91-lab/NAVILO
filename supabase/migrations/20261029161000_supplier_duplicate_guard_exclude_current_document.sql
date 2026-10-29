-- A posted supplier document can be updated in-place by its controlled workflow.
-- The duplicate lookup must exclude the row being updated, or its own supplier reference
-- can be mistaken for a conflict when the draft is posted/refreshed.
BEGIN;

CREATE OR REPLACE FUNCTION public.transport_guard_duplicate_supplier_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  number text := nullif(btrim(NEW.supplier_invoice_no),'');
  allow_override boolean := coalesce(current_setting('app.transport_duplicate_invoice_override',true),'0')='1';
  conflicts jsonb;
  matched_rows jsonb;
BEGIN
  IF number IS NULL THEN RETURN NEW; END IF;
  IF NEW.company_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text||':transport-invoice:supplier',0));
  END IF;

  conflicts := public.transport_invoice_number_conflicts('supplier',number);
  SELECT coalesce(jsonb_agg(m.value),'[]'::jsonb)
    INTO matched_rows
    FROM jsonb_array_elements(coalesce(conflicts->'matches','[]'::jsonb)) AS m(value)
   WHERE m.value->>'document_id' IS DISTINCT FROM NEW.id::text;

  conflicts := jsonb_build_object(
    'duplicate_count',jsonb_array_length(matched_rows),
    'matches',matched_rows
  );
  IF coalesce((conflicts->>'duplicate_count')::integer,0)=0 THEN RETURN NEW; END IF;

  IF NOT allow_override OR NOT public.transport_invoice_duplicate_override_allowed('supplier') THEN
    RAISE EXCEPTION 'Supplier invoice number is already in use. Review the duplicate list; authorized override is required.';
  END IF;

  INSERT INTO public.transport_invoice_duplicate_override_events(
    side,company_id,business_unit_id,document_id,invoice_number,matches,created_by
  ) VALUES(
    'supplier',NEW.company_id,NEW.business_unit_id,NEW.id,number,matched_rows,auth.uid()
  );
  RETURN NEW;
END
$function$;

NOTIFY pgrst,'reload schema';
COMMIT;
