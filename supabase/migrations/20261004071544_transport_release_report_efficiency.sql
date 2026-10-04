begin;
-- Full-finance callers skip row serialization before filtering; restricted callers retain the same mask.
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
  select r.id,r.trip_date,r.payment_date,r.trip_no,coalesce(r.lifecycle_status,r.status) status,r.financial_status,r.ppr_status,r.customer_name,r.driver_name,r.vehicle_no,r.po_do_job_no,r.from_location,r.to_location,jsonb_build_object('cells',case when needs_cells then jsonb_build_object(
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
'commission',to_char(coalesce(r.commission_paid_net,0),'FM999,999,999,999,999,990.00')) else '{}'::jsonb end, 'numbers',jsonb_build_object(
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
'commission',coalesce(r.commission_paid_net,0))) vals from (select fr.* from public.transport_financial_register fr where cv and sv and fr.company_id=c and fr.business_unit_id=b union all select masked.* from public.transport_financial_register fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,public.transport_mask_financial_row(to_jsonb(fr))) masked where not (cv and sv) and fr.company_id=c and fr.business_unit_id=b) r
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
  select x.id,(x.vals->'numbers'->>'rent_driver')::numeric rent,row_number() over(order by case when p_direction='asc' and p_sort='trip_date' then x.trip_date end asc,
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
  select public.transport_mask_financial_row(to_jsonb(r))||jsonb_build_object('supplier_rent',chosen.rent,'invoice_no',coalesce(
   (select so.order_no from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders so on so.id=d.sales_order_id where cv and l.trip_id=r.id and not l.is_adjustment order by l.id limit 1),
   (select nullif(btrim(t.source_invoice_no),'') from public.transport_trips t where cv and t.id=r.id))) row,chosen.ordinal
  from chosen join (select fr.* from public.transport_financial_register fr where cv and sv and fr.company_id=c and fr.business_unit_id=b union all select masked.* from public.transport_financial_register fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,public.transport_mask_financial_row(to_jsonb(fr))) masked where not (cv and sv) and fr.company_id=c and fr.business_unit_id=b) r on r.id=chosen.id and r.company_id=c and r.business_unit_id=b
 ), sums as (select jsonb_build_object('rent_driver',coalesce(sum((x.vals->'numbers'->>'rent_driver')::numeric),0),'supplier_paid',coalesce(sum((x.vals->'numbers'->>'supplier_paid')::numeric),0),'supplier_balance',coalesce(sum((x.vals->'numbers'->>'supplier_balance')::numeric),0),'supplier_credit',coalesce(sum((x.vals->'numbers'->>'supplier_credit')::numeric),0),'driver_pay',coalesce(sum((x.vals->'numbers'->>'driver_pay')::numeric),0),'driver_paid',coalesce(sum((x.vals->'numbers'->>'driver_paid')::numeric),0),'driver_balance',coalesce(sum((x.vals->'numbers'->>'driver_balance')::numeric),0),'amount',coalesce(sum((x.vals->'numbers'->>'amount')::numeric),0),'company_rate',coalesce(sum((x.vals->'numbers'->>'company_rate')::numeric),0),'received_company',coalesce(sum((x.vals->'numbers'->>'received_company')::numeric),0),'remaining_company',coalesce(sum((x.vals->'numbers'->>'remaining_company')::numeric),0),'customer_credit',coalesce(sum((x.vals->'numbers'->>'customer_credit')::numeric),0),'profit',coalesce(sum((x.vals->'numbers'->>'profit')::numeric),0),'commission',coalesce(sum((x.vals->'numbers'->>'commission')::numeric),0)) totals from filtered x),
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
 answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public.transport_mask_financial_row(value)) from jsonb_array_elements(answer->'rows')),'[]'));
 answer:=jsonb_set(answer,'{totals}',public.transport_mask_financial_row(answer->'totals'));
 return answer||jsonb_build_object('permissions',jsonb_build_object('customer',cv,'supplier',sv));
end $function$
;


CREATE OR REPLACE FUNCTION public.transport_document_trip_detail_query(p_side text, p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if not public.transport_financial_read_allowed(p_side) then raise exception 'Transport financial side view permission required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view and active branch required';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>10000 then raise exception 'Invalid report filters';end if;
 if p_side is null or p_side not in ('customer','supplier') then raise exception 'Invalid document side';end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
 select src.order_id,src.order_no,t.id trip_id,t.trip_no,t.trip_date,t.from_location,t.to_location,t.po_do_job_no,
 a.vehicle_no_snapshot vehicle_no,a.driver_name_snapshot driver_name,case when public.transport_financial_read_allowed('supplier') then a.owner_name_snapshot end owner_name,
 coalesce(a.vehicle_no_snapshot,'Unattributed') attribution_vehicle
 from public.transport_party_document_sources src join public.transport_trips t on t.id=any(src.trip_ids)
 join public.journal_entries j on j.id=src.journal_entry_id
 left join lateral(select * from public.transport_trip_assignments a where a.trip_id=t.id and a.created_at<=j.created_at and a.effective_at<=j.created_at and (a.ended_at is null or j.created_at<a.ended_at) order by a.effective_at desc limit 1) a on true
 where src.company_id=c and src.business_unit_id=b and src.operating_location_id=loc and src.side=p_side
 and (nullif(p_filters->>'party','') is null or src.party_id=(p_filters->>'party')::uuid)
 and (nullif(p_filters->>'to','') is null or src.order_date<=(p_filters->>'to')::date)
 and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(concat_ws(' ',src.trip_no,src.order_no)))>0)
 order by src.order_id,t.id limit greatest(1,least(p_limit,1000)) offset greatest(p_offset,0)
 ) q;return answer;
end $function$
;


revoke all on function public.transport_document_trip_detail_query(text,jsonb,integer,integer) from public,anon;
grant execute on function public.transport_document_trip_detail_query(text,jsonb,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
