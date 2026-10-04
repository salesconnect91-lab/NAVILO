begin;
-- Reuse statement-local checked capabilities, never a client-supplied permission flag.
-- The pure masking helper cannot be invoked by authenticated/anonymous callers.
create or replace function public._transport_mask_financial_row(p_row jsonb, cv boolean, sv boolean) returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare keys text[]:=array['id','company_id','business_unit_id','trip_no','trip_date','status','lifecycle_status','trip_status','job_status','vehicle_id','driver_id','truck_type','truck_type_id','truck_type_name','vehicle_no','driver_name','from_location','to_location','from_location_id','to_location_id','po_do_job_no','service_period','notes','sale_type','ppr_status','ppr_received_by_employee_id','ppr_received_by_name','ppr_received_by','ppr_received_date','ppr_attachment_path','customer_id','customer_name','customer_name_snapshot','created_at','updated_at','created_by','updated_by']::text[];
begin
 if cv and sv then return coalesce(p_row,'{}');end if;
 if cv then keys:=keys||array['customer_rate','customer_rate_state','customer_rate_source','customer_rate_reference_id','customer_rate_snapshot','customer_rate_finalized_at','customer_rate_finalized_by','customer_rate_status','customer_rate_locked','billed_customer_net','received_from_company','remaining_with_company','customer_received_gross','customer_outstanding_gross','customer_credit_gross','sales_order_id','source_invoice_no','invoice_no','sale_type','invoiced','company_rate','received_company','remaining_company','customer_credit','customer_posted','revenue']::text[];end if;
 if sv then keys:=keys||array['owner_supplier_id','owner_name','owner_name_snapshot','ownership_id','ownership_class','rent_state','rent_finalized_at','rent_finalized_by','supplier_rent','supplier_rent_status','supplier_rate_locked','owner_rent','billed_supplier_net','supplier_paid_net','supplier_outstanding_gross','supplier_credit_gross','driver_accrued','driver_paid','driver_pay','driver_outstanding','fuel_cost','toll_cost','other_cost','other_cost_net','commission_paid_net','remaining_with_us','payment_date','payment_amount','rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_balance','amount','commission','agreed_supplier_rent','supplier_posted','rent','posted','legacyBlocked','party_id','rent_id']::text[];end if;
 return coalesce((select jsonb_object_agg(key,value) from jsonb_each(p_row) where key=any(keys)),'{}');
end $$;

revoke all on function public._transport_mask_financial_row(jsonb,boolean,boolean) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.transport_register_query(p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT ''::text, p_direction text DEFAULT 'asc'::text, p_option_key text DEFAULT NULL::text, p_option_search text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();answer jsonb;needs_cells boolean;cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');
begin
 if auth.uid() is null or c is null or b is null or not public.has_module_permission(c,'transport','view')
 then raise exception 'Transport view permission and active Company/Business Unit required';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>100000 then raise exception 'Invalid filters';end if;
 if (p_option_key=any(array['company_rate','received_company','remaining_company','customer_credit','invoice_no','sale_type','invoiced']) or p_sort=any(array['company_rate','received_company','remaining_company','customer_credit','invoice_no','sale_type','invoiced']) or (coalesce(p_filters->'columns','{}') ?| array['company_rate','received_company','remaining_company','customer_credit','invoice_no','sale_type','invoiced'])) and not cv then raise exception 'Customer financial view permission required';end if;
 if (p_option_key=any(array['rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_pay','driver_paid','driver_balance','payment_date','amount','commission','owner']) or p_sort=any(array['rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_pay','driver_paid','driver_balance','payment_date','amount','commission','owner']) or (coalesce(p_filters->'columns','{}') ?| array['rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_pay','driver_paid','driver_balance','payment_date','amount','commission','owner'])) and not sv then raise exception 'Supplier financial view permission required';end if;
 if (p_sort='profit' or p_option_key='profit' or coalesce(p_filters->'columns','{}') ? 'profit') and not (cv and sv) then raise exception 'Both financial view permissions required';end if;
 if p_filters->>'snapshot'='true' and not public.has_module_permission(c,'transport','export') then raise exception 'Transport export permission required';end if;
 needs_cells:=p_filters->>'snapshot'='true' or p_option_key is not null or coalesce(p_sort,'')<>'' or coalesce(p_filters->>'search','')<>'' or exists(select 1 from jsonb_each(coalesce(p_filters->'columns','{}')) f where jsonb_array_length(f.value)>0);
 with scoped as materialized (
  select r.id,r.trip_date,r.payment_date,r.trip_no,coalesce(r.lifecycle_status,r.status) status,r.financial_status,r.ppr_status,r.customer_name,r.driver_name,r.vehicle_no,r.po_do_job_no,r.from_location,r.to_location,coalesce(r.billed_supplier_net,(select sum(coalesce(q.finalized_amount_snapshot,q.amount)) from public.transport_trip_supplier_rents q where sv and q.trip_id=r.id),r.supplier_rent,r.owner_rent,0) n_rent_driver,coalesce(r.supplier_paid_net,0) n_supplier_paid,greatest(coalesce(r.supplier_outstanding_gross,r.remaining_with_us,0),0) n_supplier_balance,greatest(coalesce(r.supplier_credit_gross,0),0) n_supplier_credit,coalesce(r.driver_accrued,r.driver_pay,0) n_driver_pay,coalesce(r.driver_paid,0) n_driver_paid,coalesce(r.driver_outstanding,0) n_driver_balance,coalesce(r.payment_amount,0) n_amount,coalesce(r.billed_customer_net,r.customer_rate,0) n_company_rate,coalesce(r.received_from_company,0) n_received_company,greatest(coalesce(r.customer_outstanding_gross,r.remaining_with_company,0),0) n_remaining_company,greatest(coalesce(r.customer_credit_gross,0),0) n_customer_credit,coalesce(r.trip_profit,0) n_profit,coalesce(r.commission_paid_net,0) n_commission,jsonb_build_object('cells',case when needs_cells then jsonb_build_object(
'trip_no',coalesce(nullif(r.trip_no,''),'?'),
'trip_date',coalesce(nullif(to_char(r.trip_date,'DD-Mon-YY'),''),'?'),
'truck_type',coalesce(nullif(r.truck_type_name,''),'?'),
'job_no',coalesce(nullif(r.po_do_job_no,''),'?'),
'invoiced',coalesce(nullif(case when r.invoiced then 'Yes' else 'No' end,''),'?'),
'company',coalesce(nullif(r.customer_name,''),'?'),
'driver',coalesce(nullif(r.driver_name,''),'?'),
'owner',coalesce(nullif(r.owner_name,''),'?'),
'plate',coalesce(nullif(r.vehicle_no,''),'?'),
'from',coalesce(nullif(r.from_location,''),'?'),
'to',coalesce(nullif(r.to_location,''),'?'),
'paper_received_by',coalesce(nullif(case when r.ppr_status='received' then coalesce(nullif(r.ppr_received_by_name,''),'—')||coalesce(' · '||to_char(r.ppr_received_date,'DD-Mon-YY'),'') else 'Pending' end,''),'?'),
'payment_date',coalesce(nullif(to_char(r.payment_date,'DD-Mon-YY'),''),'?'),
'invoice_no',coalesce(nullif(coalesce((select s.order_no from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders s on s.id=d.sales_order_id where cv and l.trip_id=r.id and not l.is_adjustment order by l.id limit 1),(select nullif(btrim(t.source_invoice_no),'') from public.transport_trips t where cv and t.id=r.id)),''),'?'),
'sale_type',coalesce(nullif(r.sale_type,''),'?'),
'rent_driver',to_char(coalesce(r.billed_supplier_net,(select sum(coalesce(q.finalized_amount_snapshot,q.amount)) from public.transport_trip_supplier_rents q where sv and q.trip_id=r.id),r.supplier_rent,r.owner_rent,0),'FM999,999,999,999,999,990.00'),
'supplier_paid',to_char(coalesce(r.supplier_paid_net,0),'FM999,999,999,999,999,990.00'),
'supplier_balance',to_char(greatest(coalesce(r.supplier_outstanding_gross,r.remaining_with_us,0),0),'FM999,999,999,999,999,990.00'),
'supplier_credit',to_char(greatest(coalesce(r.supplier_credit_gross,0),0),'FM999,999,999,999,999,990.00'),
'driver_pay',to_char(coalesce(r.driver_accrued,r.driver_pay,0),'FM999,999,999,999,999,990.00'),
'driver_paid',to_char(coalesce(r.driver_paid,0),'FM999,999,999,999,999,990.00'),
'driver_balance',to_char(coalesce(r.driver_outstanding,0),'FM999,999,999,999,999,990.00'),
'amount',to_char(coalesce(r.payment_amount,0),'FM999,999,999,999,999,990.00'),
'company_rate',to_char(coalesce(r.billed_customer_net,r.customer_rate,0),'FM999,999,999,999,999,990.00'),
'received_company',to_char(coalesce(r.received_from_company,0),'FM999,999,999,999,999,990.00'),
'remaining_company',to_char(greatest(coalesce(r.customer_outstanding_gross,r.remaining_with_company,0),0),'FM999,999,999,999,999,990.00'),
'customer_credit',to_char(greatest(coalesce(r.customer_credit_gross,0),0),'FM999,999,999,999,999,990.00'),
'profit',to_char(coalesce(r.trip_profit,0),'FM999,999,999,999,999,990.00'),
'commission',to_char(coalesce(r.commission_paid_net,0),'FM999,999,999,999,999,990.00')) else '{}'::jsonb end, 'numbers',case when needs_cells then jsonb_build_object(
'rent_driver',coalesce(r.billed_supplier_net,(select sum(coalesce(q.finalized_amount_snapshot,q.amount)) from public.transport_trip_supplier_rents q where sv and q.trip_id=r.id),r.supplier_rent,r.owner_rent,0),
'supplier_paid',coalesce(r.supplier_paid_net,0),
'supplier_balance',greatest(coalesce(r.supplier_outstanding_gross,r.remaining_with_us,0),0),
'supplier_credit',greatest(coalesce(r.supplier_credit_gross,0),0),
'driver_pay',coalesce(r.driver_accrued,r.driver_pay,0),
'driver_paid',coalesce(r.driver_paid,0),
'driver_balance',coalesce(r.driver_outstanding,0),
'amount',coalesce(r.payment_amount,0),
'company_rate',coalesce(r.billed_customer_net,r.customer_rate,0),
'received_company',coalesce(r.received_from_company,0),
'remaining_company',greatest(coalesce(r.customer_outstanding_gross,r.remaining_with_company,0),0),
'customer_credit',greatest(coalesce(r.customer_credit_gross,0),0),
'profit',coalesce(r.trip_profit,0),
'commission',coalesce(r.commission_paid_net,0)) else '{}'::jsonb end) vals from (select fr.* from public.transport_financial_register fr where cv and sv and fr.company_id=c and fr.business_unit_id=b union all select masked.* from public.transport_financial_register fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,public._transport_mask_financial_row(to_jsonb(fr),cv,sv)) masked where not (cv and sv) and fr.company_id=c and fr.business_unit_id=b) r
  where r.company_id=c and r.business_unit_id=b
   and (coalesce(p_filters->>'fromDate','')='' or r.trip_date>=(p_filters->>'fromDate')::date)
   and (coalesce(p_filters->>'toDate','')='' or r.trip_date<=(p_filters->>'toDate')::date)
   and (coalesce(p_filters->>'customer','')='' or r.customer_name=p_filters->>'customer')
   and (coalesce(p_filters->>'driver','')='' or r.driver_name=p_filters->>'driver')
   and (coalesce(p_filters->>'vehicle','')='' or r.vehicle_no=p_filters->>'vehicle')
   and (coalesce(p_filters->>'from','')='' or r.from_location=p_filters->>'from')
   and (coalesce(p_filters->>'to','')='' or r.to_location=p_filters->>'to')
   and (coalesce(p_filters->>'ppr','')='' or r.ppr_status=p_filters->>'ppr')
 ), filtered as materialized (
  select * from scoped x where
   (coalesce(jsonb_array_length(p_filters->'statuses'),0)=0 or exists(select 1 from jsonb_array_elements_text(p_filters->'statuses') s
    where s='trip:'||x.status or s='financial:'||x.financial_status))
   and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(concat_ws(' ',x.trip_no,x.po_do_job_no,x.customer_name,x.driver_name,x.vehicle_no,x.from_location,x.to_location,x.vals->'cells'->>'invoice_no')))>0)
   and not exists(select 1 from jsonb_each(coalesce(p_filters->'columns','{}')) f
    where f.key is distinct from p_option_key and jsonb_array_length(f.value)>0
     and not f.value @> jsonb_build_array(x.vals->'cells'->>f.key))
 ), chosen as materialized (
  select x.id,x.n_rent_driver rent,row_number() over(order by case when p_direction='asc' and p_sort='trip_date' then x.trip_date end asc,
   case when p_direction='desc' and p_sort='trip_date' then x.trip_date end desc,
   case when p_direction='asc' and p_sort='payment_date' then x.payment_date end asc,
   case when p_direction='desc' and p_sort='payment_date' then x.payment_date end desc,
   case when p_direction='asc' and x.vals->'numbers' ? p_sort then (x.vals->'numbers'->>p_sort)::numeric end asc,
   case when p_direction='desc' and x.vals->'numbers' ? p_sort then (x.vals->'numbers'->>p_sort)::numeric end desc,
   case when p_direction='asc' and p_sort not in ('trip_date','payment_date') and not x.vals->'numbers' ? p_sort then x.vals->'cells'->>p_sort end asc,
   case when p_direction='desc' and p_sort not in ('trip_date','payment_date') and not x.vals->'numbers' ? p_sort then x.vals->'cells'->>p_sort end desc,
   x.trip_date desc,x.trip_no desc,x.id) ordinal
  from filtered x
  order by
   case when p_direction='asc' and p_sort='trip_date' then x.trip_date end asc,
   case when p_direction='desc' and p_sort='trip_date' then x.trip_date end desc,
   case when p_direction='asc' and p_sort='payment_date' then x.payment_date end asc,
   case when p_direction='desc' and p_sort='payment_date' then x.payment_date end desc,
   case when p_direction='asc' and x.vals->'numbers' ? p_sort then (x.vals->'numbers'->>p_sort)::numeric end asc,
   case when p_direction='desc' and x.vals->'numbers' ? p_sort then (x.vals->'numbers'->>p_sort)::numeric end desc,
   case when p_direction='asc' and p_sort not in ('trip_date','payment_date') and not x.vals->'numbers' ? p_sort then x.vals->'cells'->>p_sort end asc,
   case when p_direction='desc' and p_sort not in ('trip_date','payment_date') and not x.vals->'numbers' ? p_sort then x.vals->'cells'->>p_sort end desc,
   x.trip_date desc,x.trip_no desc,x.id
  limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0)
 ), page as (
  select public._transport_mask_financial_row(to_jsonb(r),cv,sv)||jsonb_build_object('supplier_rent',chosen.rent,'invoice_no',coalesce(
   (select so.order_no from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders so on so.id=d.sales_order_id where cv and l.trip_id=r.id and not l.is_adjustment order by l.id limit 1),
   (select nullif(btrim(t.source_invoice_no),'') from public.transport_trips t where cv and t.id=r.id))) row,chosen.ordinal
  from chosen join (select fr.* from public.transport_financial_register fr where cv and sv and fr.company_id=c and fr.business_unit_id=b union all select masked.* from public.transport_financial_register fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,public._transport_mask_financial_row(to_jsonb(fr),cv,sv)) masked where not (cv and sv) and fr.company_id=c and fr.business_unit_id=b) r on r.id=chosen.id and r.company_id=c and r.business_unit_id=b
 ), sums as (select jsonb_build_object('rent_driver',coalesce(sum(x.n_rent_driver),0),'supplier_paid',coalesce(sum(x.n_supplier_paid),0),'supplier_balance',coalesce(sum(x.n_supplier_balance),0),'supplier_credit',coalesce(sum(x.n_supplier_credit),0),'driver_pay',coalesce(sum(x.n_driver_pay),0),'driver_paid',coalesce(sum(x.n_driver_paid),0),'driver_balance',coalesce(sum(x.n_driver_balance),0),'amount',coalesce(sum(x.n_amount),0),'company_rate',coalesce(sum(x.n_company_rate),0),'received_company',coalesce(sum(x.n_received_company),0),'remaining_company',coalesce(sum(x.n_remaining_company),0),'customer_credit',coalesce(sum(x.n_customer_credit),0),'profit',coalesce(sum(x.n_profit),0),'commission',coalesce(sum(x.n_commission),0)) totals from filtered x),
 options as (select distinct x.vals->'cells'->>p_option_key value from filtered x
  where position(
 lower(case when x.vals->'numbers' ? p_option_key then replace(btrim(coalesce(p_option_search,'')),',','') else btrim(coalesce(p_option_search,'')) end)
 in lower(case when x.vals->'numbers' ? p_option_key then replace(x.vals->'cells'->>p_option_key,',','') else x.vals->'cells'->>p_option_key end))>0
  order by value limit 200),
 statuses as (select distinct 'trip:'||x.status key,'Trip · '||x.status label from scoped x
  union select distinct 'financial:'||x.financial_status,'Financial · '||x.financial_status from scoped x)
 select case when p_option_key is not null then jsonb_build_object('options',coalesce((select jsonb_agg(value) from options),'[]'))
 else jsonb_build_object('snapshot',case when p_filters->>'snapshot'='true' then (select md5(coalesce(string_agg(id::text||md5(concat_ws('|',status,financial_status,ppr_status,vals::text)),'' order by id),'')) from filtered) end,'rows',coalesce((select jsonb_agg(row order by ordinal) from page),'[]'),'count',(select count(*) from filtered),
  'completed',(select count(*) from filtered where financial_status in ('Complete','Closed')),
  'paper_pending',(select count(*) from filtered where ppr_status is distinct from 'received'),
  'statuses',coalesce((select jsonb_agg(to_jsonb(statuses)) from statuses),'[]'),
  'totals',coalesce((select totals from sums),'{}')) end into answer;
 answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public._transport_mask_financial_row(value,cv,sv)) from jsonb_array_elements(answer->'rows')),'[]'));
 answer:=jsonb_set(answer,'{totals}',public._transport_mask_financial_row(answer->'totals',cv,sv));
 return answer||jsonb_build_object('permissions',jsonb_build_object('customer',cv,'supplier',sv));
end $function$
;



CREATE OR REPLACE FUNCTION public.transport_bulk_rate_page(p_side text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();answer jsonb;cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');
begin
 if (coalesce(p_filters->'columns','{}') ?| array['rate','rateStatus']) and not public.transport_financial_read_allowed('customer') then raise exception 'Customer financial view permission required';end if;
 if (coalesce(p_filters->'columns','{}') ?| array['rent','rentStatus','owner']) and not public.transport_financial_read_allowed('supplier') then raise exception 'Supplier financial view permission required';end if;
 if not public.transport_financial_read_allowed(p_side) then raise exception 'Transport financial side view permission required';end if;
 if auth.uid() is null or c is null or b is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active workspace required';end if;
 if p_side not in ('customer','supplier') or jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>100000 then raise exception 'Invalid bulk filters';end if;
 with base as materialized (
  select t.id,t.trip_no,t.trip_date,coalesce(t.lifecycle_status,t.status) trip_status,t.customer_id,coalesce(cu.name,t.customer_name_snapshot) customer_name,
   v.vehicle_no,dr.driver_name,t.from_location,t.to_location,t.po_do_job_no,t.sale_type,t.customer_rate,t.customer_rate_state,
   t.sales_order_id,t.owner_supplier_id,t.owner_name_snapshot,t.supplier_rent,t.owner_rent,t.rent_state,t.rent_finalized_at,
   (t.sales_order_id is not null or exists(select 1 from public.transport_customer_document_trips l where l.trip_id=t.id)) customer_rate_locked,
   case when p_side='customer' then (select r.billed_customer_net from public.transport_financial_register r where r.id=t.id) end billed_customer_net
  from public.transport_trips t left join public.customers cu on cu.id=t.customer_id
  left join public.transport_vehicles v on v.id=t.vehicle_id left join public.transport_drivers dr on dr.id=t.driver_id
  where t.company_id=c and t.business_unit_id=b
   and (coalesce(p_filters->>'initialTrip','')='' or t.id::text=p_filters->>'initialTrip')
   and (coalesce(p_filters->>'status','')='' or t.status=p_filters->>'status')
   and (coalesce(p_filters->>'search','')='' or position(lower(btrim(p_filters->>'search')) in lower(concat_ws(' ',t.trip_no,t.po_do_job_no,cu.name,t.customer_name_snapshot,dr.driver_name,v.vehicle_no,t.from_location,t.to_location)))>0)
 ), lines as materialized (
  select to_jsonb(t)||jsonb_build_object('posted',t.customer_rate_locked) row,
   t.customer_id party,t.trip_date,t.trip_no,t.id::text key,
   case when t.customer_rate_locked then 'posted correction required' when t.customer_rate_state='finalized' then 'finalized editable until post' else 'pending ready to finalize' end state
  from base t where p_side='customer'
  union all
  select to_jsonb(t)||jsonb_build_object('id',coalesce(r.id::text,'new:'||t.id::text),'trip_id',t.id,'party_id',coalesce(r.supplier_id,t.owner_supplier_id),
   'owner_name',coalesce(s.name,r.supplier_name_snapshot,t.owner_name_snapshot),
   'posted',exists(select 1 from public.transport_supplier_document_rents l where l.rent_id=r.id),
   'legacyBlocked',r.id is null and (t.rent_state='finalized' or t.rent_finalized_at is not null),
   'supplier_rent',coalesce(r.amount+a.difference,t.supplier_rent,t.owner_rent),
   'owner_rent',coalesce(r.amount+a.difference,t.supplier_rent,t.owner_rent),
   'billed_supplier_net',case when exists(select 1 from public.transport_supplier_document_rents l where l.rent_id=r.id) then r.amount+a.difference end,
   'rent',case when r.id is not null then to_jsonb(r)||jsonb_build_object('trip_id',r.id,'amount',r.amount+a.difference,'finalized_amount_snapshot',r.amount+a.difference) end),
   coalesce(r.supplier_id,t.owner_supplier_id),t.trip_date,t.trip_no,coalesce(r.id::text,'new:'||t.id::text),
   case when exists(select 1 from public.transport_supplier_document_rents l where l.rent_id=r.id) then 'posted correction required'
    when r.id is null and (t.rent_state='finalized' or t.rent_finalized_at is not null) then 'legacy correction required'
    when r.state='finalized' then 'finalized editable until post' else 'pending ready to finalize' end
  from base t left join public.transport_trip_supplier_rents r on r.trip_id=t.id
  left join public.suppliers s on s.id=coalesce(r.supplier_id,t.owner_supplier_id)
  left join lateral(select coalesce(sum(difference),0) difference from public.transport_rate_adjustments a where a.rent_id=r.id and a.side='supplier') a on true
  where p_side='supplier'
 ), cells as (
  select l.*,jsonb_build_object('trip',row->>'trip_no','date',to_char(trip_date,'DD-Mon-YY'),'status',coalesce(row->>'trip_status','—'),
   'company',row->>'customer_name','route',coalesce(row->>'from_location','')||' '||coalesce(row->>'to_location',''),
   'vehicle',row->>'vehicle_no','driver',row->>'driver_name','job',row->>'po_do_job_no','sale',row->>'sale_type','owner',row->>'owner_name',
   'rate',case when (row->>'posted')::boolean then row->>'billed_customer_net' else row->>'customer_rate' end,
   'rent',row->>'supplier_rent','rateStatus',state,'rentStatus',state) as cell_values from lines l
 ), filtered as materialized (
  select * from cells x where (coalesce(p_filters->>'party','')='' or x.party::text=p_filters->>'party')
   and not exists(select 1 from jsonb_each_text(coalesce(p_filters->'columns','{}')) f
    where btrim(f.value)<>'' and position(
 lower(case when f.key in ('rate','rent') then replace(btrim(f.value),',','') else regexp_replace(btrim(f.value),'[[:space:]]*(→|->)[[:space:]]*',' ','g') end)
 in lower(case when f.key in ('rate','rent') then replace(coalesce(x.cell_values->>f.key,''),',','') else regexp_replace(coalesce(x.cell_values->>f.key,''),'[[:space:]]*(→|->)[[:space:]]*',' ','g') end))=0)
 ), page as (select row||jsonb_build_object('invoice_no',case when p_side='customer' then
 (select so.order_no from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders so on so.id=d.sales_order_id where l.trip_id=(row->>'id')::uuid and not l.is_adjustment order by l.id limit 1)
 else (select po.order_no from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.purchase_orders po on po.id=d.purchase_order_id where l.rent_id=(row->'rent'->>'id')::uuid and not l.is_adjustment order by l.id limit 1) end) row from filtered order by trip_date desc,trip_no desc,key
  limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(row) from page),'[]'),'count',(select count(*) from filtered),
  'amount',coalesce((select sum(case when p_side='supplier' then (row->>'supplier_rent')::numeric when (row->>'posted')::boolean then (row->>'billed_customer_net')::numeric else (row->>'customer_rate')::numeric end) from filtered),0),
  'statuses',coalesce((select jsonb_agg(status) from (select distinct trip_status status from base) s),'[]')) into answer;
 answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public._transport_mask_financial_row(value,cv,sv)) from jsonb_array_elements(answer->'rows')),'[]'));return answer;
end $function$
;


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
 coalesce((select sum(x.amount) from public.transport_trip_supplier_rents x where x.trip_id=r.id),r.supplier_rent,r.owner_rent,0) agreed_supplier_rent
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
 'summary',(select jsonb_build_object('customer_rate',coalesce(sum(customer_rate),0),'agreed_supplier_rent',coalesce(sum(agreed_supplier_rent),0),'driver_pay',coalesce(sum(driver_pay),0),'billed_customer_net',coalesce(sum(billed_customer_net),0),'billed_supplier_net',coalesce(sum(billed_supplier_net),0),'driver_accrued',coalesce(sum(driver_accrued),0),'other_cost_net',coalesce(sum(other_cost_net),0),'customer_received_gross',coalesce(sum(customer_received_gross),0),'customer_outstanding_gross',coalesce(sum(customer_outstanding_gross),0),'customer_credit_gross',coalesce(sum(customer_credit_gross),0),'supplier_paid_gross',coalesce(sum(payment_amount),0),'supplier_outstanding_gross',coalesce(sum(supplier_outstanding_gross),0),'supplier_credit_gross',coalesce(sum(supplier_credit_gross),0),'driver_paid',coalesce(sum(driver_paid),0),'driver_outstanding',coalesce(sum(driver_outstanding),0),'revenue',coalesce(sum(billed_customer_net),0),'cost',coalesce(sum(coalesce(billed_supplier_net,0)+coalesce(driver_accrued,0)+coalesce(other_cost_net,0)),0),'profit',coalesce(sum(coalesce(billed_customer_net,0)-coalesce(billed_supplier_net,0)-coalesce(driver_accrued,0)-coalesce(other_cost_net,0)),0)) from filtered)) into answer;
 answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public._transport_mask_financial_row(value,cv,sv)) from jsonb_array_elements(answer->'rows')),'[]'));answer:=jsonb_set(answer,'{summary}',public._transport_mask_financial_row(answer->'summary',cv,sv));return answer;
end $function$
;


notify pgrst,'reload schema';
commit;
