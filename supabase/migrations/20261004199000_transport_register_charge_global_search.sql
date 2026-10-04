begin;
-- Complete dashboard global search including the visible Charge column.
-- Full function replacement is intentional so fresh migration replay and production converge.
-- Dashboard global search: search every visible/register column server-side across the full scoped trip set.
-- Keeps existing permission masking, pagination, totals, sorting and column filters intact.
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
 with agreed_rents as materialized (select trip_id,sum(coalesce(finalized_amount_snapshot,amount)) amount from public.transport_trip_supplier_rents where company_id=c and business_unit_id=b group by trip_id), scoped as materialized (
  select r.id,r.trip_date,r.payment_date,r.trip_no,coalesce(r.lifecycle_status,r.status) status,r.financial_status,r.ppr_status,r.customer_name,r.driver_name,r.vehicle_no,r.po_do_job_no,r.from_location,r.to_location,coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0) n_rent_driver,coalesce(r.supplier_paid_net,0) n_supplier_paid,greatest(coalesce(r.supplier_outstanding_gross,r.remaining_with_us,0),0) n_supplier_balance,greatest(coalesce(r.supplier_credit_gross,0),0) n_supplier_credit,coalesce(r.driver_accrued,r.driver_pay,0) n_driver_pay,coalesce(r.driver_paid,0) n_driver_paid,coalesce(r.driver_outstanding,0) n_driver_balance,coalesce(r.payment_amount,0) n_amount,coalesce(r.billed_customer_net,r.customer_rate,0) n_company_rate,coalesce(r.received_from_company,0) n_received_company,greatest(coalesce(r.customer_outstanding_gross,r.remaining_with_company,0),0) n_remaining_company,greatest(coalesce(r.customer_credit_gross,0),0) n_customer_credit,coalesce(r.trip_profit,0) n_profit,coalesce(r.commission_paid_net,0) n_commission,jsonb_build_object('cells',case when needs_cells then jsonb_build_object(
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
'charge',coalesce(nullif((select string_agg(tc.code_snapshot,' + ' order by tc.sort_order,tc.id) from public.transport_trip_customer_charges tc where tc.trip_id=r.id),''),'?'),
'paper_received_by',coalesce(nullif(case when r.ppr_status='received' then coalesce(nullif(r.ppr_received_by_name,''),'—')||coalesce(' · '||to_char(r.ppr_received_date,'DD-Mon-YY'),'') else 'Pending' end,''),'?'),
'payment_date',coalesce(nullif(to_char(r.payment_date,'DD-Mon-YY'),''),'?'),
'invoice_no',coalesce(nullif(coalesce((select s.order_no from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders s on s.id=d.sales_order_id where cv and l.trip_id=r.id and not l.is_adjustment order by l.id limit 1),(select nullif(btrim(t.source_invoice_no),'') from public.transport_trips t where cv and t.id=r.id)),''),'?'),
'sale_type',coalesce(nullif(r.sale_type,''),'?'),
'rent_driver',to_char(coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0),'FM999,999,999,999,999,990.00'),
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
'rent_driver',coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0),
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
'commission',coalesce(r.commission_paid_net,0)) else '{}'::jsonb end) vals from (select fr.* from public.transport_financial_register fr where cv and sv and fr.company_id=c and fr.business_unit_id=b union all select masked.* from public.transport_financial_register fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,public._transport_mask_financial_row(to_jsonb(fr),cv,sv)) masked where not (cv and sv) and fr.company_id=c and fr.business_unit_id=b) r left join agreed_rents ar on ar.trip_id=r.id
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
   and (coalesce(btrim(p_filters->>'search'),'')='' or position(
     lower(replace(btrim(p_filters->>'search'),',',''))
     in lower(replace(concat_ws(' ',
       x.vals->'cells'->>'trip_no',x.vals->'cells'->>'trip_date',x.vals->'cells'->>'truck_type',
       x.vals->'cells'->>'job_no',x.vals->'cells'->>'invoiced',x.vals->'cells'->>'company',
       x.vals->'cells'->>'driver',x.vals->'cells'->>'owner',x.vals->'cells'->>'plate',
       x.vals->'cells'->>'from',x.vals->'cells'->>'to',x.vals->'cells'->>'charge',x.vals->'cells'->>'paper_received_by',
       x.vals->'cells'->>'rent_driver',x.vals->'cells'->>'supplier_paid',x.vals->'cells'->>'supplier_balance',
       x.vals->'cells'->>'supplier_credit',x.vals->'cells'->>'driver_pay',x.vals->'cells'->>'driver_paid',
       x.vals->'cells'->>'driver_balance',x.vals->'cells'->>'payment_date',x.vals->'cells'->>'amount',
       x.vals->'cells'->>'company_rate',x.vals->'cells'->>'received_company',x.vals->'cells'->>'remaining_company',
       x.vals->'cells'->>'customer_credit',x.vals->'cells'->>'profit',x.vals->'cells'->>'commission',
       x.vals->'cells'->>'invoice_no',x.vals->'cells'->>'sale_type',x.status,x.financial_status,x.ppr_status
     ),',',''))
   )>0)
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

notify pgrst,'reload schema';
commit;
