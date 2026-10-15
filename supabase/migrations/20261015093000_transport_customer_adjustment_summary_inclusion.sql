-- Fix omitted posted customer rate adjustments in canonical Trip finance summary.
-- Forward-only VIEW projection: no data writes; customer document links remain immutable.
-- Tests: supabase/tests/transport_v1_financial_completion_rehearsal.sql
begin;
create or replace view public.transport_trip_financial_summary with(security_invoker=true) as
 WITH service_balances AS MATERIALIZED (
         SELECT transport_service_document_balances.side,
            transport_service_document_balances.order_id,
            transport_service_document_balances.company_id,
            transport_service_document_balances.business_unit_id,
            transport_service_document_balances.operating_location_id,
            transport_service_document_balances.party_id,
            transport_service_document_balances.order_no,
            transport_service_document_balances.order_date,
            transport_service_document_balances.original_gross,
            transport_service_document_balances.tax_percent,
            transport_service_document_balances.original_net,
            transport_service_document_balances.credited_net,
            transport_service_document_balances.credited_gross,
            transport_service_document_balances.paid_gross,
            transport_service_document_balances.last_payment_date,
            transport_service_document_balances.refunded_gross,
            transport_service_document_balances.billed_net,
            transport_service_document_balances.billed_gross,
            transport_service_document_balances.paid_net,
            transport_service_document_balances.outstanding_gross,
            transport_service_document_balances.credit_gross,
            transport_service_document_balances.outstanding_net
           FROM transport_service_document_balances
        ), customer_line_weights AS MATERIALIZED (
         SELECT l.id,
            l.trip_id,
            d.sales_order_id,
            b.side,
            b.order_id,
            b.company_id,
            b.business_unit_id,
            b.operating_location_id,
            b.party_id,
            b.order_no,
            b.order_date,
            b.original_gross,
            b.tax_percent,
            b.original_net,
            b.credited_net,
            b.credited_gross,
            b.paid_gross,
            b.last_payment_date,
            b.refunded_gross,
            b.billed_net,
            b.billed_gross,
            b.paid_net,
            b.outstanding_gross,
            b.credit_gross,
            b.outstanding_net,
            l.rate_snapshot / NULLIF(sum(l.rate_snapshot) OVER (PARTITION BY d.sales_order_id), 0::numeric) AS net_weight,
            (l.rate_snapshot + COALESCE(l.vat_snapshot, 0::numeric)) / NULLIF(sum(l.rate_snapshot + COALESCE(l.vat_snapshot, 0::numeric)) OVER (PARTITION BY d.sales_order_id), 0::numeric) AS gross_weight,
            row_number() OVER (PARTITION BY d.sales_order_id ORDER BY l.id) AS rn,
            count(*) OVER (PARTITION BY d.sales_order_id) AS line_count
           FROM transport_customer_document_trips l
             JOIN transport_customer_documents d ON d.id = l.document_id
             JOIN service_balances b ON b.side = 'customer'::text AND b.order_id = d.sales_order_id
          -- Both original Trip invoices and posted positive rate-adjustment documents
-- contribute to the same Trip's net/gross/paid/outstanding totals.
-- Previously this predicate silently omitted the adjustment document,
-- so a customer rate correction of 1000 -> 1100 still displayed 1000.
-- The service_balances CTE already filters to posted, active journal evidence.
        ), customer_parts AS MATERIALIZED (
         SELECT customer_line_weights.id,
            customer_line_weights.trip_id,
            customer_line_weights.sales_order_id,
            customer_line_weights.side,
            customer_line_weights.order_id,
            customer_line_weights.company_id,
            customer_line_weights.business_unit_id,
            customer_line_weights.operating_location_id,
            customer_line_weights.party_id,
            customer_line_weights.order_no,
            customer_line_weights.order_date,
            customer_line_weights.original_gross,
            customer_line_weights.tax_percent,
            customer_line_weights.original_net,
            customer_line_weights.credited_net,
            customer_line_weights.credited_gross,
            customer_line_weights.paid_gross,
            customer_line_weights.last_payment_date,
            customer_line_weights.refunded_gross,
            customer_line_weights.billed_net,
            customer_line_weights.billed_gross,
            customer_line_weights.paid_net,
            customer_line_weights.outstanding_gross,
            customer_line_weights.credit_gross,
            customer_line_weights.outstanding_net,
            customer_line_weights.net_weight,
            customer_line_weights.gross_weight,
            customer_line_weights.rn,
            customer_line_weights.line_count,
            round(customer_line_weights.billed_net * customer_line_weights.net_weight, 2) AS n,
            round(customer_line_weights.billed_gross * customer_line_weights.gross_weight, 2) AS g,
            round(customer_line_weights.paid_net * customer_line_weights.net_weight, 2) AS pn,
            round((customer_line_weights.paid_gross - customer_line_weights.refunded_gross) * customer_line_weights.gross_weight, 2) AS pg,
            round(customer_line_weights.outstanding_gross * customer_line_weights.gross_weight, 2) AS og,
            round(customer_line_weights.outstanding_net * customer_line_weights.net_weight, 2) AS onet,
            round(customer_line_weights.credit_gross * customer_line_weights.gross_weight, 2) AS cg
           FROM customer_line_weights
        ), customer_exact AS MATERIALIZED (
         SELECT customer_parts.trip_id,
            customer_parts.sales_order_id,
                CASE
                    WHEN customer_parts.rn = customer_parts.line_count THEN customer_parts.billed_net - (sum(customer_parts.n) OVER (PARTITION BY customer_parts.sales_order_id) - customer_parts.n)
                    ELSE customer_parts.n
                END AS net,
                CASE
                    WHEN customer_parts.rn = customer_parts.line_count THEN customer_parts.billed_gross - (sum(customer_parts.g) OVER (PARTITION BY customer_parts.sales_order_id) - customer_parts.g)
                    ELSE customer_parts.g
                END AS gross,
                CASE
                    WHEN customer_parts.rn = customer_parts.line_count THEN customer_parts.paid_net - (sum(customer_parts.pn) OVER (PARTITION BY customer_parts.sales_order_id) - customer_parts.pn)
                    ELSE customer_parts.pn
                END AS paid_net,
                CASE
                    WHEN customer_parts.rn = customer_parts.line_count THEN customer_parts.paid_gross - customer_parts.refunded_gross - (sum(customer_parts.pg) OVER (PARTITION BY customer_parts.sales_order_id) - customer_parts.pg)
                    ELSE customer_parts.pg
                END AS paid_gross,
                CASE
                    WHEN customer_parts.rn = customer_parts.line_count THEN customer_parts.outstanding_gross - (sum(customer_parts.og) OVER (PARTITION BY customer_parts.sales_order_id) - customer_parts.og)
                    ELSE customer_parts.og
                END AS outstanding,
                CASE
                    WHEN customer_parts.rn = customer_parts.line_count THEN customer_parts.outstanding_net - (sum(customer_parts.onet) OVER (PARTITION BY customer_parts.sales_order_id) - customer_parts.onet)
                    ELSE customer_parts.onet
                END AS outstanding_net,
                CASE
                    WHEN customer_parts.rn = customer_parts.line_count THEN customer_parts.credit_gross - (sum(customer_parts.cg) OVER (PARTITION BY customer_parts.sales_order_id) - customer_parts.cg)
                    ELSE customer_parts.cg
                END AS credit
           FROM customer_parts
        ), customer_agg AS MATERIALIZED (
         SELECT customer_exact.trip_id,
            sum(customer_exact.net) AS net,
            sum(customer_exact.gross) AS gross,
            sum(customer_exact.paid_net) AS paid_net,
            sum(customer_exact.paid_gross) AS paid_gross,
            sum(customer_exact.outstanding) AS outstanding,
            sum(customer_exact.outstanding_net) AS outstanding_net,
            sum(customer_exact.credit) AS credit,
            count(DISTINCT customer_exact.sales_order_id) AS docs
           FROM customer_exact
          GROUP BY customer_exact.trip_id
        ), supplier_agg AS MATERIALIZED (
         SELECT transport_supplier_trip_document_balances.trip_id,
            sum(transport_supplier_trip_document_balances.billed_net) AS net,
            sum(transport_supplier_trip_document_balances.billed_gross) AS gross,
            sum(transport_supplier_trip_document_balances.paid_net) AS paid_net,
            sum(transport_supplier_trip_document_balances.paid_gross) AS paid_gross,
            sum(transport_supplier_trip_document_balances.outstanding_gross) AS outstanding,
            sum(transport_supplier_trip_document_balances.credit_gross) AS credit,
            max(transport_supplier_trip_document_balances.last_payment_date) AS last_date
           FROM transport_supplier_trip_document_balances
          GROUP BY transport_supplier_trip_document_balances.trip_id
        ), driver_accrual_agg AS MATERIALIZED (
         SELECT a.trip_id,
            sum(a.amount) AS accrued
           FROM transport_driver_accrual_attributions a
             JOIN employee_salary_accruals p ON p.id = a.accrual_id
             JOIN transport_active_journals j ON j.id = p.journal_entry_id
          GROUP BY a.trip_id
        ), driver_payment_agg AS MATERIALIZED (
         SELECT a.trip_id,
            sum(a.amount) AS paid
           FROM transport_driver_payment_attributions a
             JOIN employee_salary_payments p ON p.id = a.salary_payment_id
             JOIN transport_active_journals j ON j.id = p.journal_entry_id
          GROUP BY a.trip_id
        ), cost_agg AS MATERIALIZED (
         SELECT x.trip_id,
            sum(b.billed_net) AS net,
            sum(b.paid_net) FILTER (WHERE x.cost_kind = 'commission'::text) AS commission_paid,
            sum(b.outstanding_gross + b.credit_gross) AS required_outstanding
           FROM transport_service_cost_links x
             JOIN service_balances b ON b.side = 'supplier'::text AND b.order_id = x.purchase_order_id
          GROUP BY x.trip_id
        ), posted_rent_links AS MATERIALIZED (
 select distinct l.rent_id from public.transport_supplier_document_rents l join public.transport_supplier_documents sd on sd.id=l.document_id join public.transport_active_journals j on j.id=sd.journal_entry_id where not l.is_adjustment
), rent_flags AS MATERIALIZED (
 select r.trip_id,true structured_rents,bool_or(pl.rent_id is null) unbilled_rent from public.transport_trip_supplier_rents r left join posted_rent_links pl on pl.rent_id=r.id group by r.trip_id
), customer_link_flags AS MATERIALIZED (
 select distinct trip_id from public.transport_customer_document_trips
), supplier_link_flags AS MATERIALIZED (
 select distinct trip_id from public.transport_supplier_document_rents where not is_adjustment
), evidence AS (
         SELECT t.id,
            t.company_id,
            t.business_unit_id,
            COALESCE(c.net, 0::numeric) AS customer_net,
            COALESCE(c.gross, 0::numeric) AS customer_gross,
            COALESCE(c.paid_net, 0::numeric) AS customer_received_net,
            COALESCE(c.paid_gross, 0::numeric) AS customer_received_gross,
            COALESCE(c.outstanding, 0::numeric) AS customer_outstanding_gross,
            COALESCE(c.outstanding_net, 0::numeric) AS customer_outstanding_net,
            COALESCE(c.credit, 0::numeric) AS customer_credit_gross,
            COALESCE(c.docs, 0::bigint) AS customer_documents,
            COALESCE(s.net, 0::numeric) AS supplier_net,
            COALESCE(s.gross, 0::numeric) AS supplier_gross,
            COALESCE(s.paid_net, 0::numeric) AS supplier_paid_net,
            COALESCE(s.paid_gross, 0::numeric) AS supplier_paid_gross,
            COALESCE(s.outstanding, 0::numeric) AS supplier_outstanding_gross,
            COALESCE(s.credit, 0::numeric) AS supplier_credit_gross,
            s.last_date AS supplier_payment_date,
            COALESCE(dr.accrued, 0::numeric) AS driver_accrued,
            COALESCE(dp.paid, 0::numeric) AS driver_paid,
            GREATEST(t.driver_pay - COALESCE(dp.paid, 0::numeric), 0::numeric) AS driver_outstanding,
            COALESCE(costs.net, 0::numeric) AS other_cost_net,
            COALESCE(costs.commission_paid, 0::numeric) AS commission_paid_net,
            COALESCE(costs.required_outstanding, 0::numeric) AS required_cost_outstanding,
            coalesce(rf.structured_rents,false) AS structured_rents,
            coalesce(rf.unbilled_rent,false) AS unbilled_rent,
            t.customer_rate AS original_customer_rate,
            t.owner_rent AS legacy_owner_rent,
            t.driver_pay AS agreed_driver_pay,
            t.trip_status AS operational_status,
            t.job_status,
            (t.sales_order_id is not null or clf.trip_id is not null) AS customer_rate_locked,
            (slf.trip_id is not null) AS supplier_rate_locked
           FROM transport_trips t LEFT JOIN rent_flags rf ON rf.trip_id=t.id LEFT JOIN customer_link_flags clf ON clf.trip_id=t.id LEFT JOIN supplier_link_flags slf ON slf.trip_id=t.id
             LEFT JOIN customer_agg c ON c.trip_id = t.id
             LEFT JOIN supplier_agg s ON s.trip_id = t.id
             LEFT JOIN driver_accrual_agg dr ON dr.trip_id = t.id
             LEFT JOIN driver_payment_agg dp ON dp.trip_id = t.id
             LEFT JOIN cost_agg costs ON costs.trip_id = t.id
        )
 SELECT id,
    company_id,
    business_unit_id,
    customer_net,
    customer_gross,
    customer_received_net,
    customer_received_gross,
    customer_outstanding_gross,
    customer_outstanding_net,
    customer_credit_gross,
    customer_documents,
    supplier_net,
    supplier_gross,
    supplier_paid_net,
    supplier_paid_gross,
    supplier_outstanding_gross,
    supplier_credit_gross,
    supplier_payment_date,
    driver_accrued,
    driver_paid,
    driver_outstanding,
    other_cost_net,
    commission_paid_net,
    required_cost_outstanding,
    structured_rents,
    unbilled_rent,
    original_customer_rate,
    legacy_owner_rent,
    agreed_driver_pay,
    operational_status,
    job_status,
    customer_rate_locked,
    supplier_rate_locked,
        CASE
            WHEN customer_documents = 0 THEN NULL::numeric
            ELSE customer_net - supplier_net - driver_accrued - other_cost_net
        END AS posted_profit,
        CASE
            WHEN operational_status = 'cancelled'::text THEN 'Cancelled'::text
            WHEN customer_documents > 0 AND (operational_status = ANY (ARRAY['completed'::text, 'ready_to_invoice'::text, 'invoiced'::text, 'paid'::text])) AND (job_status = ANY (ARRAY['completed'::text, 'done'::text])) AND customer_outstanding_gross <= 0.005 AND customer_credit_gross <= 0.005 AND supplier_outstanding_gross <= 0.005 AND supplier_credit_gross <= 0.005 AND driver_outstanding <= 0.005 AND driver_accrued >= (agreed_driver_pay - 0.005) AND NOT unbilled_rent AND (legacy_owner_rent <= 0::numeric OR structured_rents) AND required_cost_outstanding <= 0.005 THEN 'Closed'::text
            WHEN customer_rate_locked OR supplier_rate_locked OR driver_accrued > 0::numeric OR driver_paid > 0::numeric OR other_cost_net > 0::numeric THEN 'Under Settlement'::text
            WHEN operational_status = 'draft'::text THEN 'Draft'::text
            WHEN original_customer_rate > 0::numeric AND (legacy_owner_rent > 0::numeric OR structured_rents) THEN 'Complete'::text
            ELSE 'Not Complete'::text
        END AS financial_status
   FROM evidence;
commit;