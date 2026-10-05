begin;
-- Canonical charge breakdown for Transport reports. Agreed and posted totals already include charges; never double-count.
create or replace function public._transport_mask_financial_row(p_row jsonb, cv boolean, sv boolean) returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare keys text[]:=array['id','company_id','business_unit_id','trip_no','trip_date','status','lifecycle_status','trip_status','job_status','vehicle_id','driver_id','truck_type','truck_type_id','truck_type_name','vehicle_no','driver_name','from_location','to_location','from_location_id','to_location_id','po_do_job_no','service_period','notes','sale_type','ppr_status','ppr_received_by_employee_id','ppr_received_by_name','ppr_received_by','ppr_received_date','ppr_attachment_path','customer_id','customer_name','customer_name_snapshot','created_at','updated_at','created_by','updated_by']::text[];
begin
 if cv and sv then return coalesce(p_row,'{}');end if;
 if cv then keys:=keys||array['customer_rate','customer_rate_state','customer_rate_source','customer_rate_reference_id','customer_rate_snapshot','customer_rate_finalized_at','customer_rate_finalized_by','customer_rate_status','customer_rate_locked','billed_customer_net','received_from_company','remaining_with_company','customer_received_gross','customer_outstanding_gross','customer_credit_gross','sales_order_id','source_invoice_no','invoice_no','sale_type','invoiced','company_rate','received_company','remaining_company','customer_credit','customer_posted','revenue','customer_charges']::text[];end if;
 if sv then keys:=keys||array['owner_supplier_id','owner_name','owner_name_snapshot','ownership_id','ownership_class','rent_state','rent_finalized_at','rent_finalized_by','supplier_rent','supplier_rent_status','supplier_rate_locked','owner_rent','billed_supplier_net','supplier_paid_net','supplier_outstanding_gross','supplier_credit_gross','driver_accrued','driver_paid','driver_pay','driver_outstanding','fuel_cost','toll_cost','other_cost','other_cost_net','commission_paid_net','remaining_with_us','payment_date','payment_amount','rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_balance','amount','commission','agreed_supplier_rent','supplier_charges','supplier_posted','rent','posted','legacyBlocked','party_id','rent_id']::text[];end if;
 return coalesce((select jsonb_object_agg(key,value) from jsonb_each(p_row) where key=any(keys)),'{}');
end $$;
revoke all on function public._transport_mask_financial_row(jsonb,boolean,boolean) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.transport_trip_report(p_side text DEFAULT 'customer'::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();answer jsonb;cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');
begin
 if not public.transport_financial_read_allowed(p_side) then raise exception 'Transport financial side view permission required';end if;
 if auth.uid() is null or c is null or b is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active workspace required';end if;
 if p_side is null or p_side not in ('customer','supplier') or jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>10000 then raise exception 'Invalid report filters';end if;
 if coalesce(p_filters->>'posting','posted') not in ('posted','unposted','all') then raise exception 'Invalid posting filter';end if;
 with base as materialized (
 select r.*,o.owner_type ownership_class,
 exists(select 1 from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.transport_active_journals j on j.id=d.journal_entry_id where l.trip_id=r.id and d.operating_location_id=public.current_operating_location_id()) customer_posted,
 exists(select 1 from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.transport_active_journals j on j.id=d.journal_entry_id where l.trip_id=r.id and d.operating_location_id=public.current_operating_location_id()) supplier_posted,
 coalesce((select sum(x.amount) from public.transport_trip_supplier_rents x where x.trip_id=r.id),r.supplier_rent,r.owner_rent,0) agreed_supplier_rent,
 case when cv then coalesce((select sum(x.amount) from public.transport_trip_customer_charges x where x.trip_id=r.id),0) else null end customer_charges,
 case when sv then coalesce((select sum(x.amount) from public.transport_trip_supplier_charges x where x.trip_id=r.id),0) else null end supplier_charges
 from (select masked.* from public.transport_financial_register fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,public._transport_mask_financial_row(to_jsonb(fr),cv,sv)) masked where fr.company_id=c and fr.business_unit_id=b) r left join public.transport_vehicle_ownership o on o.id=r.ownership_id and o.company_id=c and o.business_unit_id=b
 where r.company_id=c and r.business_unit_id=b
 and (coalesce(p_filters->>'from','')='' or r.trip_date>=(p_filters->>'from')::date)
 and (coalesce(p_filters->>'to','')='' or r.trip_date<=(p_filters->>'to')::date)
 and (coalesce(p_filters->>'account','')='' or (p_filters->>'accountKind'='vehicle' and exists(select 1 from public.transport_trip_assignments a where a.trip_id=r.id and a.vehicle_id::text=p_filters->>'account')) or (p_filters->>'accountKind'='driver' and exists(select 1 from public.transport_drivers d where d.id=r.driver_id and d.employee_id::text=p_filters->>'account')))
 and (coalesce(p_filters->>'party','')='' or (p_side='customer' and r.customer_id::text=p_filters->>'party') or (p_side='supplier' and exists(select 1 from public.transport_trip_supplier_rents rent where rent.trip_id=r.id and rent.supplier_id::text=p_filters->>'party')))
 and (coalesce(p_filters->>'search','')='' or position(lower(btrim(p_filters->>'search')) in lower(concat_ws(' ',r.trip_no,r.customer_name,r.owner_name,r.driver_name,r.vehicle_no,r.from_location,r.to_location,r.po_do_job_no,
 (select string_agg(so.order_no,' ') from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders so on so.id=d.sales_order_id where public.transport_financial_read_allowed('customer') and l.trip_id=r.id),
 (select string_agg(po.order_no,' ') from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.purchase_orders po on po.id=d.purchase_order_id where public.transport_financial_read_allowed('supplier') and l.trip_id=r.id))))>0)
 ), filtered as materialized (
 select * from base where coalesce(p_filters->>'posting','posted')='all'
 or (case when p_side='customer' then customer_posted else supplier_posted end)= (coalesce(p_filters->>'posting','posted')='posted')
 ), page as(select * from filtered order by trip_date desc,trip_no desc,id limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'count',(select count(*) from filtered),
 'summary',(select jsonb_build_object('customer_rate',coalesce(sum(customer_rate),0),'customer_charges',coalesce(sum(customer_charges),0),'agreed_supplier_rent',coalesce(sum(agreed_supplier_rent),0),'supplier_charges',coalesce(sum(supplier_charges),0),'driver_pay',coalesce(sum(driver_pay),0),'billed_customer_net',coalesce(sum(billed_customer_net),0),'billed_supplier_net',coalesce(sum(billed_supplier_net),0),'driver_accrued',coalesce(sum(driver_accrued),0),'other_cost_net',coalesce(sum(other_cost_net),0),'customer_received_gross',coalesce(sum(customer_received_gross),0),'customer_outstanding_gross',coalesce(sum(customer_outstanding_gross),0),'customer_credit_gross',coalesce(sum(customer_credit_gross),0),'supplier_paid_gross',coalesce(sum(payment_amount),0),'supplier_outstanding_gross',coalesce(sum(supplier_outstanding_gross),0),'supplier_credit_gross',coalesce(sum(supplier_credit_gross),0),'driver_paid',coalesce(sum(driver_paid),0),'driver_outstanding',coalesce(sum(driver_outstanding),0),'revenue',coalesce(sum(billed_customer_net),0),'cost',coalesce(sum(coalesce(billed_supplier_net,0)+coalesce(driver_accrued,0)+coalesce(other_cost_net,0)),0),'profit',coalesce(sum(coalesce(billed_customer_net,0)-coalesce(billed_supplier_net,0)-coalesce(driver_accrued,0)-coalesce(other_cost_net,0)),0)) from filtered)) into answer;
 answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public._transport_mask_financial_row(value,cv,sv)) from jsonb_array_elements(answer->'rows')),'[]'));answer:=jsonb_set(answer,'{summary}',public._transport_mask_financial_row(answer->'summary',cv,sv));return answer;
end $function$
;


notify pgrst,'reload schema';
commit;
