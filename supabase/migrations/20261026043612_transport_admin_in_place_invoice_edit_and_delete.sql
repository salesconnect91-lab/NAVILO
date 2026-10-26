-- Scoped Admin controls for direct Trip Register invoices only.
BEGIN;
CREATE SCHEMA IF NOT EXISTS navilo_private;
REVOKE ALL ON SCHEMA navilo_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA navilo_private TO authenticated,service_role;
CREATE TABLE navilo_private.transport_invoice_control_gate(
 transaction_id bigint NOT NULL, actor_id uuid NOT NULL, side text NOT NULL,
 order_id uuid NOT NULL, journal_id uuid NOT NULL, action text NOT NULL,
 PRIMARY KEY(transaction_id,actor_id,side,order_id),
 CHECK(side IN ('customer','supplier')),CHECK(action IN ('edit','delete'))
);
ALTER TABLE navilo_private.transport_invoice_control_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON navilo_private.transport_invoice_control_gate FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION navilo_private.transport_invoice_admin_access() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.business_unit_memberships m JOIN public.user_profiles u ON u.id=m.user_id
 WHERE m.user_id=auth.uid() AND m.company_id=public.current_company_id()
 AND m.business_unit_id=public.current_business_unit_id() AND m.role='admin' AND m.is_active AND u.is_active)
 AND public.current_operating_location_id() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION navilo_private.transport_invoice_admin_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION navilo_private.transport_invoice_admin_access() TO authenticated;
CREATE OR REPLACE FUNCTION public.transport_posted_invoice_admin_access() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT navilo_private.transport_invoice_admin_access()
$$;
REVOKE ALL ON FUNCTION public.transport_posted_invoice_admin_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_posted_invoice_admin_access() TO authenticated;

CREATE OR REPLACE FUNCTION navilo_private.transport_control_journal(p_order uuid,p_side text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT g.journal_id FROM navilo_private.transport_invoice_control_gate g
 WHERE g.transaction_id=txid_current() AND g.actor_id=auth.uid() AND g.order_id=p_order
 AND g.side=p_side AND navilo_private.transport_invoice_admin_access()
$$;
REVOKE ALL ON FUNCTION navilo_private.transport_control_journal(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION navilo_private.transport_control_journal(uuid,text) TO authenticated,service_role;

-- Unknown references fail closed, including SET NULL / CASCADE foreign keys.
CREATE OR REPLACE FUNCTION navilo_private.transport_assert_no_dependents(p_parent regclass,p_id uuid,p_allowed regclass[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record;n bigint;
BEGIN
 FOR r IN SELECT k.conrelid::regclass child,a.attname col FROM pg_constraint k
 CROSS JOIN LATERAL unnest(k.conkey,k.confkey) AS keypair(childnum,parentnum)
 JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=keypair.childnum
 JOIN pg_attribute z ON z.attrelid=k.confrelid AND z.attnum=keypair.parentnum
 WHERE k.contype='f' AND k.confrelid=p_parent AND z.attname='id'
 AND NOT(k.conrelid=ANY(p_allowed)) LOOP
  EXECUTE format('SELECT count(*) FROM %s WHERE %I=$1',r.child,r.col) INTO n USING p_id;
  IF n>0 THEN RAISE EXCEPTION 'Invoice control blocked: % dependent row(s) in %',n,r.child;END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION navilo_private.transport_assert_no_dependents(regclass,uuid,regclass[]) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION navilo_private.transport_control_invoice(
 p_side text,p_order_id uuid,p_action text,p_line_ids uuid[],p_invoice_date date,p_reason text,p_edits jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 o record;d record;j public.journal_entries%rowtype;r record;x jsonb;v_result jsonb;v_check numeric;
 v_doc uuid;v_journal uuid;v_party uuid;v_no text;v_old jsonb;v_old_posted timestamptz;v_old_actor uuid;
 v_old_trips uuid[];v_old_lines uuid[];v_trips uuid[];v_account uuid;v_amount numeric;v_kind text;
 v_adjusted boolean;
 v_gate text:=coalesce(current_setting('app.maintenance_reset',true),'');v_col text;v_order_table regclass;
 v_doc_table regclass;v_service_table regclass;v_charge_table regclass;v_link_table regclass;
BEGIN
 IF NOT navilo_private.transport_invoice_admin_access() THEN RAISE EXCEPTION 'Active company/business-unit Admin required';END IF;
 IF p_side IS NULL OR p_side NOT IN ('customer','supplier') OR p_action IS NULL OR p_action NOT IN ('edit','delete')
 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Side, action and audit reason of at least 10 characters required';END IF;
 PERFORM public.transport_finance_assert(CASE WHEN p_side='customer' THEN 'billing' ELSE 'rent' END);
 PERFORM public.assert_module_permission(CASE WHEN p_side='customer' THEN 'sales' ELSE 'purchase' END,CASE WHEN p_action='delete' THEN 'delete' ELSE 'edit' END);
 IF p_edits IS NULL OR jsonb_typeof(p_edits)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_edits))>500 THEN RAISE EXCEPTION 'Invalid Trip edits';END IF;
 IF p_action='edit' AND (p_invoice_date IS NULL OR p_line_ids IS NULL OR cardinality(p_line_ids) NOT BETWEEN 1 AND 500
 OR cardinality(p_line_ids)<>(SELECT count(DISTINCT z) FROM unnest(p_line_ids) z)) THEN RAISE EXCEPTION 'Date and 1–500 unique Trip lines required';END IF;
 IF p_side='customer' THEN
  v_order_table:='public.sales_orders';v_doc_table:='public.transport_customer_documents';v_service_table:='public.sales_service_lines';
  v_charge_table:='public.sales_order_charges';v_link_table:='public.transport_customer_document_trips';v_col:='sales_order_id';
 ELSE
  v_order_table:='public.purchase_orders';v_doc_table:='public.transport_supplier_documents';v_service_table:='public.purchase_service_lines';
  v_charge_table:='public.purchase_order_charges';v_link_table:='public.transport_supplier_document_rents';v_col:='purchase_order_id';
 END IF;
 EXECUTE format('SELECT * FROM %s WHERE id=$1 AND company_id=$2 AND business_unit_id=$3 AND operating_location_id=$4 FOR UPDATE',v_order_table)
 INTO o USING p_order_id,public.current_company_id(),public.current_business_unit_id(),public.current_operating_location_id();
 IF o.id IS NULL OR o.status<>'posted' OR o.document_kind<>'service' OR (p_action='delete' AND coalesce(o.paid_amount,0)<>0) THEN RAISE EXCEPTION 'Eligible posted direct Trip invoice required in active workspace';END IF;
 v_party:=CASE WHEN p_side='customer' THEN (to_jsonb(o)->>'customer_id')::uuid ELSE (to_jsonb(o)->>'supplier_id')::uuid END;
 v_no:=o.order_no;v_old_posted:=o.posted_at;v_old_actor:=o.posted_by;
 PERFORM pg_advisory_xact_lock(hashtextextended(o.company_id::text||':'||o.business_unit_id::text||':'||p_side||':'||v_party::text,0));
 EXECUTE format('SELECT * FROM %s WHERE %I=$1 FOR UPDATE',v_doc_table,v_col) INTO d USING p_order_id;
 IF d.id IS NULL OR d.company_id<>o.company_id OR d.business_unit_id<>o.business_unit_id OR d.operating_location_id<>o.operating_location_id
 OR d.journal_entry_id IS NULL THEN RAISE EXCEPTION 'Direct posted Register document required';END IF;
 v_doc:=d.id;v_journal:=d.journal_entry_id;
 SELECT * INTO j FROM public.journal_entries WHERE id=v_journal FOR UPDATE;
 IF NOT FOUND OR j.status<>'posted' OR j.company_id<>o.company_id OR j.business_unit_id<>o.business_unit_id
 OR j.operating_location_id<>o.operating_location_id OR j.source_document_id IS DISTINCT FROM o.id
 OR j.reversal_of_entry_id IS NOT NULL OR j.fiscal_year_closure_id IS NOT NULL OR j.monthly_profit_closure_id IS NOT NULL
 OR coalesce(j.exchange_rate,1)<>1 OR j.currency_code IS DISTINCT FROM (SELECT base_currency_code FROM public.companies WHERE id=o.company_id)
 THEN RAISE EXCEPTION 'Base-currency original invoice journal required';END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_periods ap WHERE ap.company_id=o.company_id AND ap.status='closed'
 AND (j.entry_date BETWEEN ap.period_start AND ap.period_end OR (p_action='edit' AND p_invoice_date BETWEEN ap.period_start AND ap.period_end))) THEN
 RAISE EXCEPTION 'Accounting period is closed. Reopen it before correcting or deleting this invoice';END IF;
 IF EXISTS(SELECT 1 FROM public.transport_service_note_lines WHERE side=p_side AND order_id=o.id)
 OR EXISTS(SELECT 1 FROM public.transport_service_refunds WHERE side=p_side AND order_id=o.id)
 OR EXISTS(SELECT 1 FROM public.stock_movements WHERE source_id=o.id)
 OR EXISTS(SELECT 1 FROM public.transport_register_invoice_conversions WHERE order_id=o.id)
 OR public.discount_amount_for(CASE WHEN p_side='customer' THEN 'sales_main' ELSE 'purchase_main' END,o.order_no)<>0
 THEN RAISE EXCEPTION 'Credited, stock, converted/imported or discounted invoices require linked-record correction first';END IF;
 PERFORM navilo_private.transport_assert_no_dependents(v_order_table,o.id,
 ARRAY[v_service_table,v_charge_table,v_doc_table,CASE WHEN p_side='customer' THEN 'public.transport_trips'::regclass ELSE v_link_table END]||CASE WHEN p_action='edit' THEN ARRAY[CASE WHEN p_side='customer' THEN 'public.invoice_payment_allocations'::regclass ELSE 'public.purchase_payment_allocations'::regclass END] ELSE '{}'::regclass[] END);
 PERFORM navilo_private.transport_assert_no_dependents(v_doc_table,v_doc,ARRAY[v_link_table]);
 PERFORM navilo_private.transport_assert_no_dependents('public.journal_entries',v_journal,ARRAY['public.journal_lines'::regclass,'public.ledgers'::regclass,'public.party_ledgers'::regclass,v_doc_table]);
 FOR r IN SELECT id FROM public.journal_lines WHERE entry_id=v_journal LOOP
  PERFORM navilo_private.transport_assert_no_dependents('public.journal_lines',r.id,ARRAY['public.ledgers'::regclass,'public.party_ledgers'::regclass]);
 END LOOP;
 FOR r IN SELECT id FROM public.party_ledgers WHERE journal_entry_id=v_journal LOOP
  PERFORM navilo_private.transport_assert_no_dependents('public.party_ledgers',r.id,'{}'::regclass[]);
 END LOOP;
 FOR r IN SELECT id FROM public.ledgers WHERE journal_entry_id=v_journal LOOP
  PERFORM navilo_private.transport_assert_no_dependents('public.ledgers',r.id,'{}'::regclass[]);
 END LOOP;
 EXECUTE format('SELECT array_agg(trip_id ORDER BY trip_id),array_agg(%I ORDER BY %I) FROM %s WHERE document_id=$1 AND NOT is_adjustment',CASE WHEN p_side='customer' THEN 'trip_id' ELSE 'rent_id' END,CASE WHEN p_side='customer' THEN 'trip_id' ELSE 'rent_id' END,v_link_table)
 INTO v_old_trips,v_old_lines USING v_doc;
 IF cardinality(v_old_lines) IS NULL THEN RAISE EXCEPTION 'Original Trip links required';END IF;
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE document_id=$1 AND is_adjustment)',v_link_table) INTO v_adjusted USING v_doc;
 IF v_adjusted THEN RAISE EXCEPTION 'Adjusted invoices require linked-record correction first';END IF;
 -- All service lines must be direct Trip lines. Imported/standalone history is excluded.
 EXECUTE format('SELECT count(*) FROM %s WHERE order_id=$1 AND (source_module<>''transport'' OR source_id IS NULL)',v_service_table) INTO v_amount USING o.id;
 IF v_amount>0 THEN RAISE EXCEPTION 'Only direct Trip Register invoices are supported';END IF;
 EXECUTE format('SELECT %I FROM %s WHERE order_id=$1 ORDER BY created_at,id LIMIT 1',CASE WHEN p_side='customer' THEN 'revenue_account_id' ELSE 'cost_account_id' END,v_service_table)
 INTO v_account USING o.id;
 IF p_action='edit' THEN
  IF p_side='customer' THEN
   PERFORM 1 FROM public.transport_trips WHERE id=ANY(p_line_ids) ORDER BY id FOR UPDATE;
   SELECT array_agg(id ORDER BY id) INTO v_trips FROM public.transport_trips WHERE id=ANY(p_line_ids) AND company_id=o.company_id AND business_unit_id=o.business_unit_id AND operating_location_id=o.operating_location_id AND customer_id=v_party;
  ELSE
   PERFORM 1 FROM public.transport_trip_supplier_rents WHERE id=ANY(p_line_ids) ORDER BY id FOR UPDATE;
   SELECT array_agg(trip_id ORDER BY id) INTO v_trips FROM public.transport_trip_supplier_rents WHERE id=ANY(p_line_ids) AND company_id=o.company_id AND business_unit_id=o.business_unit_id AND operating_location_id=o.operating_location_id AND supplier_id=v_party;
  END IF;
  IF cardinality(v_trips) IS DISTINCT FROM cardinality(p_line_ids) THEN RAISE EXCEPTION 'Trip selection outside invoice party/workspace';END IF;
  FOR r IN SELECT key,value FROM jsonb_each(p_edits) LOOP
   IF NOT(r.key::uuid=ANY(p_line_ids)) THEN RAISE EXCEPTION 'Edit supplied for an unselected Trip';END IF;
   IF jsonb_typeof(r.value)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(r.value) z WHERE z NOT IN ('base_amount','charges')) THEN RAISE EXCEPTION 'Invalid Trip edit fields';END IF;
   IF r.value ? 'charges' THEN
    IF jsonb_typeof(r.value->'charges')<>'array' OR jsonb_array_length(r.value->'charges')>50 THEN RAISE EXCEPTION 'At most 50 charge lines are allowed';END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(r.value->'charges') z GROUP BY z->>'charge_master_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate charge type';END IF;
    FOR x IN SELECT value FROM jsonb_array_elements(r.value->'charges') LOOP
     v_check:=(x->>'amount')::numeric;
     IF nullif(x->>'charge_master_id','') IS NULL OR v_check IS NULL OR v_check::text IN ('NaN','Infinity','-Infinity') OR v_check<=0 OR round(v_check,2)<>v_check THEN RAISE EXCEPTION 'Every charge needs a valid type and positive amount to two decimals';END IF;
    END LOOP;
   END IF;
  END LOOP;
 END IF;
 FOR r IN EXECUTE format('SELECT id FROM %s WHERE order_id=$1',v_service_table) USING o.id LOOP
  PERFORM navilo_private.transport_assert_no_dependents(v_service_table,r.id,'{}'::regclass[]);
 END LOOP;
 FOR r IN EXECUTE format('SELECT id FROM %s WHERE order_id=$1',v_charge_table) USING o.id LOOP
  PERFORM navilo_private.transport_assert_no_dependents(v_charge_table,r.id,'{}'::regclass[]);
 END LOOP;
 FOR r IN EXECUTE format('SELECT id FROM %s WHERE document_id=$1',v_link_table) USING v_doc LOOP
  PERFORM navilo_private.transport_assert_no_dependents(v_link_table,r.id,'{}'::regclass[]);
 END LOOP;
 v_old:=jsonb_build_object('invoice',to_jsonb(o),'document',to_jsonb(d),'journal',to_jsonb(j),'trip_ids',v_old_trips,
 'journal_lines',(SELECT jsonb_agg(to_jsonb(z)) FROM public.journal_lines z WHERE entry_id=v_journal),
 'ledgers',(SELECT jsonb_agg(to_jsonb(z)) FROM public.ledgers z WHERE journal_entry_id=v_journal),
 'party_ledgers',(SELECT jsonb_agg(to_jsonb(z)) FROM public.party_ledgers z WHERE journal_entry_id=v_journal),
 'source_trips',(SELECT jsonb_agg(to_jsonb(z)) FROM public.transport_trips z WHERE id=ANY(coalesce(v_old_trips,'{}'::uuid[])||coalesce(v_trips,'{}'::uuid[]))),
 'customer_charges',(SELECT jsonb_agg(to_jsonb(z)) FROM public.transport_trip_customer_charges z WHERE p_side='customer' AND trip_id=ANY(coalesce(v_old_trips,'{}'::uuid[])||coalesce(v_trips,'{}'::uuid[]))),
 'supplier_rents',(SELECT jsonb_agg(to_jsonb(z)) FROM public.transport_trip_supplier_rents z WHERE p_side='supplier' AND trip_id=ANY(coalesce(v_old_trips,'{}'::uuid[])||coalesce(v_trips,'{}'::uuid[]))),
 'supplier_charges',(SELECT jsonb_agg(to_jsonb(z)) FROM public.transport_trip_supplier_charges z WHERE p_side='supplier' AND trip_id=ANY(coalesce(v_old_trips,'{}'::uuid[])||coalesce(v_trips,'{}'::uuid[]))));
 EXECUTE format('SELECT $1||jsonb_build_object(''lines'',(SELECT jsonb_agg(to_jsonb(z)) FROM %s z WHERE order_id=$2),''charges'',(SELECT jsonb_agg(to_jsonb(z)) FROM %s z WHERE order_id=$2),''links'',(SELECT jsonb_agg(to_jsonb(z)) FROM %s z WHERE document_id=$3))',v_service_table,v_charge_table,v_link_table)
 INTO v_old USING v_old,o.id,v_doc;
 INSERT INTO navilo_private.transport_invoice_control_gate VALUES(txid_current(),auth.uid(),p_side,o.id,v_journal,p_action);
 PERFORM set_config('app.maintenance_reset','1',true);
 EXECUTE format('UPDATE %s SET status=''draft'',posted_at=NULL,posted_by=NULL WHERE id=$1',v_order_table) USING o.id;
 EXECUTE format('UPDATE %s SET journal_entry_id=NULL WHERE id=$1',v_doc_table) USING v_doc;
 EXECUTE format('DELETE FROM %s WHERE document_id=$1',v_link_table) USING v_doc;
 IF p_side='customer' THEN UPDATE public.transport_trips SET sales_order_id=NULL WHERE sales_order_id=o.id;END IF;
 DELETE FROM public.party_ledgers WHERE journal_entry_id=v_journal;
 DELETE FROM public.ledgers WHERE journal_entry_id=v_journal;
 DELETE FROM public.journal_lines WHERE entry_id=v_journal;
 IF p_action='delete' THEN
  EXECUTE format('DELETE FROM %s WHERE order_id=$1',v_service_table) USING o.id;
  EXECUTE format('DELETE FROM %s WHERE order_id=$1',v_charge_table) USING o.id;
  EXECUTE format('DELETE FROM %s WHERE id=$1',v_doc_table) USING v_doc;
  EXECUTE format('DELETE FROM %s WHERE id=$1',v_order_table) USING o.id;
  DELETE FROM public.journal_entries WHERE id=v_journal;
  v_result:=jsonb_build_object('success',true,'deleted',true,'order_id',o.id,'invoice_no',v_no,'trip_ids',v_old_trips);
 ELSE
  UPDATE public.journal_entries SET status='draft',entry_date=p_invoice_date WHERE id=v_journal;
  FOR r IN SELECT key,value FROM jsonb_each(p_edits) LOOP
   IF r.value ? 'charges' THEN
    IF p_side='customer' THEN PERFORM public.transport_replace_trip_customer_charges(r.key::uuid,r.value->'charges',p_reason);
    ELSE PERFORM public.transport_replace_trip_supplier_charges(r.key::uuid,r.value->'charges',p_reason);END IF;
   END IF;
   IF r.value ? 'base_amount' THEN
    v_amount:=(r.value->>'base_amount')::numeric;
    IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<=0 OR round(v_amount,2)<>v_amount THEN RAISE EXCEPTION 'Positive base amount to two decimals required';END IF;
    IF p_side='customer' THEN PERFORM public.transport_finalize_customer_rate(r.key::uuid,v_amount,'manual',p_reason);
    ELSE PERFORM public.transport_finalize_supplier_rent(r.key::uuid,v_amount,p_reason);END IF;
   END IF;
  END LOOP;
  v_result:=public.transport_edit_register_draft_invoice(p_side,v_doc,p_line_ids,p_invoice_date,v_no,v_account);
  IF p_side='customer' THEN v_result:=public.transport_post_customer_draft(v_doc);
  ELSE v_result:=public.transport_post_supplier_draft(v_doc);END IF;
  IF (v_result->>'journal_entry_id')::uuid IS DISTINCT FROM v_journal THEN RAISE EXCEPTION 'Original journal ID was not preserved';END IF;
  EXECUTE format('UPDATE %s SET posted_at=$2,posted_by=$3 WHERE id=$1',v_order_table) USING o.id,v_old_posted,v_old_actor;
  PERFORM public.transport_refresh_document_balance(p_side,o.id);
  v_result:=v_result||jsonb_build_object('success',true,'updated_in_place',true,'invoice_no',v_no,'order_id',o.id);
 END IF;
 -- Restore chronological running balances after historical corrections/deletions.
 WITH running AS (SELECT id,sum(debit-credit) OVER(ORDER BY entry_date,created_at,id ROWS UNBOUNDED PRECEDING) amount
 FROM public.party_ledgers WHERE company_id=o.company_id AND business_unit_id=o.business_unit_id
 AND operating_location_id=o.operating_location_id AND party_type=p_side AND party_id=v_party)
 UPDATE public.party_ledgers p SET balance=running_row.amount FROM running running_row WHERE p.id=running_row.id;
 INSERT INTO public.owner_posted_control_events(company_id,business_unit_id,document_type,document_id,action_type,reason,performed_by,metadata)
 VALUES(o.company_id,o.business_unit_id,'transport_'||p_side||'_invoice',o.id,CASE WHEN p_action='delete' THEN 'permanent_delete' ELSE 'admin_edit_posted' END,btrim(p_reason),auth.uid(),jsonb_build_object('before',v_old,'result',v_result,'new_line_ids',p_line_ids,'edits',p_edits,'no_reversal',true));
 PERFORM public._transport_register_dirty_trips(coalesce(v_old_trips,'{}'::uuid[])||coalesce(v_trips,'{}'::uuid[]));
 DELETE FROM navilo_private.transport_invoice_control_gate WHERE transaction_id=txid_current() AND actor_id=auth.uid() AND order_id=o.id AND side=p_side;
 PERFORM set_config('app.maintenance_reset',v_gate,true);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION navilo_private.transport_control_invoice(text,uuid,text,uuid[],date,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION navilo_private.transport_control_invoice(text,uuid,text,uuid[],date,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.transport_admin_edit_posted_invoice(p_side text,p_order_id uuid,p_line_ids uuid[],p_invoice_date date,p_reason text,p_edits jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT navilo_private.transport_control_invoice(p_side,p_order_id,'edit',p_line_ids,p_invoice_date,p_reason,p_edits)
$$;
CREATE OR REPLACE FUNCTION public.transport_admin_delete_posted_invoice(p_side text,p_order_id uuid,p_reason text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT navilo_private.transport_control_invoice(p_side,p_order_id,'delete',NULL,NULL,p_reason,'{}'::jsonb)
$$;
REVOKE ALL ON FUNCTION public.transport_admin_edit_posted_invoice(text,uuid,uuid[],date,text,jsonb),public.transport_admin_delete_posted_invoice(text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_admin_edit_posted_invoice(text,uuid,uuid[],date,text,jsonb),public.transport_admin_delete_posted_invoice(text,uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.prevent_posted_sales_order_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF navilo_private.transport_control_journal(OLD.id,'customer') IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 END IF;
  IF coalesce(current_setting('app.maintenance_reset',true),'0')='1'
     AND public.navilo_request_role()='service_role' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='posted' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Posted sales invoices cannot be deleted.'; END IF;
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
$function$
;
CREATE OR REPLACE FUNCTION public.prevent_posted_purchase_order_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment_update text;
BEGIN
 IF navilo_private.transport_control_journal(OLD.id,'supplier') IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 END IF;
  IF coalesce(current_setting('app.maintenance_reset', true), '0') = '1'
     AND public.navilo_request_role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'posted' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Posted purchase orders cannot be modified or deleted.';
    END IF;

    v_payment_update := current_setting('app.supplier_payment_update', true);

    IF coalesce(v_payment_update, '0') <> '1' THEN
      RAISE EXCEPTION 'Posted purchase orders cannot be modified or deleted.';
    END IF;

    IF (to_jsonb(NEW)
        - 'paid_amount' - 'outstanding_amount' - 'payment_status')
       IS DISTINCT FROM
       (to_jsonb(OLD)
        - 'paid_amount' - 'outstanding_amount' - 'payment_status') THEN
      RAISE EXCEPTION
        'Only payment status fields may change on a posted purchase order.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.post_service_purchase_invoice_core(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare o public.purchase_orders%rowtype;v_sub numeric;v_charge numeric;v_vat numeric;v_total numeric;v_ap uuid;v_tax uuid;v_name text;v_j uuid;r record;
begin
 perform public.assert_module_permission('purchase','post');
 perform public.transport_refresh_draft_billing('supplier',p_order_id);
 select * into o from public.purchase_orders where id=p_order_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id() for update;
 if not found or o.document_kind<>'service' or o.status='posted' or exists(select 1 from public.purchase_order_lines where order_id=o.id) or exists(select 1 from public.purchase_order_consolidated_invoices where purchase_order_id=o.id) or public.discount_amount_for('purchase_main',o.order_no)<>0 then raise exception 'Eligible service Purchase document without inventory lines required';end if;
 select coalesce(sum(amount),0),coalesce(sum(coalesce(historical_vat_amount,round(amount*tax_percent/100,2))),0) into v_sub,v_vat from public.purchase_service_lines where order_id=o.id;
 select coalesce(sum(amount),0),v_vat+coalesce(sum(round(amount*tax_percent/100,2)),0) into v_charge,v_vat from public.purchase_order_charges where order_id=o.id and company_id=o.company_id and business_unit_id=o.business_unit_id;
 if v_sub<=0 or o.supplier_id is null then raise exception 'Supplier and positive service lines required';end if;v_total:=round(v_sub+v_charge+v_vat,2);v_ap:=public.fx_mapping_account(o.user_id,o.company_id,'accounts_payable','liability');if v_vat>0 then v_tax:=public.fx_mapping_account(o.user_id,o.company_id,'input_vat','asset');end if;
 select name into v_name from public.suppliers where id=o.supplier_id and company_id=o.company_id and user_id=o.user_id and (account_id=v_ap or account_id is null);if v_name is null then raise exception 'Supplier/AP mapping mismatch';end if;
 for r in select cost_account_id,sum(amount) amount from (select cost_account_id,amount from public.purchase_service_lines where order_id=o.id union all select cost_account_id,amount from public.purchase_order_charges where order_id=o.id) q group by cost_account_id loop if not exists(select 1 from public.chart_of_accounts a where a.id=r.cost_account_id and a.company_id=o.company_id and a.type='expense' and a.is_active and not a.is_group) then raise exception 'Active service expense account required';end if;end loop;
 v_j:=navilo_private.transport_control_journal(o.id,'supplier');
 IF v_j IS NULL THEN
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,party_name,trans_type,source_module,source_document_type,source_document_id) values(o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,'PUR-'||o.order_no,o.order_date,'Service Purchase Invoice '||o.order_no,'draft',v_name,'Purchase','purchase','purchase_invoice',o.id) returning id into v_j;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.journal_entries WHERE id=v_j AND status='draft' AND source_document_id=o.id AND company_id=o.company_id AND business_unit_id=o.business_unit_id AND operating_location_id=o.operating_location_id) THEN RAISE EXCEPTION 'Controlled original journal not ready';END IF;
 END IF;
 for r in select cost_account_id,sum(amount) amount from (select cost_account_id,amount from public.purchase_service_lines where order_id=o.id union all select cost_account_id,amount from public.purchase_order_charges where order_id=o.id) q group by cost_account_id loop insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit) select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,a.id,a.code||' - '||a.name,r.amount,0 from public.chart_of_accounts a where a.id=r.cost_account_id;end loop;
 if v_vat>0 then insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit) select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,a.id,a.code||' - '||a.name,v_vat,0 from public.chart_of_accounts a where a.id=v_tax;end if;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name) select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,a.id,a.code||' - '||a.name,0,v_total,'supplier',o.supplier_id,v_name from public.chart_of_accounts a where a.id=v_ap;
 perform public.post_journal_entry(v_j);update public.purchase_orders set status='posted',total=v_total,posted_at=now(),posted_by=auth.uid(),updated_at=now() where id=o.id and status<>'posted';
 return jsonb_build_object('success',true,'order_id',o.id,'journal_entry_id',v_j,'subtotal_excluding_vat',v_sub+v_charge,'charges',v_charge,'vat',v_vat,'grand_total',v_total,'status','posted');
end $function$
;
CREATE OR REPLACE FUNCTION public.post_service_sales_invoice_core(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  o public.sales_orders%rowtype;
  v_sub numeric;
  v_charge numeric;
  v_vat numeric;
  v_total numeric;
  v_ar uuid;
  v_default_rev uuid;
  v_tax uuid;
  v_j uuid;
  v_customer text;
  r record;
begin
  perform public.assert_module_permission('sales','post');
 perform public.transport_refresh_draft_billing('customer',p_order_id);

  select *
    into o
  from public.sales_orders
  where id=p_order_id
    and company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
    and operating_location_id=public.current_operating_location_id()
  for update;

  if not found
     or o.document_kind<>'service'
     or o.status='posted'
     or exists(select 1 from public.sales_order_lines where order_id=p_order_id)
     or exists(select 1 from public.consolidated_sales_invoices where main_sales_order_id=p_order_id)
     or public.discount_amount_for('sales_main',o.order_no)<>0
  then
    raise exception 'Eligible service Sales document without inventory lines required';
  end if;

  select coalesce(sum(amount),0),
         coalesce(sum(coalesce(historical_vat_amount,round(amount*tax_percent/100,2))),0)
    into v_sub,v_vat
  from public.sales_service_lines
  where order_id=o.id
    and company_id=o.company_id
    and business_unit_id=o.business_unit_id;

  select coalesce(sum(amount),0),
         v_vat+coalesce(sum(round(amount*tax_percent/100,2)),0)
    into v_charge,v_vat
  from public.sales_order_charges
  where order_id=o.id
    and company_id=o.company_id
    and business_unit_id=o.business_unit_id;

  if v_sub<=0 or o.customer_id is null then
    raise exception 'Customer and positive service lines required';
  end if;

  v_total:=round(v_sub+v_charge+v_vat,2);
  v_ar:=public.fx_mapping_account(o.user_id,o.company_id,'accounts_receivable','asset');
  v_default_rev:=public.fx_mapping_account(o.user_id,o.company_id,'service_revenue','revenue');
  if v_vat>0 then
    v_tax:=public.fx_mapping_account(o.user_id,o.company_id,'output_vat','liability');
  end if;

  update public.customers
     set account_id=v_ar
   where id=o.customer_id
     and company_id=o.company_id
     and user_id=o.user_id
     and account_id is null;

  select name
    into v_customer
  from public.customers
  where id=o.customer_id
    and company_id=o.company_id
    and user_id=o.user_id
    and account_id=v_ar;

  if v_customer is null then
    raise exception 'Customer/AR mapping mismatch';
  end if;

  for r in
    select coalesce(l.revenue_account_id,v_default_rev) as account_id,
           sum(l.amount) as amount
    from public.sales_service_lines l
    where l.order_id=o.id
      and l.company_id=o.company_id
      and l.business_unit_id=o.business_unit_id
    group by coalesce(l.revenue_account_id,v_default_rev)
  loop
    if not exists(
      select 1
      from public.chart_of_accounts a
      where a.id=r.account_id
        and a.company_id=o.company_id
        and a.type='revenue'
        and a.is_active
        and not a.is_group
    ) then
      raise exception 'Active service revenue account required';
    end if;
  end loop;

  for r in
    select account_id,sum(amount) amount
    from public.sales_order_charges
    where order_id=o.id
    group by account_id
  loop
    if not exists(
      select 1
      from public.chart_of_accounts a
      where a.id=r.account_id
        and a.company_id=o.company_id
        and a.type='revenue'
        and a.is_active
        and not a.is_group
    ) then
      raise exception 'Active charge revenue account required';
    end if;
  end loop;

  v_j:=navilo_private.transport_control_journal(o.id,'customer');
 IF v_j IS NULL THEN
 insert into public.journal_entries(
    user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,
    description,status,party_name,trans_type,source_module,source_document_type,source_document_id
  )
  values(
    o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,o.order_no,o.order_date,
    'Service Sales Invoice '||o.order_no,'draft',v_customer,'Sales Invoice','sales','sales_invoice',o.id
  )
  returning id into v_j;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.journal_entries WHERE id=v_j AND status='draft' AND source_document_id=o.id AND company_id=o.company_id AND business_unit_id=o.business_unit_id AND operating_location_id=o.operating_location_id) THEN RAISE EXCEPTION 'Controlled original journal not ready';END IF;
 END IF;

  insert into public.journal_lines(
    user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,
    debit,credit,party_type,party_id,party_name
  )
  select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,
         a.id,a.code||' - '||a.name,v_total,0,'customer',o.customer_id,v_customer
  from public.chart_of_accounts a
  where a.id=v_ar;

  for r in
    select coalesce(l.revenue_account_id,v_default_rev) as account_id,
           sum(l.amount) as amount
    from public.sales_service_lines l
    where l.order_id=o.id
      and l.company_id=o.company_id
      and l.business_unit_id=o.business_unit_id
    group by coalesce(l.revenue_account_id,v_default_rev)
  loop
    insert into public.journal_lines(
      user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit
    )
    select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,
           a.id,a.code||' - '||a.name,0,r.amount
    from public.chart_of_accounts a
    where a.id=r.account_id;
  end loop;

  for r in
    select account_id,sum(amount) amount
    from public.sales_order_charges
    where order_id=o.id
    group by account_id
  loop
    insert into public.journal_lines(
      user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit
    )
    select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,
           a.id,a.code||' - '||a.name,0,r.amount
    from public.chart_of_accounts a
    where a.id=r.account_id;
  end loop;

  if v_vat>0 then
    insert into public.journal_lines(
      user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit
    )
    select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,
           a.id,a.code||' - '||a.name,0,v_vat
    from public.chart_of_accounts a
    where a.id=v_tax;
  end if;

  perform public.post_journal_entry(v_j);

  update public.sales_orders
     set status='posted',
         total=v_total,
         posted_at=now(),
         posted_by=auth.uid(),
         updated_at=now()
   where id=o.id
     and status<>'posted';

  return jsonb_build_object(
    'success',true,
    'order_id',o.id,
    'journal_entry_id',v_j,
    'subtotal_excluding_vat',v_sub+v_charge,
    'charges',v_charge,
    'vat',v_vat,
    'grand_total',v_total,
    'status','posted'
  );
end
$function$
;
CREATE OR REPLACE FUNCTION navilo_private.transport_posted_invoice_edit_context(p_side text, p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_order uuid; v_context jsonb;
BEGIN
  IF NOT navilo_private.transport_invoice_admin_access() THEN RAISE EXCEPTION 'Active company/business-unit Admin required'; END IF;
  IF p_side='customer' THEN
    PERFORM public.transport_finance_assert('billing');
    PERFORM public.assert_module_permission('sales','edit');
    SELECT d.sales_order_id INTO v_order
      FROM public.transport_customer_documents d JOIN public.sales_orders o ON o.id=d.sales_order_id
     WHERE d.id=p_document_id AND d.company_id=public.current_company_id()
       AND d.business_unit_id=public.current_business_unit_id()
       AND d.operating_location_id=public.current_operating_location_id()
       AND d.journal_entry_id IS NOT NULL AND o.status='posted' AND o.document_kind='service'
       AND o.posted_at IS NOT NULL FOR UPDATE OF d,o;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only a posted customer Register invoice can be edited'; END IF;
    SELECT jsonb_build_object(
      'side','customer','document_id',d.id,'order_id',o.id,'invoice_no',o.order_no,
      'invoice_date',o.order_date,'party_id',d.customer_id,'party_name',c.name,
      'invoice_type',o.invoice_type,'tax_percent',o.tax_percent,
      'account_id',(SELECT sl.revenue_account_id FROM public.sales_service_lines sl WHERE sl.order_id=o.id ORDER BY sl.created_at,sl.id LIMIT 1),
      'line_ids',coalesce((SELECT jsonb_agg(l.trip_id::text ORDER BY l.trip_id) FROM public.transport_customer_document_trips l WHERE l.document_id=d.id AND NOT l.is_adjustment),'[]'::jsonb),
      'trip_ids',coalesce((SELECT jsonb_agg(l.trip_id::text ORDER BY l.trip_id) FROM public.transport_customer_document_trips l WHERE l.document_id=d.id AND NOT l.is_adjustment),'[]'::jsonb)
    ) INTO v_context FROM public.transport_customer_documents d JOIN public.sales_orders o ON o.id=d.sales_order_id
      JOIN public.customers c ON c.id=d.customer_id WHERE d.id=p_document_id;
  ELSIF p_side='supplier' THEN
    PERFORM public.transport_finance_assert('rent');
    PERFORM public.assert_module_permission('purchase','edit');
    SELECT d.purchase_order_id INTO v_order
      FROM public.transport_supplier_documents d JOIN public.purchase_orders o ON o.id=d.purchase_order_id
     WHERE d.id=p_document_id AND d.company_id=public.current_company_id()
       AND d.business_unit_id=public.current_business_unit_id()
       AND d.operating_location_id=public.current_operating_location_id()
       AND d.journal_entry_id IS NOT NULL AND o.status='posted' AND o.document_kind='service'
       AND o.posted_at IS NOT NULL FOR UPDATE OF d,o;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only a posted supplier Register invoice can be edited'; END IF;
    SELECT jsonb_build_object(
      'side','supplier','document_id',d.id,'order_id',o.id,'invoice_no',o.order_no,
      'invoice_date',o.order_date,'supplier_invoice_no',o.supplier_invoice_no,
      'party_id',d.supplier_id,'party_name',s.name,
      'invoice_type',o.invoice_type,'tax_percent',o.tax_percent,
      'account_id',(SELECT sl.cost_account_id FROM public.purchase_service_lines sl WHERE sl.order_id=o.id ORDER BY sl.created_at,sl.id LIMIT 1),
      'line_ids',coalesce((SELECT jsonb_agg(l.rent_id::text ORDER BY l.rent_id) FROM public.transport_supplier_document_rents l WHERE l.document_id=d.id AND NOT l.is_adjustment),'[]'::jsonb),
      'trip_ids',coalesce((SELECT jsonb_agg(DISTINCT l.trip_id::text ORDER BY l.trip_id::text) FROM public.transport_supplier_document_rents l WHERE l.document_id=d.id AND NOT l.is_adjustment),'[]'::jsonb)
    ) INTO v_context FROM public.transport_supplier_documents d JOIN public.purchase_orders o ON o.id=d.purchase_order_id
      JOIN public.suppliers s ON s.id=d.supplier_id WHERE d.id=p_document_id;
  ELSE
    RAISE EXCEPTION 'Invoice side must be customer or supplier';
  END IF;
  IF jsonb_array_length(coalesce(v_context->'line_ids','[]'::jsonb))=0 THEN RAISE EXCEPTION 'Draft invoice has no linked trips'; END IF;
  RETURN v_context;
END
$function$
;
REVOKE ALL ON FUNCTION navilo_private.transport_posted_invoice_edit_context(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION navilo_private.transport_posted_invoice_edit_context(text,uuid) TO authenticated;
CREATE FUNCTION public.transport_register_posted_invoice_edit_context(p_side text,p_document_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$ SELECT navilo_private.transport_posted_invoice_edit_context(p_side,p_document_id) $$;
REVOKE ALL ON FUNCTION public.transport_register_posted_invoice_edit_context(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_register_posted_invoice_edit_context(text,uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.stamp_posted_record_actor() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $actor$
BEGIN
 IF TG_TABLE_NAME IN ('sales_orders','purchase_orders') AND navilo_private.transport_control_journal(OLD.id,CASE WHEN TG_TABLE_NAME='sales_orders' THEN 'customer' ELSE 'supplier' END) IS NOT NULL THEN RETURN NEW;END IF;
 IF NEW.status='posted' AND OLD.status IS DISTINCT FROM 'posted' THEN NEW.posted_by:=coalesce(auth.uid(),NEW.posted_by);NEW.posted_at:=coalesce(NEW.posted_at,now());
 ELSIF OLD.status='posted' THEN NEW.posted_by:=OLD.posted_by;NEW.posted_at:=OLD.posted_at;END IF;
 RETURN NEW;
END $actor$;
DO $legacy$
DECLARE definition text;updated text;
BEGIN
 SELECT pg_get_functiondef('public.admin_edit_posted_transport_service_invoice(uuid,numeric,text)'::regprocedure) INTO definition;
 updated:=replace(definition,'NOT public.company_admin_posted_journal_edit_access()','NOT navilo_private.transport_invoice_admin_access()');
 IF updated=definition THEN RAISE EXCEPTION 'Legacy transport edit authorization changed; review before release';END IF;
 EXECUTE updated;
END $legacy$;
CREATE OR REPLACE FUNCTION public.guard_journal_fx_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_base text; v_rate numeric;
begin
  if tg_op='UPDATE' and old.status='posted' then
    if navilo_private.transport_control_journal(old.source_document_id,case when old.source_module='sales' then 'customer' when old.source_module='purchase' then 'supplier' else '' end)=old.id
       and new.currency_code is not distinct from old.currency_code and new.exchange_rate is not distinct from old.exchange_rate
       and new.company_id is not distinct from old.company_id and new.business_unit_id is not distinct from old.business_unit_id
       and new.operating_location_id is not distinct from old.operating_location_id
       and new.source_document_id is not distinct from old.source_document_id and new.source_module is not distinct from old.source_module
       and new.entry_no is not distinct from old.entry_no then return new;end if;
    if new.currency_code is distinct from old.currency_code or
       new.exchange_rate is distinct from old.exchange_rate or
       new.entry_date is distinct from old.entry_date or
       new.company_id is distinct from old.company_id then
      raise exception 'Posted journal currency, rate, date and company are immutable';
    end if;
    return new;
  end if;

  select c.base_currency_code into v_base from public.companies c where c.id=new.company_id;
  if v_base is null then raise exception 'Journal company is required for currency conversion'; end if;
  if tg_op='INSERT' then new.currency_code:=coalesce(new.currency_code,v_base); end if;
  if new.currency_code is null then raise exception 'Journal currency is required'; end if;
  if tg_op='UPDATE'
     and exists(select 1 from public.journal_lines where entry_id=old.id)
     and (
       new.currency_code is distinct from old.currency_code or
       new.company_id is distinct from old.company_id or
       new.exchange_rate is distinct from old.exchange_rate or
       (
         new.entry_date is distinct from old.entry_date
         and (
           new.currency_code is distinct from v_base
           or old.currency_code is distinct from v_base
           or old.exchange_rate is distinct from 1::numeric
         )
       )
     ) then
    raise exception 'Remove draft journal lines before changing foreign currency, rate, date or company';
  end if;
  if tg_op='INSERT' or new.currency_code is distinct from old.currency_code or
     new.entry_date is distinct from old.entry_date or new.company_id is distinct from old.company_id then
    if new.currency_code=v_base then
      v_rate:=1;
    else
      select r.rate into v_rate from public.company_exchange_rates r
      where r.company_id=new.company_id and r.base_currency_code=v_base
        and r.foreign_currency_code=new.currency_code and r.effective_on<=new.entry_date
      order by r.effective_on desc,r.recorded_at desc,r.id desc limit 1;
      if v_rate is null then raise exception 'No company exchange rate for % on %',new.currency_code,new.entry_date; end if;
    end if;
    new.exchange_rate:=v_rate;
  elsif new.exchange_rate is distinct from old.exchange_rate then
    raise exception 'Exchange rate is derived from company effective date history';
  end if;
  return new;
end $function$
;

NOTIFY pgrst,'reload schema';
COMMIT;
