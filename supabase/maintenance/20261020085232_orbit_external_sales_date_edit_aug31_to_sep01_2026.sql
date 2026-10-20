-- EXECUTED IN PRODUCTION 2026-10-20; Supabase migration version 20261020085232.
-- Scope: Orbit - Usman Sajjad, 40 existing posted external Sales invoices.
-- Corrected original invoice, journal, GL and customer ledger dates: 31-Aug-2026 -> 01-Sep-2026.
-- No reversals, extra journals, amount or invoice number changes.
-- For archival/audit ONLY. Do not auto-run this on other databases or replay it.
-- Authoritative execution record: supabase_migrations.schema_migrations.

DO $datefix$
DECLARE
 c uuid; n int; invoice_ids uuid[]; journal_ids uuid[]; gross numeric; paid numeric;
 net numeric; vat numeric; source_lines int; changed int;
BEGIN
 PERFORM set_config('lock_timeout','5000ms',true);
 PERFORM set_config('statement_timeout','45000ms',true);
 SELECT count(*) INTO n FROM public.companies WHERE name='Orbit - Usman Sajjad' AND is_test_company=false;
 IF n<>1 THEN RAISE EXCEPTION 'Company must be uniquely identified'; END IF;
 SELECT id INTO c FROM public.companies WHERE name='Orbit - Usman Sajjad' AND is_test_company=false LIMIT 1;
 PERFORM pg_advisory_xact_lock(hashtextextended('navilo:orbit:date-edit:2026-09-01',0));
 SELECT array_agg(o.id ORDER BY o.id),array_agg(d.journal_entry_id ORDER BY o.id),
        count(*),sum(o.total),coalesce(sum(o.paid_amount),0)+coalesce(sum(d.paid_amount),0)
 INTO invoice_ids,journal_ids,n,gross,paid
 FROM public.sales_orders o
 JOIN public.transport_customer_documents d ON d.sales_order_id=o.id
 WHERE o.company_id=c AND o.status='posted'
   AND o.transport_source_invoice_id IS NOT NULL
   AND o.document_kind='service' AND o.payment_mode='Credit';
 IF n<>40 OR gross<>96203.25 OR paid<>0
    OR (SELECT count(DISTINCT x) FROM unnest(invoice_ids) x)<>40
    OR (SELECT count(DISTINCT x) FROM unnest(journal_ids) x)<>40
 THEN RAISE EXCEPTION 'Invoice count/payment/gross mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.sales_orders o WHERE o.id=ANY(invoice_ids)
    AND (o.order_date<>'2026-08-31' OR o.currency_code<>'SAR' OR coalesce(o.exchange_rate,1)<>1))
 THEN RAISE EXCEPTION 'Invoice date/currency mismatch'; END IF;
 SELECT count(*) INTO n FROM public.journal_entries j WHERE j.id=ANY(journal_ids)
   AND j.company_id=c AND j.status='posted' AND j.entry_date='2026-08-31'
   AND j.currency_code='SAR' AND j.exchange_rate=1 AND j.source_module='sales'
   AND j.source_document_type='sales_invoice'
   AND j.source_document_id=ANY(invoice_ids) AND j.reversal_of_entry_id IS NULL;
 IF n<>40 THEN RAISE EXCEPTION 'Original posting journal/date mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.journal_entries WHERE company_id=c
    AND reversal_of_entry_id=ANY(journal_ids))
 THEN RAISE EXCEPTION 'Source journal already has reversal'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_periods p WHERE p.company_id=c
   AND (('2026-08-31'::date BETWEEN p.period_start AND p.period_end)
   OR ('2026-09-01'::date BETWEEN p.period_start AND p.period_end))
   AND p.status<>'open')
 THEN RAISE EXCEPTION 'Accounting period closed'; END IF;
 IF EXISTS(SELECT 1 FROM public.transport_monthly_profit_closures p
     WHERE p.company_id=c AND p.month IN ('2026-08-01','2026-09-01') AND p.status='closed')
 THEN RAISE EXCEPTION 'Transport profit month closed'; END IF;
 SELECT count(*),coalesce(sum(l.amount),0),
        coalesce(sum(round(l.amount*l.tax_percent/100,2)),0)
 INTO source_lines,net,vat
 FROM public.transport_external_invoice_lines e
 JOIN public.sales_service_lines l ON l.id=e.sales_line_id
 WHERE e.company_id=c AND e.sales_order_id=ANY(invoice_ids);
 IF source_lines<>46 OR net<>83655 OR vat<>12548.25
 THEN RAISE EXCEPTION 'External sales/VAT amounts mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.return_notes r
    JOIN public.transport_service_note_lines sl ON sl.note_id=r.id
    WHERE sl.order_id=ANY(invoice_ids))
 THEN RAISE EXCEPTION 'Credit/debit note linked; correction blocked'; END IF;
 SELECT count(*) INTO n FROM public.ledgers l WHERE l.company_id=c
    AND l.journal_entry_id=ANY(journal_ids) AND l.entry_date='2026-08-31';
 IF n<>120 THEN RAISE EXCEPTION 'Original GL date/count mismatch'; END IF;
 SELECT count(*) INTO n FROM public.party_ledgers l WHERE l.company_id=c
    AND l.journal_entry_id=ANY(journal_ids) AND l.entry_date='2026-08-31'
    AND l.party_type='customer';
 IF n<>40 THEN RAISE EXCEPTION 'Original customer ledger date/count mismatch'; END IF;

 -- Short, transaction-scoped exceptions to two date immutability triggers only.
 -- All audit triggers, financial balances, period gates, and scope checks remain active.
 PERFORM set_config('app.maintenance_reset','1',true);
 EXECUTE 'ALTER TABLE public.sales_orders DISABLE TRIGGER trg_lock_posted_sales_orders';
 EXECUTE 'ALTER TABLE public.journal_entries DISABLE TRIGGER zz_guard_journal_fx_snapshot';

 UPDATE public.sales_orders SET order_date='2026-09-01',updated_at=now()
 WHERE id=ANY(invoice_ids) AND company_id=c AND status='posted' AND order_date='2026-08-31';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>40 THEN RAISE EXCEPTION 'Sales invoice edit count %',changed; END IF;

 UPDATE public.journal_entries SET entry_date='2026-09-01'
 WHERE id=ANY(journal_ids) AND company_id=c AND status='posted' AND entry_date='2026-08-31';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>40 THEN RAISE EXCEPTION 'Journal edit count %',changed; END IF;

 UPDATE public.ledgers SET entry_date='2026-09-01'
 WHERE journal_entry_id=ANY(journal_ids) AND company_id=c AND entry_date='2026-08-31';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>120 THEN RAISE EXCEPTION 'GL edit count %',changed; END IF;

 UPDATE public.party_ledgers SET entry_date='2026-09-01'
 WHERE journal_entry_id=ANY(journal_ids) AND company_id=c
   AND entry_date='2026-08-31' AND party_type='customer';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>40 THEN RAISE EXCEPTION 'Customer Ledger edit count %',changed; END IF;

 EXECUTE 'ALTER TABLE public.journal_entries ENABLE TRIGGER zz_guard_journal_fx_snapshot';
 EXECUTE 'ALTER TABLE public.sales_orders ENABLE TRIGGER trg_lock_posted_sales_orders';
 PERFORM set_config('app.maintenance_reset','0',true);

 IF (SELECT count(*) FROM public.sales_orders WHERE id=ANY(invoice_ids) AND order_date='2026-09-01')<>40
    OR (SELECT count(*) FROM public.journal_entries WHERE id=ANY(journal_ids) AND entry_date='2026-09-01')<>40
    OR (SELECT count(*) FROM public.ledgers WHERE journal_entry_id=ANY(journal_ids) AND entry_date='2026-09-01')<>120
    OR (SELECT count(*) FROM public.party_ledgers WHERE journal_entry_id=ANY(journal_ids) AND entry_date='2026-09-01')<>40
 THEN RAISE EXCEPTION 'Post-write date reconciliation failed'; END IF;
 IF EXISTS(SELECT 1 FROM public.journal_lines l WHERE l.entry_id=ANY(journal_ids)
    GROUP BY l.entry_id HAVING round(sum(l.debit),2)<>round(sum(l.credit),2))
 THEN RAISE EXCEPTION 'Unbalanced journals'; END IF;
 RAISE NOTICE 'Orbit 40 existing invoice, 40 journal, 120 GL, 40 Party Ledger dates updated to 01-Sep-2026; NO reversal.';
END
$datefix$;
