-- Platform super-admin only: permanent deletion of standalone posted manual journals.
-- Linked source documents and unknown dependent records are deliberately rejected.
CREATE OR REPLACE FUNCTION public.platform_admin_permanent_delete_manual_journal(
 p_entry_id uuid, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp'
AS $body$
DECLARE
 v_entry public.journal_entries%rowtype;
 v_fk record;
 v_count bigint;
 v_old_gate text;
 v_line_snapshot jsonb;
 v_ledger_snapshot jsonb;
 v_party_snapshot jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_platform_owner()
    OR NOT public.owner_posted_control_access() THEN
   RAISE EXCEPTION 'Only NAVILO platform super admin can permanently delete posted journals.';
 END IF;
 IF length(btrim(coalesce(p_reason,''))) < 10 THEN
   RAISE EXCEPTION 'Permanent deletion reason must be at least 10 characters.';
 END IF;
 SELECT * INTO v_entry FROM public.journal_entries WHERE id=p_entry_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Journal entry not found.'; END IF;
 IF v_entry.company_id IS DISTINCT FROM public.current_company_id()
    OR v_entry.business_unit_id IS DISTINCT FROM public.current_business_unit_id() THEN
   RAISE EXCEPTION 'Journal entry does not belong to the selected company/business unit.';
 END IF;
 IF v_entry.status <> 'posted'
    OR v_entry.source_module IS DISTINCT FROM 'accounting'
    OR v_entry.source_document_id IS NOT NULL
    OR v_entry.source_document_type IS NOT NULL
    OR v_entry.reversal_of_entry_id IS NOT NULL
    OR v_entry.fiscal_year_closure_id IS NOT NULL
    OR v_entry.monthly_profit_closure_id IS NOT NULL THEN
   RAISE EXCEPTION 'Only standalone posted accounting journals can be permanently deleted here.';
 END IF;
 -- Deny deletion if ANY other table references the journal, its lines or ledger rows.
 -- Iterate catalog foreign keys instead of maintaining a fragile hardcoded list.
 FOR v_fk IN
   SELECT c.conrelid::regclass AS child_table, a.attname AS child_column,
          c.confrelid::regclass AS parent_table
   FROM pg_constraint c
   JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
   WHERE c.contype='f' AND array_length(c.conkey,1)=1
     AND c.confrelid IN ('public.journal_entries'::regclass,
                         'public.journal_lines'::regclass,
                         'public.ledgers'::regclass)
 LOOP
   IF v_fk.parent_table='public.journal_entries'::regclass
      AND v_fk.child_table IN ('public.journal_lines'::regclass,
                               'public.ledgers'::regclass,
                               'public.party_ledgers'::regclass) THEN
     CONTINUE;
   END IF;
   IF v_fk.parent_table='public.journal_entries'::regclass THEN
     EXECUTE format('SELECT count(*) FROM %s WHERE %I=$1',v_fk.child_table,v_fk.child_column)
       INTO v_count USING p_entry_id;
   ELSIF v_fk.parent_table='public.journal_lines'::regclass THEN
     EXECUTE format('SELECT count(*) FROM %s WHERE %I IN (SELECT id FROM public.journal_lines WHERE entry_id=$1)',
                    v_fk.child_table,v_fk.child_column) INTO v_count USING p_entry_id;
   ELSE
     EXECUTE format('SELECT count(*) FROM %s WHERE %I IN (SELECT id FROM public.ledgers WHERE journal_entry_id=$1)',
                    v_fk.child_table,v_fk.child_column) INTO v_count USING p_entry_id;
   END IF;
   IF v_count > 0 THEN
     RAISE EXCEPTION 'Permanent delete blocked: % linked records in %.',v_count,v_fk.child_table;
   END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) INTO v_line_snapshot
   FROM public.journal_lines l WHERE l.entry_id=p_entry_id;
 SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) INTO v_ledger_snapshot
   FROM public.ledgers l WHERE l.journal_entry_id=p_entry_id;
 SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) INTO v_party_snapshot
   FROM public.party_ledgers l WHERE l.journal_entry_id=p_entry_id;
 INSERT INTO public.owner_posted_control_events
   (company_id,business_unit_id,document_type,document_id,action_type,reason,performed_by,metadata)
 VALUES (v_entry.company_id,v_entry.business_unit_id,'journal_entry',v_entry.id,
         'permanent_delete',btrim(p_reason),auth.uid(),
         jsonb_build_object('entry',to_jsonb(v_entry),'lines',v_line_snapshot,
                            'ledgers',v_ledger_snapshot,'party_ledgers',v_party_snapshot));
 -- The existing posted immutability guards honor a transaction-local maintenance
 -- flag. Set only after all authorization and dependency checks, restore before return.
 v_old_gate:=current_setting('app.maintenance_reset',true);
 PERFORM set_config('app.maintenance_reset','1',true);
 DELETE FROM public.party_ledgers WHERE journal_entry_id=p_entry_id;
 DELETE FROM public.ledgers WHERE journal_entry_id=p_entry_id;
 DELETE FROM public.journal_lines WHERE entry_id=p_entry_id;
 DELETE FROM public.journal_entries WHERE id=p_entry_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Journal deletion did not complete.'; END IF;
 PERFORM set_config('app.maintenance_reset',coalesce(v_old_gate,''),true);
 RETURN jsonb_build_object('success',true,'entry_no',v_entry.entry_no,'deleted_entry_id',p_entry_id);
END
$body$;
REVOKE ALL ON FUNCTION public.platform_admin_permanent_delete_manual_journal(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_permanent_delete_manual_journal(uuid,text) TO authenticated;
