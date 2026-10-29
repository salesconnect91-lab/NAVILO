-- Close unconditional source-linked bypasses in posted sales/purchase guards.
-- Posted source documents must use their controlled source workflows; payment-only updates remain scoped.
CREATE OR REPLACE FUNCTION public.prevent_posted_purchase_order_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment_update text;
BEGIN
  IF coalesce(current_setting('app.maintenance_reset', true), '0') = '1'
     AND public.navilo_request_role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'posted' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Posted purchase orders cannot be modified or deleted directly; use the purchase source workflow.';
    END IF;
    v_payment_update := current_setting('app.supplier_payment_update', true);
    IF coalesce(v_payment_update, '0') <> '1' THEN
      RAISE EXCEPTION 'Posted purchase orders cannot be modified directly; use the purchase source workflow.';
    END IF;
    IF (to_jsonb(NEW) - 'paid_amount' - 'outstanding_amount' - 'payment_status')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'paid_amount' - 'outstanding_amount' - 'payment_status') THEN
      RAISE EXCEPTION 'Only payment status fields may change on a posted purchase order.';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_posted_sales_order_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF coalesce(current_setting('app.maintenance_reset',true),'0')='1'
     AND public.navilo_request_role()='service_role' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='posted' THEN
    IF TG_OP='DELETE' THEN
      RAISE EXCEPTION 'Posted sales invoices cannot be deleted directly; use the sales source workflow.';
    END IF;
    IF coalesce(current_setting('app.admin_posted_transport_service_edit',true),'0')='1'
       AND public.company_admin_posted_journal_edit_access()
       AND OLD.document_kind='service'
       AND EXISTS(SELECT 1 FROM public.transport_customer_documents d WHERE d.sales_order_id=OLD.id AND d.journal_entry_id IS NOT NULL)
       AND NEW.status=OLD.status
       AND (to_jsonb(NEW)-ARRAY['total','outstanding_amount','payment_status','updated_at','updated_by'])
           IS NOT DISTINCT FROM
           (to_jsonb(OLD)-ARRAY['total','outstanding_amount','payment_status','updated_at','updated_by']) THEN
      RETURN NEW;
    END IF;
    IF (to_jsonb(NEW)-ARRAY['paid_amount','outstanding_amount','payment_status','updated_at','updated_by'])
       IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['paid_amount','outstanding_amount','payment_status','updated_at','updated_by']) THEN
      RAISE EXCEPTION 'Posted sales invoices are immutable; only the scoped Admin in-place transport edit is allowed.';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;
