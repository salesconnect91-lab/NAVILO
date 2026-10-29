-- Supplier invoice references are unique within the owning company, and the current row
-- must never conflict with itself during an UPDATE of supplier_invoice_no.
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
  conflict_exists boolean := false;
  conflict_rows jsonb := '[]'::jsonb;
  company_label text;
BEGIN
  IF number IS NULL THEN RETURN NEW; END IF;
  IF NEW.company_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text||':transport-invoice:supplier',0));
  END IF;

  SELECT EXISTS(
    SELECT 1
      FROM public.purchase_orders po
     WHERE po.company_id=NEW.company_id
       AND po.id IS DISTINCT FROM NEW.id
       AND (
         lower(btrim(coalesce(po.order_no,'')))=lower(number)
         OR lower(btrim(coalesce(po.supplier_invoice_no,'')))=lower(number)
       )
  ) INTO conflict_exists;

  IF NOT conflict_exists THEN RETURN NEW; END IF;

  SELECT name INTO company_label FROM public.companies WHERE id=NEW.company_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'side','supplier','company',company_label,'invoice_number',po.order_no,
    'supplier_invoice_no',po.supplier_invoice_no,'date',po.order_date,
    'status',po.status,'document_id',po.id
  )),'[]'::jsonb)
    INTO conflict_rows
    FROM public.purchase_orders po
   WHERE po.company_id=NEW.company_id
     AND po.id IS DISTINCT FROM NEW.id
     AND (
       lower(btrim(coalesce(po.order_no,'')))=lower(number)
       OR lower(btrim(coalesce(po.supplier_invoice_no,'')))=lower(number)
     );

  IF NOT allow_override OR NOT public.transport_invoice_duplicate_override_allowed('supplier') THEN
    RAISE EXCEPTION 'Supplier invoice number "%" is already in use in this company. Review the duplicate list; authorized override is required.',number;
  END IF;

  INSERT INTO public.transport_invoice_duplicate_override_events(
    side,company_id,business_unit_id,document_id,invoice_number,matches,created_by
  ) VALUES(
    'supplier',NEW.company_id,NEW.business_unit_id,NEW.id,number,conflict_rows,auth.uid()
  );
  RETURN NEW;
END
$function$;

NOTIFY pgrst,'reload schema';
COMMIT;
