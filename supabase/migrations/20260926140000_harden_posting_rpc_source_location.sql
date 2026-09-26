\set ON_ERROR_STOP on

DO $outer$
DECLARE
  f text;
  n text;
BEGIN
  -- ==========================================================
  -- PURCHASE: source lock ke foran baad location assertion
  -- ==========================================================
  SELECT pg_get_functiondef(
    'public.post_purchase_invoice(uuid)'::regprocedure
  ) INTO f;

  IF position('assert_source_operating_location' in lower(f)) = 0 THEN
    n := replace(
      f,
      'if not found then raise exception ''Purchase invoice not found.''; end if;',
      'if not found then raise exception ''Purchase invoice not found.''; end if;' ||
      E'\n  perform public.assert_source_operating_location(' ||
      E'\n    v_order.company_id,' ||
      E'\n    v_order.business_unit_id,' ||
      E'\n    v_order.operating_location_id' ||
      E'\n  );'
    );

    IF n = f THEN
      RAISE EXCEPTION 'ACC005 purchase insertion point not found';
    END IF;

    EXECUTE n;
  END IF;

  -- ==========================================================
  -- SALES CORE: locked v_order milne ke foran baad assertion
  -- ==========================================================
  SELECT pg_get_functiondef(
    'public.post_sales_invoice_core(uuid)'::regprocedure
  ) INTO f;

  IF position('assert_source_operating_location' in lower(f)) = 0 THEN
    n := regexp_replace(
      f,
      '(if[[:space:]]+not[[:space:]]+found[[:space:]]+then[[:space:]]+raise[[:space:]]+exception[[:space:]]+''Sales invoice not found or access denied\.'';[[:space:]]+end[[:space:]]+if;)',
      E'\\1\n\n  perform public.assert_source_operating_location(\n' ||
      E'    v_order.company_id,\n' ||
      E'    v_order.business_unit_id,\n' ||
      E'    v_order.operating_location_id\n' ||
      E'  );',
      'i'
    );

    IF n = f THEN
      RAISE EXCEPTION 'ACC005 sales-core insertion point not found';
    END IF;

    EXECUTE n;
  END IF;

  -- ==========================================================
  -- SALES WRAPPER:
  -- location source SELECT mein lao + UPDATE se PEHLE assert
  -- ==========================================================
  SELECT pg_get_functiondef(
    'public.post_sales_invoice(uuid)'::regprocedure
  ) INTO f;

  IF position('assert_source_operating_location' in lower(f)) = 0 THEN

    n := replace(
      f,
      'v_customer uuid; v_result jsonb;',
      'v_customer uuid; v_source_location uuid; v_result jsonb;'
    );

    IF n = f THEN
      RAISE EXCEPTION 'ACC005 wrapper declaration point not found';
    END IF;
    f := n;

    n := replace(
      f,
      'select customer_id,coalesce(payment_mode,''Credit''),user_id into v_customer,v_mode,v_uid from public.sales_orders',
      'select customer_id,coalesce(payment_mode,''Credit''),user_id,operating_location_id into v_customer,v_mode,v_uid,v_source_location from public.sales_orders'
    );

    IF n = f THEN
      RAISE EXCEPTION 'ACC005 wrapper source SELECT point not found';
    END IF;
    f := n;

    n := replace(
      f,
      'if v_customer is null then raise exception ''Customer is required for every Main Sales Invoice, including cash/bank sales.''; end if;',
      'if v_customer is null then raise exception ''Customer is required for every Main Sales Invoice, including cash/bank sales.''; end if;' ||
      E'\n perform public.assert_source_operating_location(v_company,v_bu,v_source_location);'
    );

    IF n = f THEN
      RAISE EXCEPTION 'ACC005 wrapper assertion point not found';
    END IF;

    EXECUTE n;
  END IF;
END
$outer$;

REVOKE ALL ON FUNCTION public.post_purchase_invoice(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_sales_invoice(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_sales_invoice_core(uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.post_purchase_invoice(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sales_invoice(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sales_invoice_core(uuid)
  TO authenticated;
