begin;
create or replace view public.transport_supplier_trip_document_balances with(security_invoker=true) as
with weighted as (
 select l.id,l.company_id,l.business_unit_id,l.trip_id,l.rent_id,d.purchase_order_id,
 b.last_payment_date,b.billed_net bn,b.billed_gross bg,
 least(greatest(b.paid_gross-b.refunded_gross,0),greatest(b.billed_gross,0)) pg,
 least(greatest(b.paid_net,0),b.billed_net) pn,
 greatest(b.outstanding_gross,0) og,greatest(b.credit_gross,0) cg,
 l.amount_snapshot/nullif(sum(l.amount_snapshot) over(partition by d.purchase_order_id),0) nw,
 (l.amount_snapshot+coalesce(l.vat_snapshot,0))/nullif(sum(l.amount_snapshot+coalesce(l.vat_snapshot,0)) over(partition by d.purchase_order_id),0) gw,
 row_number() over(partition by d.purchase_order_id order by l.id) rn,count(*) over(partition by d.purchase_order_id) cnt
 from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id
 join public.transport_service_document_balances b on b.side='supplier' and b.order_id=d.purchase_order_id
), parts as (
 select *,round(bn*nw,2) nb,round(bg*gw,2) gb,round(pg*gw,2) gp,round(pn*nw,2) np,round(og*gw,2) op,round(cg*gw,2) cp from weighted
)
select company_id,business_unit_id,trip_id,rent_id,purchase_order_id,
 case when rn=cnt then bn-(sum(nb) over(partition by purchase_order_id)-nb) else nb end billed_net,
 case when rn=cnt then bg-(sum(gb) over(partition by purchase_order_id)-gb) else gb end billed_gross,
 case when rn=cnt then pg-(sum(gp) over(partition by purchase_order_id)-gp) else gp end paid_gross,
 case when rn=cnt then pn-(sum(np) over(partition by purchase_order_id)-np) else np end paid_net,
 case when rn=cnt then og-(sum(op) over(partition by purchase_order_id)-op) else op end outstanding_gross,
 case when rn=cnt then cg-(sum(cp) over(partition by purchase_order_id)-cp) else cp end credit_gross,last_payment_date from parts;
do $patch$ declare d text;begin
 d:=pg_get_viewdef('public.transport_financial_register'::regclass,true);
 if strpos(d,'f.supplier_credit_gross')=0 then raise exception 'Expected supplier credit projection missing';end if;
 d:=replace(d,'f.supplier_credit_gross','(f.supplier_credit_gross+coalesce(retained.credit,0))');
 d:=replace(d,'FROM transport_trips t','FROM transport_trips t left join (
 select l.trip_id,sum(greatest(-l.opening_remaining,0)) credit
 from public.transport_opening_invoice_lines l join public.transport_register_invoice_conversions cv on cv.document_id=l.document_id
 where cv.side=''supplier'' and cv.status=''posted'' and cv.retained_credit>0 group by l.trip_id
 ) retained on retained.trip_id=t.id');
 execute 'create or replace view public.transport_financial_register as '||d;
end $patch$;
commit;;
