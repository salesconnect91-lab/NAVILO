-- NAVILO Transport: aggregate invoice service lines once instead of 18k
-- correlated per-document scans. Immutable financial amounts and source tables.
DO $opt$
DECLARE
 v text:=pg_get_viewdef('public.transport_service_document_balances_fast'::regclass,true);
 changed text;
 n_old bigint;n_new bigint;
 h_old text;h_new text;
BEGIN
 IF position('COALESCE(sline.net_amount, 0::numeric)' in v)>0
    AND position('COALESCE(pline.net_amount, 0::numeric)' in v)>0 THEN
   RAISE NOTICE 'Grouped service-line sums already active';
   RETURN;
 END IF;
 IF position($a$COALESCE(( SELECT sum(sales_service_lines.amount) AS sum
                   FROM sales_service_lines
                  WHERE sales_service_lines.order_id = s.id), 0::numeric) AS original_net$a$ in v)=0 OR
    position($b$COALESCE(( SELECT sum(purchase_service_lines.amount) AS sum
                   FROM purchase_service_lines
                  WHERE purchase_service_lines.order_id = p.id), 0::numeric) AS "coalesce"$b$ in v)=0 OR
    position($c$JOIN transport_active_journals j ON j.id = d.journal_entry_id
          WHERE s.status = 'posted'::text$c$ in v)=0 OR
    position($d$eligible ON eligible.purchase_order_id = p.id
          WHERE p.status = 'posted'::text$d$ in v)=0 THEN
   RAISE EXCEPTION 'Expected service-balance view baseline differs; no changes';
 END IF;
 SELECT count(*),md5(coalesce(string_agg(to_jsonb(z)::text,E'\n' ORDER BY z.side,z.order_id),''))
 INTO n_old,h_old FROM public.transport_service_document_balances_fast z;
 changed:=replace(v,$old$COALESCE(( SELECT sum(sales_service_lines.amount) AS sum
                   FROM sales_service_lines
                  WHERE sales_service_lines.order_id = s.id), 0::numeric) AS original_net$old$,'COALESCE(sline.net_amount, 0::numeric) AS original_net');
 changed:=replace(changed,$old$COALESCE(( SELECT sum(purchase_service_lines.amount) AS sum
                   FROM purchase_service_lines
                  WHERE purchase_service_lines.order_id = p.id), 0::numeric) AS "coalesce"$old$,'COALESCE(pline.net_amount, 0::numeric) AS "coalesce"');
 changed:=replace(changed,$old$JOIN transport_active_journals j ON j.id = d.journal_entry_id
          WHERE s.status = 'posted'::text$old$,
 $new$JOIN transport_active_journals j ON j.id = d.journal_entry_id
             LEFT JOIN (SELECT order_id,sum(amount) AS net_amount FROM public.sales_service_lines GROUP BY order_id) sline
               ON sline.order_id = s.id
          WHERE s.status = 'posted'::text$new$);
 changed:=replace(changed,$old$eligible ON eligible.purchase_order_id = p.id
          WHERE p.status = 'posted'::text$old$,
 $new$eligible ON eligible.purchase_order_id = p.id
             LEFT JOIN (SELECT order_id,sum(amount) AS net_amount FROM public.purchase_service_lines GROUP BY order_id) pline
               ON pline.order_id = p.id
          WHERE p.status = 'posted'::text$new$);
 EXECUTE 'CREATE OR REPLACE VIEW public.transport_service_document_balances_fast AS '||changed;
 SELECT count(*),md5(coalesce(string_agg(to_jsonb(z)::text,E'\n' ORDER BY z.side,z.order_id),''))
 INTO n_new,h_new FROM public.transport_service_document_balances_fast z;
 IF n_old IS DISTINCT FROM n_new OR h_old IS DISTINCT FROM h_new THEN
   RAISE EXCEPTION 'Transport service balances changed; safe rollback';
 END IF;
 IF has_table_privilege('anon','public.transport_service_document_balances_fast','SELECT')
 OR has_table_privilege('authenticated','public.transport_service_document_balances_fast','SELECT') THEN
   RAISE EXCEPTION 'Internal financial view security regression';
 END IF;
 RAISE NOTICE 'Exact financial parity verified on % service documents',n_new;
END
$opt$;