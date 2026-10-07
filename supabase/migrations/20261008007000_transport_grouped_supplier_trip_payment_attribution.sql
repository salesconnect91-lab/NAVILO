-- Fix grouped Supplier invoice payment/balance attribution at Trip level.
-- Canonical AP/payment allocations remain document-level; this view only apportions them for Transport reporting.
create view public.transport_supplier_trip_document_balances
with (security_invoker=true) as
select
 l.company_id,l.business_unit_id,l.trip_id,l.rent_id,d.purchase_order_id,
 round(l.amount_snapshot,2) billed_net,
 round(l.amount_snapshot+coalesce(l.vat_snapshot,0),2) billed_gross,
 round(
   least(greatest(b.paid_gross-b.refunded_gross,0),b.billed_gross)
   * greatest(l.amount_snapshot+coalesce(l.vat_snapshot,0)-coalesce(adj.adjustment_gross,0),0)
   / nullif(sum(greatest(l.amount_snapshot+coalesce(l.vat_snapshot,0)-coalesce(adj.adjustment_gross,0),0)) over(partition by d.purchase_order_id),0)
 ,2) paid_gross,
 round(
   least(greatest(b.paid_net,0),b.billed_net)
   * l.amount_snapshot
   / nullif(sum(l.amount_snapshot) over(partition by d.purchase_order_id),0)
 ,2) paid_net,
 round(
   greatest(b.outstanding_gross,0)
   * (l.amount_snapshot+coalesce(l.vat_snapshot,0))
   / nullif(sum(l.amount_snapshot+coalesce(l.vat_snapshot,0)) over(partition by d.purchase_order_id),0)
 ,2) outstanding_gross,
 round(
   greatest(b.credit_gross,0)
   * (l.amount_snapshot+coalesce(l.vat_snapshot,0))
   / nullif(sum(l.amount_snapshot+coalesce(l.vat_snapshot,0)) over(partition by d.purchase_order_id),0)
 ,2) credit_gross,
 b.last_payment_date
from public.transport_supplier_document_rents l
join public.transport_supplier_documents d on d.id=l.document_id
left join lateral(
 select coalesce(sum(a.amount_snapshot+coalesce(a.vat_snapshot,0)),0) adjustment_gross
 from public.transport_supplier_document_rents a
 where a.document_id=l.document_id and a.trip_id=l.trip_id and a.rent_id=l.rent_id and a.is_adjustment
) adj on true
join public.transport_service_document_balances b
  on b.side='supplier' and b.order_id=d.purchase_order_id
where not l.is_adjustment;

revoke all on public.transport_supplier_trip_document_balances from public,anon;
grant select on public.transport_supplier_trip_document_balances to authenticated;

comment on view public.transport_supplier_trip_document_balances is
 'Trip/rent reporting allocation for grouped Transport supplier invoices; canonical AP/payment evidence remains purchase-document level.';
