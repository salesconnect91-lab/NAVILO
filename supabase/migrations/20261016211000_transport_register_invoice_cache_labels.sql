-- Reconcile derived Register snapshot invoice labels with authentic source references.
-- Does NOT alter Trips, source documents, supplier invoices, postings, payments or journals.
-- Preserve all other snapshot JSON fields, totals, permissions and row identities.
WITH mapped AS MATERIALIZED (
 SELECT s.ctid,
 coalesce(nullif(btrim(s.data->'full_row'->>'historical_customer_invoice_ref'),''),CASE WHEN (s.data->>'invoice_no_raw') LIKE 'H-S-%' THEN NULL ELSE s.data->>'invoice_no_raw' END) customer_ref,
 coalesce(nullif(btrim(s.data->'full_row'->>'historical_supplier_invoice_ref'),''),CASE WHEN (s.data->>'supplier_invoice_no_raw') LIKE 'H-P-%' THEN NULL ELSE s.data->>'supplier_invoice_no_raw' END) supplier_ref,
 s.data->>'invoice_no_raw' previous_customer,
 s.data->>'supplier_invoice_no_raw' previous_supplier
 FROM public.transport_register_snapshot_rows s
), changed AS MATERIALIZED (
 SELECT ctid,customer_ref,supplier_ref FROM mapped
 WHERE customer_ref IS DISTINCT FROM previous_customer OR supplier_ref IS DISTINCT FROM previous_supplier
)
UPDATE public.transport_register_snapshot_rows s
SET data=jsonb_set(
  jsonb_set(
   jsonb_set(
    jsonb_set(s.data,'{invoice_no_raw}',coalesce(to_jsonb(x.customer_ref),'null'::jsonb),true),
    '{supplier_invoice_no_raw}',coalesce(to_jsonb(x.supplier_ref),'null'::jsonb),true),
   '{vals,cells,invoice_no}',to_jsonb(coalesce(x.customer_ref,'?')),true),
  '{vals,cells,supplier_invoice_no}',to_jsonb(coalesce(x.supplier_ref,'?')),true)
FROM changed x WHERE s.ctid=x.ctid;
