-- Performance-only: turn supplier posted-document correlated checks
-- into a single deduplicated set. This is equivalent to EXISTS A OR EXISTS B.
-- Verify EVERY financial balance row exactly and roll back on any mismatch.
DO $opt$
DECLARE
 current_view text:=pg_get_viewdef('public.transport_service_document_balances_fast'::regclass,true);
 updated_view text;
 before_count bigint;after_count bigint;
 before_hash text;after_hash text;
 match_count integer;
BEGIN
 IF position($new$FROM purchase_orders p
             JOIN (
               SELECT d.purchase_order_id
                 FROM public.transport_supplier_documents d
                 JOIN public.transport_active_journals j ON j.id=d.journal_entry_id
               UNION
               SELECT d.purchase_order_id
                 FROM public.transport_service_cost_links d
                 JOIN public.transport_active_journals j ON j.id=d.journal_entry_id
             ) eligible ON eligible.purchase_order_id=p.id
          WHERE p.status = 'posted'::text$new$ in current_view)>0 THEN
   RAISE NOTICE 'Optimized supplier source already applied';
   RETURN;
 END IF;
 match_count:=(length(current_view)-length(replace(current_view,$old$FROM purchase_orders p
          WHERE p.status = 'posted'::text AND ((EXISTS ( SELECT 1
                   FROM transport_supplier_documents d
                     JOIN transport_active_journals j ON j.id = d.journal_entry_id
                  WHERE d.purchase_order_id = p.id)) OR (EXISTS ( SELECT 1
                   FROM transport_service_cost_links d
                     JOIN transport_active_journals j ON j.id = d.journal_entry_id
                  WHERE d.purchase_order_id = p.id)))$old$,''))) / length($old$FROM purchase_orders p
          WHERE p.status = 'posted'::text AND ((EXISTS ( SELECT 1
                   FROM transport_supplier_documents d
                     JOIN transport_active_journals j ON j.id = d.journal_entry_id
                  WHERE d.purchase_order_id = p.id)) OR (EXISTS ( SELECT 1
                   FROM transport_service_cost_links d
                     JOIN transport_active_journals j ON j.id = d.journal_entry_id
                  WHERE d.purchase_order_id = p.id)))$old$);
 IF match_count<>1 THEN
   RAISE EXCEPTION 'Financial source view changed: expected 1 supplier branch, got %',match_count;
 END IF;
 SELECT count(*),md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.side,x.order_id),''))
 INTO before_count,before_hash
 FROM public.transport_service_document_balances_fast x;
 updated_view:=replace(current_view,$old$FROM purchase_orders p
          WHERE p.status = 'posted'::text AND ((EXISTS ( SELECT 1
                   FROM transport_supplier_documents d
                     JOIN transport_active_journals j ON j.id = d.journal_entry_id
                  WHERE d.purchase_order_id = p.id)) OR (EXISTS ( SELECT 1
                   FROM transport_service_cost_links d
                     JOIN transport_active_journals j ON j.id = d.journal_entry_id
                  WHERE d.purchase_order_id = p.id)))$old$,$new$FROM purchase_orders p
             JOIN (
               SELECT d.purchase_order_id
                 FROM public.transport_supplier_documents d
                 JOIN public.transport_active_journals j ON j.id=d.journal_entry_id
               UNION
               SELECT d.purchase_order_id
                 FROM public.transport_service_cost_links d
                 JOIN public.transport_active_journals j ON j.id=d.journal_entry_id
             ) eligible ON eligible.purchase_order_id=p.id
          WHERE p.status = 'posted'::text$new$);
 EXECUTE 'CREATE OR REPLACE VIEW public.transport_service_document_balances_fast AS '||updated_view;
 SELECT count(*),md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.side,x.order_id),''))
 INTO after_count,after_hash
 FROM public.transport_service_document_balances_fast x;
 IF before_count IS DISTINCT FROM after_count OR before_hash IS DISTINCT FROM after_hash THEN
   RAISE EXCEPTION 'Supplier service-document balance parity failed: transaction rolled back';
 END IF;
 IF has_table_privilege('anon','public.transport_service_document_balances_fast','SELECT')
    OR has_table_privilege('authenticated','public.transport_service_document_balances_fast','SELECT')
 THEN RAISE EXCEPTION 'Internal financial view access restriction lost'; END IF;
 RAISE NOTICE 'Exact financial balance parity verified for % records',after_count;
END
$opt$;