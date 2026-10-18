-- Prevent newly posted generated-reference Transport CREDIT service invoices.
-- Preserves existing posted documents, journals, payments, VAT evidence,
-- supplier purchasing, and unrelated non-Transport sales.
CREATE OR REPLACE FUNCTION public.transport_require_original_credit_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $body$
BEGIN
  IF NEW.status IS DISTINCT FROM 'posted'
     OR (TG_OP='UPDATE' AND OLD.status='posted')
     OR NEW.document_kind IS DISTINCT FROM 'service'
     OR lower(coalesce(NEW.payment_mode,''))<>'credit'
     OR NOT public.transport_customer_billing_scope(NEW.company_id,NEW.business_unit_id)
  THEN
    RETURN NEW;
  END IF;

  IF nullif(btrim(NEW.order_no),'') IS NULL
     OR btrim(NEW.order_no) ~* '^H-S-'
     OR upper(btrim(NEW.order_no)) IN
       ('YES','CLEARED','NO INVOICE','BAD DEBTS','PENDING')
  THEN
    RAISE EXCEPTION
      'Credit Transport Sales invoice cannot be posted without a genuine original invoice number. Keep the invoice in Draft and enter the actual number.'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$body$;

-- Deliberately runs after the existing invoice-classification triggers.
CREATE TRIGGER zzzzzzz_transport_credit_original_no_guard
BEFORE INSERT OR UPDATE OF status ON public.sales_orders
FOR EACH ROW EXECUTE FUNCTION public.transport_require_original_credit_invoice_number();
