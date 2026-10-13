-- Report reads only. No invoice, payment, journal, ledger, or source evidence writes.
create or replace view public.transport_opening_aging_rows with(security_invoker=true) as
select d.*,d.current_outstanding_gross-d.current_credit_gross signed_balance,
case when d.current_outstanding_gross=0 and d.current_credit_gross=0 then 'paid'
 when d.current_credit_gross>0 then 'credit' when d.current_paid_gross>0 then 'partial' else 'open' end payment_status
from public.transport_opening_invoice_balances d
where d.company_id=(select public.current_company_id())
 and d.business_unit_id=(select public.current_business_unit_id())
 and d.operating_location_id=(select public.current_operating_location_id())
 and ((d.side='customer' and (select public.transport_financial_read_allowed('customer')))
 or (d.side='supplier' and (select public.transport_financial_read_allowed('supplier'))));
revoke all on public.transport_opening_aging_rows from public,anon,authenticated;
grant select on public.transport_opening_aging_rows to authenticated;

create or replace view public.customer_receivable_aging_report with(security_invoker=true) as
with imported as materialized(select * from public.transport_opening_aging_rows where side='customer'),
party as (
 select p.company_id,p.business_unit_id,p.operating_location_id,p.party_id,
 min(p.entry_date) balance_date,sum(p.debit-p.credit) balance
 from public.party_ledgers p where p.party_type='customer' group by 1,2,3,4
), invoiced as (
 select company_id,business_unit_id,operating_location_id,customer_id,sum(outstanding_amount) balance
 from public.customer_invoice_aging group by 1,2,3,4
), opening as (
 select company_id,business_unit_id,operating_location_id,party_id,sum(signed_balance) balance
 from imported group by 1,2,3,4
)
select a.*,'Invoice'::text source_type,a.sales_order_id::text report_row_id from public.customer_invoice_aging a
union all
select d.id,null::uuid,d.party_id,d.party_name,d.order_no,d.opening_date,null::date,
 d.original_gross,d.current_paid_gross,d.signed_balance,case when d.payment_status='open' then 'unpaid' else d.payment_status end,
 0,0,d.payment_status,case when d.signed_balance<0 then 'Credit' when d.signed_balance=0 then 'Paid' else 'No Due Date' end,d.company_id,d.business_unit_id,d.operating_location_id,
 'Imported opening reference'::text,'transport-opening:'||d.id::text from imported d
union all
select null::uuid,null::uuid,p.party_id,c.name,'Opening / Unallocated'::text,p.balance_date,null::date,
 0::numeric,0::numeric,p.balance-coalesce(i.balance,0)-coalesce(o.balance,0),'unallocated'::text,
 greatest(current_date-p.balance_date,0),0,'unallocated'::text,'No Due Date'::text,
 p.company_id,p.business_unit_id,p.operating_location_id,'Opening / Unallocated'::text,
 concat('balance:',p.party_id,':',p.business_unit_id,':',p.operating_location_id)
from party p join public.customers c on c.id=p.party_id and c.company_id=p.company_id
left join invoiced i on i.company_id=p.company_id and i.business_unit_id is not distinct from p.business_unit_id
 and i.operating_location_id is not distinct from p.operating_location_id and i.customer_id=p.party_id
left join opening o on o.company_id=p.company_id and o.business_unit_id is not distinct from p.business_unit_id
 and o.operating_location_id is not distinct from p.operating_location_id and o.party_id=p.party_id
where abs(p.balance-coalesce(i.balance,0)-coalesce(o.balance,0))>=0.005;
revoke all on public.customer_receivable_aging_report from public,anon,authenticated;
grant select on public.customer_receivable_aging_report to authenticated;

-- Keep native invoice-only views intact for tax and commercial posting consumers.
create or replace view public.supplier_payable_aging_report with(security_invoker=true) as
with imported as materialized(select * from public.transport_opening_aging_rows where side='supplier'),
party as (
 select p.company_id,p.business_unit_id,p.operating_location_id,p.party_id,
 min(p.entry_date) balance_date,sum(p.credit-p.debit) balance
 from public.party_ledgers p where p.party_type='supplier' group by 1,2,3,4
), invoiced as (
 select company_id,business_unit_id,operating_location_id,supplier_id,sum(outstanding_amount) balance
 from public.supplier_invoice_aging group by 1,2,3,4
), opening as (
 select company_id,business_unit_id,operating_location_id,party_id,sum(signed_balance) balance
 from imported group by 1,2,3,4
)
select a.*,'Invoice'::text source_type,a.purchase_order_id::text report_row_id from public.supplier_invoice_aging a
union all
select d.id,null::uuid,d.company_id,d.business_unit_id,d.operating_location_id,d.party_id,d.party_name,
 d.order_no,d.opening_date,null::date,d.original_gross,d.current_paid_gross,d.signed_balance,
 d.payment_status,0,0,d.payment_status,case when d.signed_balance<0 then 'Credit' when d.signed_balance=0 then 'Paid' else 'No Due Date' end,'Imported opening reference'::text,
 'transport-opening:'||d.id::text from imported d
union all
select null::uuid,null::uuid,p.company_id,p.business_unit_id,p.operating_location_id,p.party_id,s.name,
 'Opening / Unallocated'::text,p.balance_date,null::date,0::numeric,0::numeric,
 p.balance-coalesce(i.balance,0)-coalesce(o.balance,0),'unallocated'::text,
 greatest(current_date-p.balance_date,0),0,'unallocated'::text,'No Due Date'::text,
 'Opening / Unallocated'::text,concat('balance:',p.party_id,':',p.business_unit_id,':',p.operating_location_id)
from party p join public.suppliers s on s.id=p.party_id and s.company_id=p.company_id
left join invoiced i on i.company_id=p.company_id and i.business_unit_id is not distinct from p.business_unit_id
 and i.operating_location_id is not distinct from p.operating_location_id and i.supplier_id=p.party_id
left join opening o on o.company_id=p.company_id and o.business_unit_id is not distinct from p.business_unit_id
 and o.operating_location_id is not distinct from p.operating_location_id and o.party_id=p.party_id
where exists(select 1 from imported d where d.company_id=p.company_id and d.business_unit_id is not distinct from p.business_unit_id and d.operating_location_id is not distinct from p.operating_location_id)
and abs(p.balance-coalesce(i.balance,0)-coalesce(o.balance,0))>=0.005;
revoke all on public.supplier_payable_aging_report from public,anon,authenticated;
grant select on public.supplier_payable_aging_report to authenticated;

-- Preserve side masking when exposing the additional report-only source fields.
do $mask$ declare body text; begin
select pg_get_functiondef('public._transport_mask_financial_row(jsonb,boolean,boolean)'::regprocedure) into body;
if position('source_customer_net' in body)=0 then
 body:=replace(body,'''opening_customer_document_id''','''source_customer_net'',''source_customer_gross'',''source_customer_vat'',''customer_invoice_ref'',''customer_opening_linked'',''opening_customer_document_id''');
 body:=replace(body,'''opening_supplier_document_id''','''source_supplier_net'',''source_supplier_gross'',''source_supplier_vat'',''supplier_invoice_ref'',''supplier_opening_linked'',''opening_supplier_document_id''');
 execute body;
end if;end $mask$;
CREATE OR REPLACE FUNCTION public.transport_trip_report(p_side text DEFAULT 'customer'::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
SET plan_cache_mode TO 'force_custom_plan'
SET work_mem TO '64MB'
SET statement_timeout TO '15s'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');
begin
 if not public.transport_financial_read_allowed(p_side) then raise exception 'Transport financial side view permission required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active workspace required';end if;
 if p_side is null or p_side not in ('customer','supplier') or jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>10000 then raise exception 'Invalid report filters';end if;
 if coalesce(p_filters->>'posting','posted') not in ('posted','unposted','all','opening') then raise exception 'Invalid posting filter';end if;
 with register_source as materialized (
 select * from public._transport_opening_register_rows(c,b,loc)
 union all select * from public._transport_native_register_rows(c,b,loc)
 ), base as materialized (
 select r.*,o.owner_type ownership_class,
 case when cv then coalesce(cd.original_reference,(select string_agg(so.order_no,' / ' order by so.order_no) from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders so on so.id=d.sales_order_id where l.trip_id=r.id)) end customer_invoice_ref,
 case when sv then coalesce(sd.original_reference,(select string_agg(po.order_no,' / ' order by po.order_no) from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.purchase_orders po on po.id=d.purchase_order_id where l.trip_id=r.id)) end supplier_invoice_ref,
 (cd.id is not null) customer_opening_linked,(sd.id is not null) supplier_opening_linked,
 case when cv then cl.original_net end source_customer_net,
 case when cv then round(cl.original_gross,2) end source_customer_gross,
 case when cv then round(cl.original_gross-cl.original_net,2) end source_customer_vat,
 case when sv then sl.original_net end source_supplier_net,
 case when sv then round(sl.original_gross,2) end source_supplier_gross,
 case when sv then round(sl.original_gross-sl.original_net,2) end source_supplier_vat,
 exists(select 1 from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.transport_active_journals j on j.id=d.journal_entry_id where l.trip_id=r.id and d.operating_location_id=public.current_operating_location_id()) customer_posted,
 exists(select 1 from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.transport_active_journals j on j.id=d.journal_entry_id where l.trip_id=r.id and d.operating_location_id=public.current_operating_location_id()) supplier_posted,
 coalesce((select sum(x.amount) from public.transport_trip_supplier_rents x where x.trip_id=r.id),r.supplier_rent,r.owner_rent,0) agreed_supplier_rent,
 case when cv then coalesce((select sum(x.amount) from public.transport_trip_customer_charges x where x.trip_id=r.id),0) else null end customer_charges,
 case when sv then coalesce((select sum(x.amount) from public.transport_trip_supplier_charges x where x.trip_id=r.id),0) else null end supplier_charges
 from (select masked.* from register_source fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,public._transport_mask_financial_row(to_jsonb(fr),cv,sv)) masked where fr.company_id=c and fr.business_unit_id=b) r left join public.transport_vehicle_ownership o on o.id=r.ownership_id and o.company_id=c and o.business_unit_id=b
 left join public.transport_opening_invoice_lines cl on cv and cl.trip_id=r.id and cl.side='customer'
 left join public.transport_opening_invoice_documents cd on cd.id=cl.document_id and cd.company_id=c and cd.business_unit_id=b and cd.operating_location_id=loc
 left join public.transport_opening_invoice_lines sl on sv and sl.trip_id=r.id and sl.side='supplier'
 left join public.transport_opening_invoice_documents sd on sd.id=sl.document_id and sd.company_id=c and sd.business_unit_id=b and sd.operating_location_id=loc
 where r.company_id=c and r.business_unit_id=b
 and (coalesce(p_filters->>'from','')='' or r.trip_date>=(p_filters->>'from')::date)
 and (coalesce(p_filters->>'to','')='' or r.trip_date<=(p_filters->>'to')::date)
 and (coalesce(p_filters->>'account','')='' or (p_filters->>'accountKind'='vehicle' and exists(select 1 from public.transport_trip_assignments a where a.trip_id=r.id and a.vehicle_id::text=p_filters->>'account')) or (p_filters->>'accountKind'='driver' and exists(select 1 from public.transport_drivers d where d.id=r.driver_id and d.employee_id::text=p_filters->>'account')))
 and (coalesce(p_filters->>'party','')='' or (p_side='customer' and r.customer_id::text=p_filters->>'party') or (p_side='supplier' and exists(select 1 from public.transport_trip_supplier_rents rent where rent.trip_id=r.id and rent.supplier_id::text=p_filters->>'party') or (p_side='supplier' and sd.party_id::text=p_filters->>'party')))
 and (coalesce(p_filters->>'search','')='' or position(lower(btrim(p_filters->>'search')) in lower(concat_ws(' ',r.trip_no,r.customer_name,r.owner_name,r.driver_name,r.vehicle_no,r.from_location,r.to_location,r.po_do_job_no,cd.original_reference,sd.original_reference,
 (select string_agg(so.order_no,' ') from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders so on so.id=d.sales_order_id where public.transport_financial_read_allowed('customer') and l.trip_id=r.id),
 (select string_agg(po.order_no,' ') from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.purchase_orders po on po.id=d.purchase_order_id where public.transport_financial_read_allowed('supplier') and l.trip_id=r.id))))>0)
 ), filtered as materialized (
 select * from base where coalesce(p_filters->>'posting','posted')='all'
 or (coalesce(p_filters->>'posting','posted')='opening' and case when p_side='customer' then customer_opening_linked else supplier_opening_linked end)
 or (coalesce(p_filters->>'posting','posted') in ('posted','unposted') and (case when p_side='customer' then customer_posted else supplier_posted end)= (coalesce(p_filters->>'posting','posted')='posted'))
 ), page as(select * from filtered order by trip_date desc,trip_no desc,id limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'count',(select count(*) from filtered),
 'summary',(select jsonb_build_object('source_customer_net',coalesce(sum(source_customer_net),0),'source_customer_gross',coalesce(sum(source_customer_gross),0),'source_customer_vat',coalesce(sum(source_customer_vat),0),'source_supplier_net',coalesce(sum(source_supplier_net),0),'source_supplier_gross',coalesce(sum(source_supplier_gross),0),'source_supplier_vat',coalesce(sum(source_supplier_vat),0),'customer_rate',coalesce(sum(customer_rate),0),'customer_charges',coalesce(sum(customer_charges),0),'agreed_supplier_rent',coalesce(sum(agreed_supplier_rent),0),'supplier_charges',coalesce(sum(supplier_charges),0),'driver_pay',coalesce(sum(driver_pay),0),'billed_customer_net',coalesce(sum(billed_customer_net),0),'billed_supplier_net',coalesce(sum(billed_supplier_net),0),'driver_accrued',coalesce(sum(driver_accrued),0),'other_cost_net',coalesce(sum(other_cost_net),0),'customer_received_gross',coalesce(sum(customer_received_gross),0),'customer_outstanding_gross',coalesce(sum(customer_outstanding_gross),0),'customer_credit_gross',coalesce(sum(customer_credit_gross),0),'supplier_paid_gross',coalesce(sum(payment_amount),0),'supplier_outstanding_gross',coalesce(sum(supplier_outstanding_gross),0),'supplier_credit_gross',coalesce(sum(supplier_credit_gross),0),'driver_paid',coalesce(sum(driver_paid),0),'driver_outstanding',coalesce(sum(driver_outstanding),0),'revenue',coalesce(sum(billed_customer_net),0),'cost',coalesce(sum(coalesce(billed_supplier_net,0)+coalesce(driver_accrued,0)+coalesce(other_cost_net,0)),0),'profit',coalesce(sum(coalesce(billed_customer_net,0)-coalesce(billed_supplier_net,0)-coalesce(driver_accrued,0)-coalesce(other_cost_net,0)),0)) from filtered)) into answer;
 answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public._transport_mask_financial_row(value,cv,sv)) from jsonb_array_elements(answer->'rows')),'[]'));answer:=jsonb_set(answer,'{summary}',public._transport_mask_financial_row(answer->'summary',cv,sv));return answer;
end $function$;


notify pgrst,'reload schema';

-- Net totals are known; a base-versus-charge split was not supplied by the source.
do $detail$ declare body text; begin
 select pg_get_functiondef('public.transport_opening_invoice_query(text,text,jsonb,integer,integer)'::regprocedure) into body;
 body:=replace(body,'d.original_net base_amount,null::numeric charge_amount','null::numeric base_amount,null::numeric charge_amount,d.original_net source_net');
 execute body;
end $detail$;
