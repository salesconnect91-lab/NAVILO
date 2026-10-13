begin;
create or replace view public.transport_trip_financial_summary with(security_invoker=true) as
 WITH service_balances AS MATERIALIZED (
 select * from public.transport_service_document_balances
), customer_line_weights AS MATERIALIZED (
 select l.id,l.trip_id,d.sales_order_id,b.*,
 l.rate_snapshot / nullif(sum(l.rate_snapshot) over(partition by d.sales_order_id),0) net_weight,
 (l.rate_snapshot+coalesce(l.vat_snapshot,0))/nullif(sum(l.rate_snapshot+coalesce(l.vat_snapshot,0)) over(partition by d.sales_order_id),0) gross_weight,
 row_number() over(partition by d.sales_order_id order by l.id) rn,
 count(*) over(partition by d.sales_order_id) line_count
 from public.transport_customer_document_trips l
 join public.transport_customer_documents d on d.id=l.document_id
 join service_balances b on b.side='customer' and b.order_id=d.sales_order_id
 where not l.is_adjustment
), customer_parts AS MATERIALIZED (
 select *,round(billed_net*net_weight,2) n,round(billed_gross*gross_weight,2) g,
 round(paid_net*net_weight,2) pn,round((paid_gross-refunded_gross)*gross_weight,2) pg,
 round(outstanding_gross*gross_weight,2) og,round(outstanding_net*net_weight,2) onet,
 round(credit_gross*gross_weight,2) cg from customer_line_weights
), customer_exact AS MATERIALIZED (
 select trip_id,sales_order_id,
 case when rn=line_count then billed_net-(sum(n) over(partition by sales_order_id)-n) else n end net,
 case when rn=line_count then billed_gross-(sum(g) over(partition by sales_order_id)-g) else g end gross,
 case when rn=line_count then paid_net-(sum(pn) over(partition by sales_order_id)-pn) else pn end paid_net,
 case when rn=line_count then paid_gross-refunded_gross-(sum(pg) over(partition by sales_order_id)-pg) else pg end paid_gross,
 case when rn=line_count then outstanding_gross-(sum(og) over(partition by sales_order_id)-og) else og end outstanding,
 case when rn=line_count then outstanding_net-(sum(onet) over(partition by sales_order_id)-onet) else onet end outstanding_net,
 case when rn=line_count then credit_gross-(sum(cg) over(partition by sales_order_id)-cg) else cg end credit
 from customer_parts
), customer_agg AS MATERIALIZED (
 select trip_id,sum(net) net,sum(gross) gross,sum(paid_net) paid_net,sum(paid_gross) paid_gross,sum(outstanding) outstanding,sum(outstanding_net) outstanding_net,sum(credit) credit,count(distinct sales_order_id) docs from customer_exact group by trip_id
), supplier_agg AS MATERIALIZED (
 select trip_id,sum(billed_net) net,sum(billed_gross) gross,sum(paid_net) paid_net,sum(paid_gross) paid_gross,sum(outstanding_gross) outstanding,sum(credit_gross) credit,max(last_payment_date) last_date from public.transport_supplier_trip_document_balances group by trip_id
), driver_accrual_agg AS MATERIALIZED (
 select a.trip_id,sum(a.amount) accrued from public.transport_driver_accrual_attributions a join public.employee_salary_accruals p on p.id=a.accrual_id join public.transport_active_journals j on j.id=p.journal_entry_id group by a.trip_id
), driver_payment_agg AS MATERIALIZED (
 select a.trip_id,sum(a.amount) paid from public.transport_driver_payment_attributions a join public.employee_salary_payments p on p.id=a.salary_payment_id join public.transport_active_journals j on j.id=p.journal_entry_id group by a.trip_id
), cost_agg AS MATERIALIZED (
 select x.trip_id,sum(b.billed_net) net,sum(b.paid_net) filter(where x.cost_kind='commission') commission_paid,sum(b.outstanding_gross+b.credit_gross) required_outstanding from public.transport_service_cost_links x join service_balances b on b.side='supplier' and b.order_id=x.purchase_order_id group by x.trip_id
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
            (EXISTS ( SELECT 1
                   FROM transport_trip_supplier_rents
                  WHERE transport_trip_supplier_rents.trip_id = t.id)) AS structured_rents,
            (EXISTS ( SELECT 1
                   FROM transport_trip_supplier_rents r
                  WHERE r.trip_id = t.id AND NOT (EXISTS ( SELECT 1
                           FROM transport_supplier_document_rents l
                             JOIN transport_supplier_documents d ON d.id = l.document_id
                             JOIN transport_active_journals j ON j.id = d.journal_entry_id
                          WHERE l.rent_id = r.id AND NOT l.is_adjustment)))) AS unbilled_rent,
            t.customer_rate AS original_customer_rate,
            t.owner_rent AS legacy_owner_rent,
            t.driver_pay AS agreed_driver_pay,
            t.trip_status AS operational_status,
            t.job_status,
            t.sales_order_id IS NOT NULL OR (EXISTS ( SELECT 1
                   FROM transport_customer_document_trips
                  WHERE transport_customer_document_trips.trip_id = t.id)) AS customer_rate_locked,
            (EXISTS ( SELECT 1
                   FROM transport_supplier_document_rents
                  WHERE transport_supplier_document_rents.trip_id = t.id AND NOT transport_supplier_document_rents.is_adjustment)) AS supplier_rate_locked
           FROM transport_trips t
             LEFT JOIN customer_agg c ON c.trip_id=t.id
             LEFT JOIN supplier_agg s ON s.trip_id=t.id
             LEFT JOIN driver_accrual_agg dr ON dr.trip_id=t.id
             LEFT JOIN driver_payment_agg dp ON dp.trip_id=t.id
             LEFT JOIN cost_agg costs ON costs.trip_id=t.id
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