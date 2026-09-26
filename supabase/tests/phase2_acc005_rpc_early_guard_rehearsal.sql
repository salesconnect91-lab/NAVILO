\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
    p text;
    s text;
    c text;
    guard_pos integer;
    mutation_pos integer;
BEGIN
    p := pg_get_functiondef(
      'public.post_purchase_invoice(uuid)'::regprocedure
    );

    s := pg_get_functiondef(
      'public.post_sales_invoice(uuid)'::regprocedure
    );

    c := pg_get_functiondef(
      'public.post_sales_invoice_core(uuid)'::regprocedure
    );

    IF position('assert_source_operating_location' in p)=0 THEN
      RAISE EXCEPTION
        'ACC-005 FAIL: purchase RPC lacks early source-location guard';
    END IF;

    IF position('assert_source_operating_location' in c)=0 THEN
      RAISE EXCEPTION
        'ACC-005 FAIL: sales core lacks source-location guard';
    END IF;

    IF position('assert_source_operating_location' in s)=0 THEN
      RAISE EXCEPTION
        'ACC-005 FAIL: sales wrapper lacks source-location guard';
    END IF;

    -- Wrapper assertion must precede its source-document UPDATE.
    guard_pos :=
      position('assert_source_operating_location' in lower(s));

    mutation_pos :=
      position('update public.sales_orders' in lower(s));

    IF guard_pos = 0
       OR mutation_pos = 0
       OR guard_pos >= mutation_pos
    THEN
      RAISE EXCEPTION
        'ACC-005 FAIL: sales wrapper guard is not before mutation';
    END IF;

    -- Purchase guard must occur before stock/journal side effects.
    guard_pos :=
      position('assert_source_operating_location' in lower(p));

    mutation_pos :=
      LEAST(
        NULLIF(position('apply_stock_movement' in lower(p)),0),
        NULLIF(position('insert into public.journal_entries' in lower(p)),0)
      );

    IF guard_pos = 0
       OR (mutation_pos IS NOT NULL AND guard_pos >= mutation_pos)
    THEN
      RAISE EXCEPTION
        'ACC-005 FAIL: purchase guard is not before posting side effects';
    END IF;

    RAISE NOTICE
      'ACC-005 PASS: source-location guards are inside actual posting RPCs and precede posting mutations.';
END $$;

ROLLBACK;
