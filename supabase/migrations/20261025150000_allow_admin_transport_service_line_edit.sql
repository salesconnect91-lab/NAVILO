-- Permit the existing scoped Admin posted-invoice RPC to update only the
-- service amount on an eligible posted customer transport invoice. Every other
-- posted service-line mutation remains blocked by the billing immutability
-- guard.
BEGIN;

CREATE OR REPLACE FUNCTION public.transport_line_billing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE
  o record;
  s text:=case when tg_table_name in ('sales_service_lines','sales_order_charges') then 'customer' else 'supplier' end;
  taxable boolean:=true;
BEGIN
  IF s='customer' THEN
    SELECT * INTO o FROM public.sales_orders WHERE id=NEW.order_id;
  ELSE
    SELECT * INTO o FROM public.purchase_orders WHERE id=NEW.order_id;
  END IF;
  IF NOT FOUND OR o.document_kind IS DISTINCT FROM 'service'
     OR NOT public.transport_customer_billing_scope(o.company_id,o.business_unit_id) THEN
    RETURN NEW;
  END IF;

  IF o.status<>'draft' THEN
    IF TG_OP='UPDATE'
       AND TG_TABLE_NAME='sales_service_lines'
       AND coalesce(current_setting('app.admin_posted_transport_service_edit',true),'0')='1'
       AND public.company_admin_posted_journal_edit_access()
       AND NEW.order_id=OLD.order_id
       AND (to_jsonb(NEW)-'amount') IS NOT DISTINCT FROM (to_jsonb(OLD)-'amount') THEN
      NEW.tax_percent:=CASE WHEN o.invoice_type='Tax Invoice' THEN o.tax_percent ELSE 0 END;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Posted service billing is immutable';
  END IF;

  IF TG_TABLE_NAME IN ('sales_order_charges','purchase_order_charges') THEN
    SELECT cm.tax_applicable INTO taxable
      FROM public.charge_master cm
     WHERE cm.company_id=o.company_id AND cm.charge_key=NEW.charge_key AND cm.is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active charge master required'; END IF;
  END IF;
  NEW.tax_percent:=CASE WHEN o.invoice_type='Tax Invoice' AND taxable THEN o.tax_percent ELSE 0 END;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.transport_line_billing_guard() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
