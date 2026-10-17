CREATE OR REPLACE FUNCTION public.transport_credit_hs_correction_preflight(p_company_id uuid)
 RETURNS TABLE(sales_order_id uuid, invoice_no text, trip_count bigint, total numeric, paid numeric, outstanding numeric, allocations bigint, allocated numeric, journal_lines bigint, journal_net numeric, review_lane text)
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
with candidates as (
select s.id,s.order_no,s.total,s.paid_amount,s.outstanding_amount,
 min(d.journal_entry_id::text)::uuid jid,
 count(distinct t.id) trips,
 bool_and(nullif(btrim(t.source_invoice_no),'') is null or t.source_invoice_no !~ '[0-9]') missing
from public.sales_orders s join public.transport_customer_documents d on d.sales_order_id=s.id
join public.transport_customer_document_trips l on l.document_id=d.id and not l.is_adjustment
join public.transport_trips t on t.id=l.trip_id
where s.company_id=p_company_id and t.company_id=p_company_id and t.sale_type='credit' and s.status='posted' and s.order_no like 'H-S-%'
group by s.id,s.order_no,s.total,s.paid_amount,s.outstanding_amount
), audit as (
select c.*,
(select count(*) from public.invoice_payment_allocations a where a.sales_order_id=c.id) ac,
(select coalesce(sum(a.amount),0) from public.invoice_payment_allocations a where a.sales_order_id=c.id) av,
(select count(*) from public.journal_lines j where j.entry_id=c.jid) jl,
(select coalesce(sum(j.base_debit-j.base_credit),0) from public.journal_lines j where j.entry_id=c.jid) jnet,
exists(select 1 from public.journal_entries j where j.reversal_of_entry_id=c.jid and j.status='posted') reversed,
exists(select 1 from public.transport_service_note_lines n where n.order_id=c.id and n.side='customer') noted
from candidates c
)
select id,order_no,trips,total,paid_amount,outstanding_amount,ac,av,jl,jnet,
case when not missing then 'HAS_ORIGINAL_NUMBER'
when reversed or noted then 'EXISTING_CORRECTION_REVIEW'
when ac>0 or paid_amount>0 then 'PAYMENT_LINKED_REVIEW'
when jl=0 or abs(jnet)>0.01 or abs(total-paid_amount-outstanding_amount)>0.01 then 'ACCOUNTING_MISMATCH_REVIEW'
else 'UNPAID_CORRECTION_CANDIDATE' end
from audit
$function$;

REVOKE ALL ON FUNCTION public.transport_credit_hs_correction_preflight(uuid) FROM PUBLIC, anon, authenticated;
