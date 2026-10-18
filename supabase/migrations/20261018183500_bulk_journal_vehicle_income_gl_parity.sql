-- QuickBooks-style revenue GL and Vehicle dimension must reference the same master.
-- Draft import only; no invoices, posted journals or history updated.
BEGIN;
CREATE OR REPLACE FUNCTION public.bulk_load_journal_entries(p_entries jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_data_user_id uuid := public.legacy_data_user_id();
  v_company_id uuid := public.current_company_id();
  v_business_unit_id uuid := public.current_business_unit_id();
  v_entry jsonb;
  v_line jsonb;
  v_entry_no text;
  v_entry_date date;
  v_description text;
  v_entry_id uuid;
  v_account public.chart_of_accounts%rowtype;
  v_account_id uuid;
  v_account_count integer;
  v_debit numeric;
  v_credit numeric;
  v_total_debit numeric;
  v_total_credit numeric;
  v_line_count integer;
  v_created_count integer := 0;
  v_created_entries jsonb := '[]'::jsonb;
  v_ar_account_id uuid;
  v_ap_account_id uuid;
  v_party_type text;
  v_party_name text;
  v_party_id uuid;
  v_party_count integer;
  v_vehicle_no text;
  v_vehicle_id uuid;
  v_linked_income_account uuid;
  v_line_description text;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;
  IF v_company_id IS NULL OR v_business_unit_id IS NULL OR v_data_user_id IS NULL THEN
    RAISE EXCEPTION 'Active company and business unit are required.';
  END IF;

  PERFORM public.assert_module_permission('accounting', 'create');

  IF p_entries IS NULL OR pg_catalog.jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'Journal import payload must be an array.';
  END IF;
  IF pg_catalog.jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'No journal entries were supplied.';
  END IF;
  IF pg_catalog.jsonb_array_length(p_entries) > 200 THEN
    RAISE EXCEPTION 'A maximum of 200 journal entries may be loaded at once.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_entries) item
    GROUP BY lower(btrim(item ->> 'entry_no'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'The import file contains duplicate journal entry numbers.';
  END IF;

  SELECT am.account_id INTO v_ar_account_id
  FROM public.account_mappings am
  WHERE am.user_id = v_data_user_id
    AND am.company_id = v_company_id
    AND am.mapping_key = 'accounts_receivable'
  LIMIT 1;

  SELECT am.account_id INTO v_ap_account_id
  FROM public.account_mappings am
  WHERE am.user_id = v_data_user_id
    AND am.company_id = v_company_id
    AND am.mapping_key = 'accounts_payable'
  LIMIT 1;

  FOR v_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(p_entries)
  LOOP
    IF pg_catalog.jsonb_typeof(v_entry) <> 'object' THEN
      RAISE EXCEPTION 'Every journal entry must be an object.';
    END IF;

    v_entry_no := btrim(coalesce(v_entry ->> 'entry_no', ''));
    IF v_entry_no = '' THEN
      RAISE EXCEPTION 'Journal entry number is required.';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_company_id::text || ':' || v_business_unit_id::text || ':' || lower(v_entry_no), 0)
    );

    IF EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.company_id = v_company_id
        AND je.business_unit_id = v_business_unit_id
        AND lower(btrim(je.entry_no)) = lower(v_entry_no)
    ) THEN
      RAISE EXCEPTION 'Journal entry number "%" already exists.', v_entry_no;
    END IF;

    BEGIN
      v_entry_date := (v_entry ->> 'entry_date')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION '%: entry date must use YYYY-MM-DD format.', v_entry_no;
    END;

    v_description := nullif(btrim(coalesce(v_entry ->> 'description', '')), '');

    IF pg_catalog.jsonb_typeof(v_entry -> 'lines') <> 'array' THEN
      RAISE EXCEPTION '%: journal lines must be an array.', v_entry_no;
    END IF;

    v_line_count := pg_catalog.jsonb_array_length(v_entry -> 'lines');
    IF v_line_count < 2 THEN
      RAISE EXCEPTION '%: at least two journal lines are required.', v_entry_no;
    END IF;

    v_total_debit := 0;
    v_total_credit := 0;

    FOR v_line IN SELECT value FROM pg_catalog.jsonb_array_elements(v_entry -> 'lines')
    LOOP
      BEGIN
        v_debit := round(coalesce(nullif(btrim(v_line ->> 'debit'), '')::numeric, 0), 2);
        v_credit := round(coalesce(nullif(btrim(v_line ->> 'credit'), '')::numeric, 0), 2);
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION '%: debit and credit must be valid numbers.', v_entry_no;
      END;

      IF v_debit < 0 OR v_credit < 0 THEN
        RAISE EXCEPTION '%: debit and credit cannot be negative.', v_entry_no;
      END IF;
      IF (v_debit > 0 AND v_credit > 0) OR (v_debit <= 0 AND v_credit <= 0) THEN
        RAISE EXCEPTION '%: each line must contain either debit or credit.', v_entry_no;
      END IF;

      v_account_count := 0;
      v_account_id := NULL;

      IF nullif(btrim(coalesce(v_line ->> 'account_code', '')), '') IS NOT NULL THEN
        SELECT count(*), (array_agg(coa.id))[1]
          INTO v_account_count, v_account_id
        FROM public.chart_of_accounts coa
        WHERE coa.user_id = v_data_user_id
          AND coa.company_id = v_company_id
          AND lower(btrim(coa.code)) = lower(btrim(v_line ->> 'account_code'));
      ELSIF nullif(btrim(coalesce(v_line ->> 'account_name', '')), '') IS NOT NULL THEN
        SELECT count(*), (array_agg(coa.id))[1]
          INTO v_account_count, v_account_id
        FROM public.chart_of_accounts coa
        LEFT JOIN public.chart_of_accounts parent ON parent.id = coa.parent_id
        WHERE coa.user_id = v_data_user_id
          AND coa.company_id = v_company_id
          AND lower(btrim(coa.name)) = lower(btrim(v_line ->> 'account_name'))
          AND (
            nullif(btrim(coalesce(v_line ->> 'account_head', '')), '') IS NULL
            OR lower(btrim(coalesce(parent.name, coa.parent_head, ''))) = lower(btrim(v_line ->> 'account_head'))
          );
      END IF;

      IF v_account_count = 0 THEN
        RAISE EXCEPTION '%: account was not found.', v_entry_no;
      ELSIF v_account_count > 1 THEN
        RAISE EXCEPTION '%: Account Name is ambiguous; provide the Account Head.', v_entry_no;
      END IF;

      SELECT * INTO v_account
      FROM public.chart_of_accounts
      WHERE id = v_account_id
        AND company_id = v_company_id
        AND user_id = v_data_user_id;

      IF NOT v_account.is_active OR v_account.is_group OR NOT v_account.allow_manual_entries THEN
        RAISE EXCEPTION '%: account "%" is not an active manual posting account.', v_entry_no, v_account.name;
      END IF;

      v_party_type := lower(btrim(coalesce(v_line ->> 'party_type', '')));
      v_party_name := btrim(coalesce(v_line ->> 'party_name', ''));
      IF v_party_type NOT IN ('', 'customer', 'supplier') THEN
        RAISE EXCEPTION '%: invalid party type.', v_entry_no;
      END IF;
      IF v_account.id = v_ar_account_id AND v_party_type <> 'customer' THEN
        RAISE EXCEPTION '%: Accounts Receivable requires a Customer.', v_entry_no;
      END IF;
      IF v_account.id = v_ap_account_id AND v_party_type <> 'supplier' THEN
        RAISE EXCEPTION '%: Accounts Payable requires a Supplier.', v_entry_no;
      END IF;
      IF v_party_type <> '' AND
        ((v_party_type = 'customer' AND v_account.id <> v_ar_account_id) OR
         (v_party_type = 'supplier' AND v_account.id <> v_ap_account_id)) THEN
        RAISE EXCEPTION '%: party can only be linked to its matching AR/AP control account.', v_entry_no;
      END IF;
      IF v_party_type <> '' THEN
        IF v_party_name = '' THEN RAISE EXCEPTION '%: Party Name is required.', v_entry_no; END IF;
        IF v_party_type = 'customer' THEN
          SELECT count(*), (array_agg(c.id))[1] INTO v_party_count, v_party_id
          FROM public.customers c
          WHERE c.user_id = v_data_user_id AND c.company_id = v_company_id
            AND c.account_id = v_ar_account_id AND c.is_active
            AND lower(btrim(c.name)) = lower(v_party_name);
        ELSE
          SELECT count(*), (array_agg(s.id))[1] INTO v_party_count, v_party_id
          FROM public.suppliers s
          WHERE s.user_id = v_data_user_id AND s.company_id = v_company_id
            AND s.account_id = v_ap_account_id AND s.is_active
            AND lower(btrim(s.name)) = lower(v_party_name);
        END IF;
        IF v_party_count <> 1 THEN
          RAISE EXCEPTION '%: Party "%" must match exactly one active linked %.', v_entry_no, v_party_name, v_party_type;
        END IF;
      ELSIF v_party_name <> '' THEN
        RAISE EXCEPTION '%: Party Type is required when Party Name is present.', v_entry_no;
      END IF;

      v_vehicle_no:=btrim(coalesce(v_line->>'vehicle_no',''));
      IF v_vehicle_no<>'' THEN
        IF v_party_type<>'' OR v_account.type NOT IN ('revenue','income','expense')
          OR NOT EXISTS(SELECT 1 FROM public.business_units bu WHERE bu.id=v_business_unit_id
            AND bu.company_id=v_company_id AND bu.unit_type='transport' AND bu.is_active)
        THEN RAISE EXCEPTION '%: Vehicle No only allowed for Transport income/expense without Party.',v_entry_no; END IF;
        IF (SELECT count(DISTINCT v.id)
          FROM public.transport_vehicles v
          WHERE v.company_id=v_company_id AND v.business_unit_id=v_business_unit_id AND v.is_active
            AND upper(btrim(v.vehicle_no))=upper(btrim(split_part(v_vehicle_no,'·',1)))
            AND EXISTS(SELECT 1 FROM public.transport_vehicle_ownership o
              WHERE o.company_id=v_company_id AND o.business_unit_id=v_business_unit_id
                AND o.vehicle_id=v.id AND o.owner_type='company'
                AND o.effective_from<=v_entry_date
                AND (o.effective_to IS NULL OR o.effective_to>=v_entry_date))
        )<>1 THEN RAISE EXCEPTION '%: Vehicle % must be uniquely company-owned on this journal date.',v_entry_no,v_vehicle_no; END IF;
      END IF;
      -- Vehicle number is a tracking dimension, not a second posting.
      -- Revenue must land in that same vehicle's linked Income account.
      IF v_account.type IN ('revenue','income') THEN
        IF v_vehicle_no<>'' THEN
          SELECT v.revenue_account_id INTO v_linked_income_account
          FROM public.transport_vehicles v
          WHERE v.company_id=v_company_id AND v.business_unit_id=v_business_unit_id AND v.is_active
            AND upper(btrim(v.vehicle_no))=upper(btrim(split_part(v_vehicle_no,'·',1)));
          IF v_linked_income_account IS NULL OR v_linked_income_account<>v_account.id THEN
            RAISE EXCEPTION '%: selected Vehicle Income account must match Vehicle % Revenue account from Vehicle Master.',v_entry_no,v_vehicle_no;
          END IF;
        ELSIF EXISTS(
          SELECT 1 FROM public.transport_vehicles v
          WHERE v.company_id=v_company_id AND v.business_unit_id=v_business_unit_id
            AND v.revenue_account_id=v_account.id AND v.is_active
            AND EXISTS(SELECT 1 FROM public.transport_vehicle_ownership o
              WHERE o.company_id=v_company_id AND o.business_unit_id=v_business_unit_id
                AND o.vehicle_id=v.id AND o.owner_type='company'
                AND o.effective_from<=v_entry_date
                AND (o.effective_to IS NULL OR o.effective_to>=v_entry_date))
        ) THEN
          RAISE EXCEPTION '%: Vehicle No is required for a dedicated company vehicle Income account.',v_entry_no;
        END IF;
      END IF;
      v_total_debit := v_total_debit + v_debit;
      v_total_credit := v_total_credit + v_credit;
    END LOOP;

    IF abs(round(v_total_debit, 2) - round(v_total_credit, 2)) >= 0.01 THEN
      RAISE EXCEPTION '%: journal is not balanced. Debit %, Credit %.', v_entry_no, v_total_debit, v_total_credit;
    END IF;

    INSERT INTO public.journal_entries
      (user_id, company_id, business_unit_id, operating_location_id, entry_no, entry_date, description, status)
    VALUES
      (v_data_user_id, v_company_id, v_business_unit_id, public.current_operating_location_id(),
       v_entry_no, v_entry_date, v_description, 'draft')
    RETURNING id INTO v_entry_id;

    FOR v_line IN SELECT value FROM pg_catalog.jsonb_array_elements(v_entry -> 'lines')
    LOOP
      v_debit := round(coalesce(nullif(btrim(v_line ->> 'debit'), '')::numeric, 0), 2);
      v_credit := round(coalesce(nullif(btrim(v_line ->> 'credit'), '')::numeric, 0), 2);
      v_account_id := NULL;

      IF nullif(btrim(coalesce(v_line ->> 'account_code', '')), '') IS NOT NULL THEN
        SELECT coa.id INTO v_account_id
        FROM public.chart_of_accounts coa
        WHERE coa.user_id = v_data_user_id
          AND coa.company_id = v_company_id
          AND lower(btrim(coa.code)) = lower(btrim(v_line ->> 'account_code'));
      ELSE
        SELECT coa.id INTO v_account_id
        FROM public.chart_of_accounts coa
        LEFT JOIN public.chart_of_accounts parent ON parent.id = coa.parent_id
        WHERE coa.user_id = v_data_user_id
          AND coa.company_id = v_company_id
          AND lower(btrim(coa.name)) = lower(btrim(v_line ->> 'account_name'))
          AND (
            nullif(btrim(coalesce(v_line ->> 'account_head', '')), '') IS NULL
            OR lower(btrim(coalesce(parent.name, coa.parent_head, ''))) = lower(btrim(v_line ->> 'account_head'))
          );
      END IF;

      SELECT * INTO v_account FROM public.chart_of_accounts WHERE id = v_account_id;

      v_party_type := lower(btrim(coalesce(v_line ->> 'party_type', '')));
      v_party_name := btrim(coalesce(v_line ->> 'party_name', ''));
      v_party_id := NULL;
      IF v_party_type = 'customer' THEN
        SELECT c.id INTO STRICT v_party_id FROM public.customers c
        WHERE c.user_id = v_data_user_id AND c.company_id = v_company_id
          AND c.account_id = v_ar_account_id AND c.is_active
          AND lower(btrim(c.name)) = lower(v_party_name);
      ELSIF v_party_type = 'supplier' THEN
        SELECT s.id INTO STRICT v_party_id FROM public.suppliers s
        WHERE s.user_id = v_data_user_id AND s.company_id = v_company_id
          AND s.account_id = v_ap_account_id AND s.is_active
          AND lower(btrim(s.name)) = lower(v_party_name);
      END IF;
      v_vehicle_no:=btrim(coalesce(v_line->>'vehicle_no',''));
      v_vehicle_id:=NULL;
      IF v_vehicle_no<>'' THEN
        SELECT v.id INTO STRICT v_vehicle_id FROM public.transport_vehicles v
        WHERE v.company_id=v_company_id AND v.business_unit_id=v_business_unit_id AND v.is_active
          AND upper(btrim(v.vehicle_no))=upper(btrim(split_part(v_vehicle_no,'·',1)))
          AND EXISTS(SELECT 1 FROM public.transport_vehicle_ownership o
            WHERE o.company_id=v_company_id AND o.business_unit_id=v_business_unit_id
              AND o.vehicle_id=v.id AND o.owner_type='company'
              AND o.effective_from<=v_entry_date AND (o.effective_to IS NULL OR o.effective_to>=v_entry_date));
      END IF;
      v_line_description:=nullif(btrim(coalesce(v_line->>'line_description','')),'');
      INSERT INTO public.journal_lines (user_id, company_id, business_unit_id, operating_location_id, entry_id, account_id, account, debit, credit, party_type, party_id, party_name, description, transport_vehicle_id)
      VALUES (
        v_data_user_id,
        v_company_id,
        v_business_unit_id,
        public.current_operating_location_id(),
        v_entry_id,
        v_account.id,
        v_account.name,
        v_debit,
        v_credit,
        nullif(v_party_type, ''),
        v_party_id,
        nullif(v_party_name, ''),
        v_line_description,
        v_vehicle_id
      );
    END LOOP;

    v_created_count := v_created_count + 1;
    v_created_entries := v_created_entries || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id', v_entry_id, 'entry_no', v_entry_no)
    );
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'count', v_created_count,
    'entries', v_created_entries
  );
END;
$function$
;
COMMIT;