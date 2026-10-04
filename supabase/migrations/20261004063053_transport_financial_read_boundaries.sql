begin;

-- Explicit per-side FALSE wins; absent keys inherit canonical finance visibility.
create or replace function public.transport_financial_read_allowed(p_side text) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); k text; v jsonb;
begin
 if auth.uid() is null or c is null or b is null or p_side not in ('customer','supplier') or not public.has_module_permission(c,'transport','view') then return false;end if;
 if public.is_platform_owner() then return true;end if;
 k:=p_side||'_finance_view';
 select permissions#>array['transport_actions',k] into v from public.business_unit_memberships where company_id=c and business_unit_id=b and user_id=auth.uid() and is_active;
 if jsonb_typeof(v)='boolean' then return v::text::boolean;end if;
 select permissions#>array['transport_actions',k] into v from public.company_memberships where company_id=c and user_id=auth.uid() and is_active;
 if jsonb_typeof(v)='boolean' then return v::text::boolean;end if;
 return public.has_module_permission(c,case when p_side='customer' then 'sales' else 'purchase' end,'view') or public.has_module_permission(c,'accounting','view');
end $$;
revoke all on function public.transport_financial_read_allowed(text) from public,anon;
grant execute on function public.transport_financial_read_allowed(text) to authenticated;


create or replace function public.transport_mask_financial_row(p_row jsonb) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');keys text[]:=array['id','company_id','business_unit_id','trip_no','trip_date','status','lifecycle_status','trip_status','job_status','vehicle_id','driver_id','truck_type','truck_type_id','truck_type_name','vehicle_no','driver_name','from_location','to_location','from_location_id','to_location_id','po_do_job_no','service_period','notes','sale_type','ppr_status','ppr_received_by_employee_id','ppr_received_by_name','ppr_received_by','ppr_received_date','ppr_attachment_path','customer_id','customer_name','customer_name_snapshot','created_at','updated_at','created_by','updated_by']::text[];
begin
 if cv and sv then return coalesce(p_row,'{}');end if;
 if cv then keys:=keys||array['customer_rate','customer_rate_state','customer_rate_source','customer_rate_reference_id','customer_rate_snapshot','customer_rate_finalized_at','customer_rate_finalized_by','customer_rate_status','customer_rate_locked','billed_customer_net','received_from_company','remaining_with_company','customer_received_gross','customer_outstanding_gross','customer_credit_gross','sales_order_id','source_invoice_no','invoice_no','sale_type','invoiced','company_rate','received_company','remaining_company','customer_credit','customer_posted','revenue']::text[];end if;
 if sv then keys:=keys||array['owner_supplier_id','owner_name','owner_name_snapshot','ownership_id','ownership_class','rent_state','rent_finalized_at','rent_finalized_by','supplier_rent','supplier_rent_status','supplier_rate_locked','owner_rent','billed_supplier_net','supplier_paid_net','supplier_outstanding_gross','supplier_credit_gross','driver_accrued','driver_paid','driver_pay','driver_outstanding','fuel_cost','toll_cost','other_cost','other_cost_net','commission_paid_net','remaining_with_us','payment_date','payment_amount','rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_balance','amount','commission','agreed_supplier_rent','supplier_posted','rent','posted','legacyBlocked','party_id','rent_id']::text[];end if;
 return coalesce((select jsonb_object_agg(key,value) from jsonb_each(p_row) where key=any(keys)),'{}');
end $$;
revoke all on function public.transport_mask_financial_row(jsonb) from public,anon,authenticated;


drop policy if exists transport_financial_read_boundary on public.transport_trips;
create policy transport_financial_read_boundary on public.transport_trips as restrictive for select to authenticated using(public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier'));

drop policy if exists transport_financial_read_boundary on public.transport_trip_audit;
create policy transport_financial_read_boundary on public.transport_trip_audit as restrictive for select to authenticated using(public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier'));

drop policy if exists transport_financial_read_boundary on public.transport_financial_assignment_history;
create policy transport_financial_read_boundary on public.transport_financial_assignment_history as restrictive for select to authenticated using(public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier'));

drop policy if exists transport_financial_read_boundary on public.transport_customer_rates;
create policy transport_financial_read_boundary on public.transport_customer_rates as restrictive for select to authenticated using(public.transport_financial_read_allowed('customer'));

drop policy if exists transport_financial_read_boundary on public.transport_customer_documents;
create policy transport_financial_read_boundary on public.transport_customer_documents as restrictive for select to authenticated using(public.transport_financial_read_allowed('customer'));

drop policy if exists transport_financial_read_boundary on public.transport_customer_document_trips;
create policy transport_financial_read_boundary on public.transport_customer_document_trips as restrictive for select to authenticated using(public.transport_financial_read_allowed('customer'));

drop policy if exists transport_financial_read_boundary on public.transport_trip_supplier_rents;
create policy transport_financial_read_boundary on public.transport_trip_supplier_rents as restrictive for select to authenticated using(public.transport_financial_read_allowed('supplier'));

drop policy if exists transport_financial_read_boundary on public.transport_supplier_documents;
create policy transport_financial_read_boundary on public.transport_supplier_documents as restrictive for select to authenticated using(public.transport_financial_read_allowed('supplier'));

drop policy if exists transport_financial_read_boundary on public.transport_supplier_document_rents;
create policy transport_financial_read_boundary on public.transport_supplier_document_rents as restrictive for select to authenticated using(public.transport_financial_read_allowed('supplier'));

drop policy if exists transport_financial_read_boundary on public.transport_service_cost_links;
create policy transport_financial_read_boundary on public.transport_service_cost_links as restrictive for select to authenticated using(public.transport_financial_read_allowed('supplier'));

drop policy if exists transport_financial_read_boundary on public.transport_driver_accrual_attributions;
create policy transport_financial_read_boundary on public.transport_driver_accrual_attributions as restrictive for select to authenticated using(public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier'));

drop policy if exists transport_financial_read_boundary on public.transport_driver_payment_attributions;
create policy transport_financial_read_boundary on public.transport_driver_payment_attributions as restrictive for select to authenticated using(public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier'));

drop policy if exists transport_financial_read_boundary on public.transport_rate_adjustments;
create policy transport_financial_read_boundary on public.transport_rate_adjustments as restrictive for select to authenticated using(public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier'));

drop policy if exists transport_financial_read_boundary on public.transport_service_note_lines;
create policy transport_financial_read_boundary on public.transport_service_note_lines as restrictive for select to authenticated using(public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier'));

drop policy if exists transport_financial_read_boundary on public.transport_service_refunds;
create policy transport_financial_read_boundary on public.transport_service_refunds as restrictive for select to authenticated using(public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier'));

drop policy if exists transport_financial_read_boundary on public.transport_reversed_allocation_evidence;
create policy transport_financial_read_boundary on public.transport_reversed_allocation_evidence as restrictive for select to authenticated using(public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier'));

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
'commission',coalesce(r.commission_paid_net,0))) vals from (select masked.* from public.transport_financial_register fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,case when cv and sv then to_jsonb(fr) else public.transport_mask_financial_row(to_jsonb(fr)) end) masked where fr.company_id=c and fr.business_unit_id=b) r
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
  from chosen join (select masked.* from public.transport_financial_register fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,case when cv and sv then to_jsonb(fr) else public.transport_mask_financial_row(to_jsonb(fr)) end) masked where fr.company_id=c and fr.business_unit_id=b) r on r.id=chosen.id and r.company_id=c and r.business_unit_id=b
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

CREATE OR REPLACE FUNCTION public.transport_party_report_page(p_kind text, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view')
 then raise exception 'Transport view permission and active Company/Business Unit/branch required';end if;
 if p_kind='canonical' and not public.has_module_permission(c,'accounting','view') then raise exception 'Accounting view permission required';end if;
 if p_kind='documents' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select * from public.transport_party_documents where company_id=c and business_unit_id=b and operating_location_id=loc and public.transport_financial_read_allowed(side) order by side,order_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 elsif p_kind='movements' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select * from public.transport_party_movements where company_id=c and business_unit_id=b and operating_location_id=loc and public.transport_financial_read_allowed(side) order by event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 elsif p_kind='canonical' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select * from public.transport_canonical_party_movements where company_id=c and business_unit_id=b and operating_location_id=loc and public.transport_financial_read_allowed(side) order by event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 else raise exception 'Invalid report kind';end if;
 return answer;
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_document_trip_details(p_side text, p_order_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if not public.transport_financial_read_allowed(p_side) then raise exception 'Transport financial side view permission required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view and active branch required';end if;
 if p_side is null or p_side not in ('customer','supplier') then raise exception 'Invalid document side';end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
 select src.order_id,src.order_no,t.id trip_id,t.trip_no,t.trip_date,t.from_location,t.to_location,t.po_do_job_no,
 a.vehicle_no_snapshot vehicle_no,a.driver_name_snapshot driver_name,case when public.transport_financial_read_allowed('supplier') then a.owner_name_snapshot end owner_name,
 coalesce(a.vehicle_no_snapshot,'Unattributed') attribution_vehicle
 from public.transport_party_document_sources src join public.transport_trips t on t.id=any(src.trip_ids)
 join public.journal_entries j on j.id=src.journal_entry_id
 left join lateral(select * from public.transport_trip_assignments a where a.trip_id=t.id and a.created_at<=j.created_at and a.effective_at<=j.created_at and (a.ended_at is null or j.created_at<a.ended_at) order by a.effective_at desc limit 1) a on true
 where src.company_id=c and src.business_unit_id=b and src.operating_location_id=loc and src.side=p_side
 and (p_order_id is null or src.order_id=p_order_id)
 order by src.order_id,t.id limit greatest(1,least(p_limit,1000)) offset greatest(p_offset,0)
 ) q;return answer;
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_bulk_rate_page(p_side text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();answer jsonb;
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
 answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public.transport_mask_financial_row(value)) from jsonb_array_elements(answer->'rows')),'[]'));return answer;
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_trip_report(p_side text DEFAULT 'customer'::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();answer jsonb;
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
 from (select masked.* from public.transport_financial_register fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,public.transport_mask_financial_row(to_jsonb(fr))) masked where fr.company_id=c and fr.business_unit_id=b) r left join public.transport_vehicle_ownership o on o.id=r.ownership_id and o.company_id=c and o.business_unit_id=b
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
 answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public.transport_mask_financial_row(value)) from jsonb_array_elements(answer->'rows')),'[]'));answer:=jsonb_set(answer,'{summary}',public.transport_mask_financial_row(answer->'summary'));return answer;
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_financial_register_page(p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS SETOF transport_financial_register
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c uuid := public.current_company_id();
  b uuid := public.current_business_unit_id();
begin
 if not (public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')) then raise exception 'Both Transport financial view permissions required';end if;
  if c is null or b is null then
    raise exception 'Active company and business unit required';
  end if;
  if not public.has_module_permission(c,'transport','view') then
    raise exception 'Transport view permission required';
  end if;
  return query
    select r.*
    from public.transport_financial_register r
    where r.company_id=c and r.business_unit_id=b
    order by r.trip_date desc, r.trip_no desc
    limit greatest(1,least(coalesce(p_limit,1000),1000))
    offset greatest(coalesce(p_offset,0),0);
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_account_report_page(p_kind text, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if not (public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')) then raise exception 'Both Transport financial view permissions required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view')
 then raise exception 'Transport view permission and active Company/Business Unit/branch required';end if;
 if p_kind='driver' and not public.has_module_permission(c,'accounting','view') then raise exception 'Accounting view permission required for payroll detail';end if;
 if p_kind='driver' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select * from public.transport_driver_account_movements where company_id=c and business_unit_id=b and operating_location_id=loc order by event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 elsif p_kind='vehicle' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select * from public.transport_vehicle_account_movements where company_id=c and business_unit_id=b and operating_location_id=loc order by event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 elsif p_kind='contributions' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select * from public.transport_vehicle_contributions where company_id=c and business_unit_id=b and operating_location_id=loc and (category<>'Driver pay' or public.has_module_permission(c,'accounting','view')) order by event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 else raise exception 'Invalid account report kind';end if;
 return answer;
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_contribution_summary(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare answer jsonb;c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
begin
 if not (public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')) then raise exception 'Both Transport financial view permissions required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission required';end if;
 with sources as (
 select m.event_id,m.trip_ids[1] trip_id,m.event_date,m.company_id,m.business_unit_id,
 case when m.side='customer' then m.net_amount else 0 end revenue,
 case when m.side='supplier' then m.net_amount else 0 end cost
 from public.transport_party_movements m
 where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc and m.event_type in ('bill','credit_note','reversal_bill','reversal_credit_note')
 union all
 select m.event_id,m.trip_id,m.event_date,m.company_id,m.business_unit_id,0,m.amount
 from public.transport_driver_account_movements m where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc and m.event_type in ('salary_accrual','reversal_salary_accrual')
 ), attributed as (
 select src.*,v.account_id,o.owner_type from sources src
 left join public.transport_vehicle_contributions v on v.event_id=src.event_id and v.company_id=c and v.business_unit_id=b and v.operating_location_id=loc
 left join public.transport_trips t on t.id=src.trip_id and t.company_id=c and t.business_unit_id=b
 left join public.transport_vehicle_ownership o on o.vehicle_id=v.account_id and o.company_id=src.company_id and o.business_unit_id=src.business_unit_id
 and o.effective_from<=t.trip_date and (o.effective_to is null or t.trip_date<=o.effective_to)
 where (p_from is null or src.event_date>=p_from) and (p_to is null or src.event_date<=p_to)
 )
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
 select coalesce(owner_type,'unattributed') ownership,count(distinct case when account_id is not null then trip_id end) trips,
 sum(revenue) revenue,sum(cost) cost,sum(revenue-cost) profit
 from attributed group by coalesce(owner_type,'unattributed')
 ) q;return answer;
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_audit_page(p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_search text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();answer jsonb;
begin
 if not (public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')) then raise exception 'Both Transport financial view permissions required';end if;
 if auth.uid() is null or c is null or b is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active workspace required';end if;
 with filtered as materialized (
  select a.*,t.trip_no from public.transport_trip_audit a left join public.transport_trips t on t.id=a.trip_id and t.company_id=c and t.business_unit_id=b
  where a.company_id=c and a.business_unit_id=b
   and (coalesce(p_search,'')='' or position(lower(p_search) in lower(concat_ws(' ',t.trip_no,a.event_type,a.changed_by,a.new_data::text)))>0)
 ), page as (select * from filtered order by id desc limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'count',(select count(*) from filtered)) into answer;
 return answer;
end $function$
;

do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.transport_trip_audit_report(text,integer,integer)'::regprocedure);
 execute replace(definition,E'begin\n',E'begin\n if not (public.transport_financial_read_allowed(''customer'') and public.transport_financial_read_allowed(''supplier'')) then raise exception ''Both Transport financial view permissions required'';end if;\n');
end $$;


create or replace function public.transport_edit_trip_read(p_trip_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare t public.transport_trips; answer jsonb;
begin
 if not public.has_module_permission(public.current_company_id(),'transport','view') then raise exception 'Transport view permission required';end if;
 select * into t from public.transport_trips where id=p_trip_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id();
 if not found then raise exception 'Trip not found in workspace';end if;
 answer:=public.transport_mask_financial_row(to_jsonb(t));
 if public.transport_financial_read_allowed('supplier') then answer:=answer||jsonb_build_object('supplier_rent_total',(select sum(coalesce(finalized_amount_snapshot,amount)) from public.transport_trip_supplier_rents where trip_id=t.id));end if;
 return answer;
end $$;
create or replace function public.transport_update_operational_trip(p_trip_id uuid,p_changes jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips; replacement public.transport_trips; k text; allowed text[]:=array['trip_date','customer_id','customer_name_snapshot','truck_type_id','from_location','to_location','po_do_job_no','ppr_status','ppr_received_date','ppr_received_by_employee_id','ppr_attachment_path','sale_type','notes'];
begin
 if not public.has_module_permission(public.current_company_id(),'transport','edit') or not public.has_transport_action_permission(public.current_company_id(),'trip_edit') then raise exception 'Trip edit permission required';end if;
 if jsonb_typeof(p_changes) is distinct from 'object' or octet_length(p_changes::text)>20000 then raise exception 'Invalid Trip changes';end if;
 for k in select jsonb_object_keys(p_changes) loop if not k=any(allowed) then raise exception 'Unsupported operational field %',k;end if;end loop;
 select * into t from public.transport_trips where id=p_trip_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Trip not found in workspace';end if;
 replacement:=jsonb_populate_record(t,p_changes);
 update public.transport_trips set trip_date=replacement.trip_date,customer_id=replacement.customer_id,customer_name_snapshot=replacement.customer_name_snapshot,truck_type_id=replacement.truck_type_id,from_location=replacement.from_location,to_location=replacement.to_location,po_do_job_no=replacement.po_do_job_no,ppr_status=replacement.ppr_status,ppr_received_date=replacement.ppr_received_date,ppr_received_by_employee_id=replacement.ppr_received_by_employee_id,ppr_attachment_path=replacement.ppr_attachment_path,sale_type=replacement.sale_type,notes=replacement.notes where id=t.id;
 return t.id;
end $$;
revoke all on function public.transport_edit_trip_read(uuid),public.transport_update_operational_trip(uuid,jsonb) from public,anon;
grant execute on function public.transport_edit_trip_read(uuid),public.transport_update_operational_trip(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
