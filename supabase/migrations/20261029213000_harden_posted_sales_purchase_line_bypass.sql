BEGIN;

-- A custom GUC alone is not an authorization boundary: authenticated callers can
-- set app.maintenance_reset. Require the server-recognized service role as well.
CREATE OR REPLACE FUNCTION public.prevent_posted_purchase_order_line_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order_id uuid;
  v_status text;
BEGIN
  IF coalesce(current_setting('app.maintenance_reset', true), '0') = '1'
     AND public.navilo_request_role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  SELECT po.status INTO v_status
  FROM public.purchase_orders po
  WHERE po.id = v_order_id;

  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'Lines of a posted purchase order cannot be modified.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    SELECT po.status INTO v_status
    FROM public.purchase_orders po
    WHERE po.id = OLD.order_id;
    IF v_status = 'posted' THEN
      RAISE EXCEPTION 'Lines of a posted purchase order cannot be modified.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.prevent_posted_sales_order_line_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order_id uuid;
  v_status text;
BEGIN
  IF coalesce(current_setting('app.maintenance_reset', true), '0') = '1'
     AND public.navilo_request_role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  SELECT so.status INTO v_status
  FROM public.sales_orders so
  WHERE so.id = v_order_id;

  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'Lines of a posted sales invoice cannot be modified.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    SELECT so.status INTO v_status
    FROM public.sales_orders so
    WHERE so.id = OLD.order_id;
    IF v_status = 'posted' THEN
      RAISE EXCEPTION 'Lines of a posted sales invoice cannot be modified.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;

COMMIT;