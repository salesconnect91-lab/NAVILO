-- Original imported Trip Nos are display labels; stored numbers, UUIDs and links stay unchanged.
CREATE FUNCTION public.transport_display_trip_no(p_trip_id uuid,p_fallback text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT coalesce((select nullif(h.source_trip_id,'') from public.transport_historical_trip_identity h where h.trip_id=p_trip_id),p_fallback);
$$;
REVOKE ALL ON FUNCTION public.transport_display_trip_no(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_display_trip_no(uuid,text) TO authenticated;

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
  select a.*,public.transport_display_trip_no(t.id,t.trip_no) AS trip_no from public.transport_trip_audit a left join public.transport_trips t on t.id=a.trip_id and t.company_id=c and t.business_unit_id=b
  where a.company_id=c and a.business_unit_id=b
   and (coalesce(p_search,'')='' or position(lower(p_search) in lower(concat_ws(' ',public.transport_display_trip_no(t.id,t.trip_no),a.event_type,a.changed_by,a.new_data::text)))>0)
 ), page as (select * from filtered order by id desc limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'count',(select count(*) from filtered)) into answer;
 return answer;
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_bulk_rate_page(p_side text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');
begin
 if (coalesce(p_filters->'columns','{}') ?| array['rate','rateStatus']) and not public.transport_financial_read_allowed('customer') then raise exception 'Customer financial view permission required';end if;
 if (coalesce(p_filters->'columns','{}') ?| array['rent','rentStatus','owner']) and not public.transport_financial_read_allowed('supplier') then raise exception 'Supplier financial view permission required';end if;
 if not public.transport_financial_read_allowed(p_side) then raise exception 'Transport financial side view permission required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active workspace required';end if;
 if p_side not in ('customer','supplier') or jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>100000 then raise exception 'Invalid bulk filters';end if;
 with base as materialized (
  select t.id,public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,t.trip_date,coalesce(t.lifecycle_status,t.status) trip_status,t.customer_id,coalesce(cu.name,t.customer_name_snapshot) customer_name,
   v.vehicle_no,dr.driver_name,t.from_location,t.to_location,t.po_do_job_no,t.sale_type,t.customer_rate,t.customer_rate_state,
   t.sales_order_id,t.owner_supplier_id,t.owner_name_snapshot,t.supplier_rent,t.owner_rent,t.rent_state,t.rent_finalized_at,
   (t.sales_order_id is not null or exists(select 1 from public.transport_customer_document_trips l where l.trip_id=t.id)) customer_rate_locked,
   case when p_side='customer' then (select r.billed_customer_net from public.transport_financial_register r where r.id=t.id) end billed_customer_net
  from public.transport_trips t left join public.customers cu on cu.id=t.customer_id
  left join public.transport_vehicles v on v.id=t.vehicle_id left join public.transport_drivers dr on dr.id=t.driver_id
  where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
   and (coalesce(p_filters->>'initialTrip','')='' or t.id::text=p_filters->>'initialTrip')
   and (coalesce(p_filters->>'status','')='' or t.status=p_filters->>'status')
   and (coalesce(p_filters->>'search','')='' or position(lower(btrim(p_filters->>'search')) in lower(concat_ws(' ',public.transport_display_trip_no(t.id,t.trip_no),t.po_do_job_no,cu.name,t.customer_name_snapshot,dr.driver_name,v.vehicle_no,t.from_location,t.to_location)))>0)
 ), lines as materialized (
  select to_jsonb(t)||jsonb_build_object('posted',t.customer_rate_locked) row,
   t.customer_id party,t.trip_date,public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,t.id::text key,
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
   'rent',case when r.id is not null then to_jsonb(r)||jsonb_build_object('trip_id',t.id,'amount',r.amount+a.difference,'finalized_amount_snapshot',r.amount+a.difference) end),
   coalesce(r.supplier_id,t.owner_supplier_id),t.trip_date,public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,coalesce(r.id::text,'new:'||t.id::text),
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
  select src.order_id,src.order_no,t.id trip_id,public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,t.trip_date,t.from_location,t.to_location,t.po_do_job_no,
   a.vehicle_no_snapshot vehicle_no,a.driver_name_snapshot driver_name,case when public.transport_financial_read_allowed('supplier') then a.owner_name_snapshot end owner_name,
   coalesce(a.vehicle_no_snapshot,'Unattributed') attribution_vehicle,
   coalesce(fin.base_amount,0) base_amount,coalesce(fin.charge_amount,0) charge_amount,coalesce(fin.tax_amount,0) tax_amount,coalesce(fin.total_amount,0) total_amount,
   coalesce(fin.charge_breakdown,'') charge_breakdown
  from public.transport_party_document_sources src join public.transport_trips t on t.id=any(src.trip_ids)
  join public.journal_entries j on j.id=src.journal_entry_id
  left join lateral(select * from public.transport_trip_assignments a where a.trip_id=t.id and a.created_at<=j.created_at and a.effective_at<=j.created_at and (a.ended_at is null or j.created_at<a.ended_at) order by a.effective_at desc limit 1) a on true
  left join lateral (
   select
    case when p_side='customer' then coalesce((select sum(sl.amount) from public.sales_service_lines sl where sl.order_id=src.order_id and sl.company_id=c and sl.business_unit_id=b),0)
         else coalesce((select sum(pl.amount) from public.purchase_service_lines pl where pl.order_id=src.order_id and pl.company_id=c and pl.business_unit_id=b),0) end base_amount,
    case when p_side='customer' then coalesce((select sum(ch.amount) from public.sales_order_charges ch where ch.order_id=src.order_id and ch.company_id=c and ch.business_unit_id=b),0)
         else coalesce((select sum(ch.amount) from public.purchase_order_charges ch where ch.order_id=src.order_id and ch.company_id=c and ch.business_unit_id=b),0) end charge_amount,
    case when p_side='customer' then coalesce((select sum(sl.amount*coalesce(sl.tax_percent,0)/100) from public.sales_service_lines sl where sl.order_id=src.order_id and sl.company_id=c and sl.business_unit_id=b),0)+coalesce((select sum(ch.amount*coalesce(ch.tax_percent,0)/100) from public.sales_order_charges ch where ch.order_id=src.order_id and ch.company_id=c and ch.business_unit_id=b),0)
         else coalesce((select sum(pl.amount*coalesce(pl.tax_percent,0)/100) from public.purchase_service_lines pl where pl.order_id=src.order_id and pl.company_id=c and pl.business_unit_id=b),0)+coalesce((select sum(ch.amount*coalesce(ch.tax_percent,0)/100) from public.purchase_order_charges ch where ch.order_id=src.order_id and ch.company_id=c and ch.business_unit_id=b),0) end tax_amount,
    case when p_side='customer' then coalesce((select so.total from public.sales_orders so where so.id=src.order_id and so.company_id=c and so.business_unit_id=b),0)
         else coalesce((select po.total from public.purchase_orders po where po.id=src.order_id and po.company_id=c and po.business_unit_id=b),0) end total_amount,
    case when p_side='customer' then coalesce((select string_agg(ch.charge_label||' '||to_char(ch.amount,'FM999,999,999,990.00'),' + ' order by ch.created_at,ch.id) from public.sales_order_charges ch where ch.order_id=src.order_id and ch.company_id=c and ch.business_unit_id=b),'')
         else coalesce((select string_agg(ch.charge_label||' '||to_char(ch.amount,'FM999,999,999,990.00'),' + ' order by ch.created_at,ch.id) from public.purchase_order_charges ch where ch.order_id=src.order_id and ch.company_id=c and ch.business_unit_id=b),'') end charge_breakdown
  ) fin on true
  where src.company_id=c and src.business_unit_id=b and src.operating_location_id=loc and src.side=p_side
   and (nullif(p_filters->>'party','') is null or src.party_id=(p_filters->>'party')::uuid)
   and (nullif(p_filters->>'to','') is null or src.order_date<=(p_filters->>'to')::date)
   and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(concat_ws(' ',src.trip_no,src.order_no)))>0)
  order by src.order_id,t.id limit greatest(1,least(p_limit,1000)) offset greatest(p_offset,0)
 ) q;return answer;
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
 select src.order_id,src.order_no,t.id trip_id,public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,t.trip_date,t.from_location,t.to_location,t.po_do_job_no,coalesce(nullif(btrim(t.truck_type),''),ty.name) truck_type,
 a.vehicle_no_snapshot vehicle_no,a.driver_name_snapshot driver_name,case when public.transport_financial_read_allowed('supplier') then a.owner_name_snapshot end owner_name,
 coalesce(a.vehicle_no_snapshot,'Unattributed') attribution_vehicle
 from public.transport_party_document_sources src join public.transport_trips t on t.id=any(src.trip_ids)
 join public.journal_entries j on j.id=src.journal_entry_id
 left join public.transport_truck_types ty on ty.id=t.truck_type_id and ty.company_id=c and ty.business_unit_id=b
 left join lateral(select * from public.transport_trip_assignments a where a.trip_id=t.id and a.created_at<=j.created_at and a.effective_at<=j.created_at and (a.ended_at is null or j.created_at<a.ended_at) order by a.effective_at desc limit 1) a on true
 where src.company_id=c and src.business_unit_id=b and src.operating_location_id=loc and src.side=p_side
 and (p_order_id is null or src.order_id=p_order_id)
 order by src.order_id,t.id limit greatest(1,least(p_limit,1000)) offset greatest(p_offset,0)
 ) q;return answer;
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_driver_month_detail(p_employee_id uuid, p_month date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();m date:=date_trunc('month',p_month)::date;ans jsonb; begin if auth.uid() is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission required';end if; perform public.transport_assert_company_employee_driver(p_employee_id); select coalesce(jsonb_agg(to_jsonb(x) order by x.event_date,x.trip_no,x.kind),'[]') into ans from (select t.trip_date event_date,public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,'trip_pay'::text kind,coalesce(t.driver_pay,0)::numeric amount,null::text note,t.id trip_id from public.transport_trips t join public.transport_drivers d on d.id=t.driver_id and d.employee_id=p_employee_id and d.company_id=c and d.business_unit_id=b and lower(coalesce(d.driver_type,''))='company' and d.supplier_id is null where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc and t.trip_date>=m and t.trip_date<(m+interval '1 month')::date union all select coalesce(t.trip_date,a.month),public.transport_display_trip_no(t.id,t.trip_no),a.kind,a.amount,a.note,a.trip_id from public.transport_driver_month_adjustments a left join public.transport_trips t on t.id=a.trip_id where a.company_id=c and a.business_unit_id=b and a.operating_location_id=loc and a.employee_id=p_employee_id and a.month=m) x; return ans; end $function$
;

CREATE OR REPLACE FUNCTION public.transport_edit_trip_read(p_trip_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.transport_trips%rowtype;answer jsonb;cnt int;rid uuid;rent_total numeric;rent_base numeric;
begin
 if not public.has_module_permission(public.current_company_id(),'transport','view') then raise exception 'Transport view permission required';end if;
 select * into t from public.transport_trips where id=p_trip_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id();
 if not found then raise exception 'Trip not found in workspace';end if;
 answer:=public.transport_mask_financial_row(to_jsonb(t)||jsonb_build_object('trip_no',public.transport_display_trip_no(t.id,t.trip_no),'internal_trip_no',t.trip_no));
 if public.transport_financial_read_allowed('customer') then
  answer:=answer||jsonb_build_object('customer_charges_total',
   (select coalesce(sum(amount),0) from public.transport_trip_customer_charges where trip_id=t.id));
 end if;
 if public.transport_financial_read_allowed('supplier') then
  select count(*), (array_agg(id))[1],sum(coalesce(finalized_amount_snapshot,amount)) into cnt,rid,rent_total
  from public.transport_trip_supplier_rents where trip_id=t.id;
  answer:=answer||jsonb_build_object('supplier_rent_total',rent_total,'supplier_rent_count',cnt);
  if cnt=1 then
   select coalesce(r.base_amount,greatest(0,r.amount-coalesce((select sum(amount) from public.transport_trip_supplier_charges where rent_id=rid),0)))
   into rent_base from public.transport_trip_supplier_rents r where r.id=rid;
   answer:=answer||jsonb_build_object('supplier_rent_id',rid,'supplier_base_rate',rent_base,'supplier_charges_total',
   (select coalesce(sum(amount),0) from public.transport_trip_supplier_charges where rent_id=rid));
  end if;
 end if;
 return answer;
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_register_query(p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT ''::text, p_direction text DEFAULT 'asc'::text, p_option_key text DEFAULT NULL::text, p_option_search text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;needs_cells boolean;cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view')
 then raise exception 'Transport view permission and active Company/Business Unit required';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>100000 then raise exception 'Invalid filters';end if;
 if (p_option_key=any(array['company_rate','received_company','remaining_company','customer_credit','invoice_no','sale_type','invoiced']) or p_sort=any(array['company_rate','received_company','remaining_company','customer_credit','invoice_no','sale_type','invoiced']) or (coalesce(p_filters->'columns','{}') ?| array['company_rate','received_company','remaining_company','customer_credit','invoice_no','sale_type','invoiced'])) and not cv then raise exception 'Customer financial view permission required';end if;
 if (p_option_key=any(array['rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_pay','driver_paid','driver_balance','payment_date','amount','commission','owner','supplier_invoice_no']) or p_sort=any(array['rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_pay','driver_paid','driver_balance','payment_date','amount','commission','owner','supplier_invoice_no']) or (coalesce(p_filters->'columns','{}') ?| array['rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_pay','driver_paid','driver_balance','payment_date','amount','commission','owner','supplier_invoice_no'])) and not sv then raise exception 'Supplier financial view permission required';end if;
 if (p_sort='profit' or p_option_key='profit' or coalesce(p_filters->'columns','{}') ? 'profit') and not (cv and sv) then raise exception 'Both financial view permissions required';end if;
 if p_filters->>'snapshot'='true' and not public.has_module_permission(c,'transport','export') then raise exception 'Transport export permission required';end if;
 -- Unposted operational filter values must not require the expensive
 -- correlated financial/register view. All financial filters, status filters
 -- and full text searches keep the original authoritative path.
 if p_option_key=any(array['trip_no','trip_date','truck_type','job_no','company','driver','plate','from','to','paper_received_by'])
    and btrim(coalesce(p_filters->>'search',''))=''
    and coalesce(jsonb_array_length(p_filters->'statuses'),0)=0
    and not exists(
      select 1 from jsonb_each(coalesce(p_filters->'columns','{}'::jsonb)) f
      where f.key not in ('trip_no','trip_date','truck_type','job_no','company','driver','plate','from','to','paper_received_by')
      and jsonb_array_length(f.value)>0
    )
 then
   with operational as (
     select
      t.trip_date,t.ppr_status,t.from_location,t.to_location,
      coalesce(cu.name,t.customer_name_snapshot) customer_name,
      coalesce(dr.driver_name,hi.driver_name_snapshot) driver_name,
      coalesce(v.vehicle_no,hi.vehicle_no_snapshot) vehicle_no,
      jsonb_build_object(
        'trip_no',coalesce(nullif(coalesce(hi.source_trip_id,t.transport_source_trip_id,t.trip_no),''),'?'),
        'trip_date',coalesce(nullif(to_char(t.trip_date,'DD-Mon-YY'),''),'?'),
        'truck_type',coalesce(nullif(coalesce(tt.name,t.truck_type,v.truck_type),''),'?'),
        'job_no',coalesce(nullif(t.po_do_job_no,''),'?'),
        'company',coalesce(nullif(coalesce(cu.name,t.customer_name_snapshot),''),'?'),
        'driver',coalesce(nullif(coalesce(dr.driver_name,hi.driver_name_snapshot),''),'?'),
        'plate',coalesce(nullif(coalesce(v.vehicle_no,hi.vehicle_no_snapshot),''),'?'),
        'from',coalesce(nullif(t.from_location,''),'?'),
        'to',coalesce(nullif(t.to_location,''),'?'),
        'paper_received_by',coalesce(nullif(case when t.ppr_status='received'
          then coalesce(nullif(t.ppr_received_by_name,''),'—')
            ||coalesce(' · '||to_char(t.ppr_received_date,'DD-Mon-YY'),'')
          else 'Pending' end,''),'?')
      ) cells
     from public.transport_trips t
     left join public.customers cu on cu.id=t.customer_id
     left join public.transport_vehicles v on v.id=t.vehicle_id
     left join public.transport_drivers dr on dr.id=t.driver_id
     left join public.transport_truck_types tt on tt.id=t.truck_type_id
     left join public.transport_historical_trip_identity hi on hi.trip_id=t.id
          and hi.company_id=t.company_id and hi.business_unit_id=t.business_unit_id
          and hi.operating_location_id=t.operating_location_id
     where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
       and (coalesce(p_filters->>'fromDate','')='' or t.trip_date>=(p_filters->>'fromDate')::date)
       and (coalesce(p_filters->>'toDate','')='' or t.trip_date<=(p_filters->>'toDate')::date)
   ),
   matched as (
      select o.cells->>p_option_key value
      from operational o
      where (coalesce(p_filters->>'customer','')='' or o.customer_name=p_filters->>'customer')
        and (coalesce(p_filters->>'driver','')='' or o.driver_name=p_filters->>'driver')
        and (coalesce(p_filters->>'vehicle','')='' or o.vehicle_no=p_filters->>'vehicle')
        and (coalesce(p_filters->>'from','')='' or o.from_location=p_filters->>'from')
        and (coalesce(p_filters->>'to','')='' or o.to_location=p_filters->>'to')
        and (coalesce(p_filters->>'ppr','')='' or o.ppr_status=p_filters->>'ppr')
        and not exists(
         select 1 from jsonb_each(coalesce(p_filters->'columns','{}'::jsonb)) f
         where f.key is distinct from p_option_key and jsonb_array_length(f.value)>0
           and not f.value @> jsonb_build_array(o.cells->>f.key)
        )
        and position(lower(btrim(coalesce(p_option_search,''))) in lower(o.cells->>p_option_key))>0
   )
   select jsonb_build_object('options',coalesce(jsonb_agg(value order by value),'[]'::jsonb))
   into answer from (select distinct value from matched) v;
   return answer;
 end if;

 -- A wholly unlinked, unposted workspace needs operational aggregates for all
 -- Trips, and matching operational details only for the selected page. Any
 -- financial link, charge, search/filter or export keeps the existing path.
 if cv and sv and p_option_key is null and coalesce(p_sort,'') in ('','trip_date')
 and coalesce(p_filters->>'snapshot','false')<>'true'
 and btrim(coalesce(p_filters->>'search',''))=''
 and coalesce(jsonb_array_length(p_filters->'statuses'),0)=0
 and not exists(select 1 from jsonb_each(coalesce(p_filters->'columns','{}')) x where jsonb_array_length(x.value)>0)
 and not exists(select 1 from jsonb_each_text(p_filters) x where x.key in ('fromDate','toDate','customer','driver','vehicle','from','to','ppr') and coalesce(x.value,'')<>'')
 and not exists(select 1 from public.transport_trips t where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc and t.sales_order_id is not null)
 and not exists(select 1 from public.transport_customer_document_trips x where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc)
 and not exists(select 1 from public.transport_supplier_document_rents x where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc)
 and not exists(select 1 from public.transport_driver_accrual_attributions x where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc)
 and not exists(select 1 from public.transport_driver_payment_attributions x where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc)
 and not exists(select 1 from public.transport_service_cost_links x where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc)
 and not exists(select 1 from public.transport_trip_customer_charges x where x.company_id=c and x.business_unit_id=b)
 and not exists(select 1 from public.transport_trip_supplier_charges x where x.company_id=c and x.business_unit_id=b)
 then
  with agreed as materialized (
    select trip_id,count(*) n,bool_and(state='finalized') finalized,sum(coalesce(finalized_amount_snapshot,amount)) amount
    from public.transport_trip_supplier_rents where company_id=c and business_unit_id=b group by trip_id
  ), base as materialized (
    select t.id,coalesce(nullif(hm.raw_source->>0,''),nullif(t.transport_source_trip_id,''),t.trip_no) AS trip_no,t.trip_date,t.ppr_status,
      case when (cv and coalesce(t.customer_rate_state,'pending')='finalized')
        and case when coalesce(a.n,0)>0 then coalesce(a.finalized,false) else sv and coalesce(t.rent_state,'pending')='finalized' end then 'complete'
      when (cv and coalesce(t.customer_rate_state,'pending')='finalized')
        or case when coalesce(a.n,0)>0 then coalesce(a.finalized,false) else sv and coalesce(t.rent_state,'pending')='finalized' end then 'incomplete'
      else 'draft' end status,
      case when cv then coalesce(t.customer_rate,0) else 0 end rate,
      case when sv then coalesce(a.amount,t.supplier_rent,t.owner_rent,0)+coalesce(hm.company_cost_net,0) else 0 end rent,
      case when sv then greatest(coalesce(t.driver_pay,0),0) else 0 end driver_agreed,
      coalesce(hp.received_gross,0) historical_received,coalesce(hp.paid_gross,0) historical_paid,
      coalesce((hm.raw_source->>25)::numeric,0) historical_customer_remaining,
      coalesce((hm.raw_source->>18)::numeric,0) historical_supplier_remaining
    from public.transport_trips t left join agreed a on a.trip_id=t.id
    left join public.transport_historical_operational_mapping hm on hm.trip_id=t.id
      and hm.company_id=t.company_id and hm.business_unit_id=t.business_unit_id and hm.operating_location_id=t.operating_location_id
    left join public.transport_historical_payment_snapshots hp on hp.trip_id=t.id and hp.company_id=t.company_id and hp.business_unit_id=t.business_unit_id and hp.operating_location_id=t.operating_location_id
    where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
  ), selected as materialized (
    select x.*,row_number() over(order by case when p_sort='trip_date' and p_direction='asc' then x.trip_date end asc,
      case when p_sort='trip_date' and p_direction='desc' then x.trip_date end desc,x.trip_date desc,x.trip_no desc,x.id) ordinal
    from base x order by case when p_sort='trip_date' and p_direction='asc' then x.trip_date end asc,
      case when p_sort='trip_date' and p_direction='desc' then x.trip_date end desc,x.trip_date desc,x.trip_no desc,x.id
    limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0)
  ), page as (
    select case when cv and sv then to_jsonb(fr) else public._transport_mask_financial_row(to_jsonb(fr),cv,sv) end
      ||jsonb_build_object('status',x.status,'customer_charges',0,'supplier_rent',x.rent,'supplier_charges',0,
        'trip_profit',x.rate-x.rent-x.driver_agreed,
        'invoice_no',case when cv then nullif(fr.historical_customer_invoice_ref,'') end,
        'supplier_invoice_no',case when sv then nullif(fr.historical_supplier_invoice_ref,'') end) item,x.ordinal
    from selected x join lateral (
      select (jsonb_populate_record(null::public.transport_financial_register,
        to_jsonb(t)||jsonb_build_object(
          'trip_no',x.trip_no,
          'customer_name',coalesce(cu.name,t.customer_name_snapshot),
          'vehicle_no',case when hm.vehicle_master_id is not distinct from t.vehicle_id then coalesce(hi.vehicle_no_snapshot,v.vehicle_no) else coalesce(v.vehicle_no,hi.vehicle_no_snapshot) end,
          'truck_type_name',coalesce(tt.name,t.truck_type,v.truck_type),
          'driver_name',case when hm.driver_master_id is not distinct from t.driver_id then coalesce(hi.driver_name_snapshot,d.driver_name) else coalesce(d.driver_name,hi.driver_name_snapshot) end,
          'owner_name',coalesce(t.owner_name_snapshot,v.owner_name,s.name,hi.owner_name_snapshot),
          'financial_status',case when t.trip_status='cancelled' then 'Cancelled' when t.trip_status='draft' then 'Draft'
            when t.customer_rate>0 and (t.owner_rent>0 or exists(select 1 from agreed a where a.trip_id=t.id)) then 'Complete' else 'Not Complete' end,
          'invoiced',false,'customer_rate_locked',false,'supplier_rate_locked',false,
          'billed_customer_net',null,'received_from_company',x.historical_received,'remaining_with_company',x.historical_customer_remaining,
          'customer_received_gross',x.historical_received,'customer_outstanding_gross',greatest(x.historical_customer_remaining,0),'customer_credit_gross',greatest(-x.historical_customer_remaining,0),
          'billed_supplier_net',null,'supplier_paid_net',x.historical_paid,'supplier_outstanding_gross',greatest(x.historical_supplier_remaining,0),'supplier_credit_gross',greatest(-x.historical_supplier_remaining,0),
          'driver_accrued',null,'driver_paid',0,'driver_outstanding',greatest(coalesce(t.driver_pay,0),0),
          'remaining_with_us',x.historical_supplier_remaining,'payment_date',(select hp.payment_date from public.transport_historical_payment_snapshots hp where hp.trip_id=t.id and hp.company_id=t.company_id and hp.business_unit_id=t.business_unit_id and hp.operating_location_id=t.operating_location_id),'payment_amount',x.historical_paid,'trip_profit',null,
          'commission_paid_net',0,'other_cost_net',0,
          'historical_customer_invoice_ref',hm.customer_invoice_ref,'historical_supplier_invoice_ref',hm.supplier_invoice_ref,
          'historical_company_owned',hm.company_owned,'historical_company_cost_net',hm.company_cost_net,'historical_paper_status',hm.paper_status
        ))).* from public.transport_trips t
        left join public.customers cu on cu.id=t.customer_id
        left join public.transport_vehicles v on v.id=t.vehicle_id
        left join public.transport_truck_types tt on tt.id=t.truck_type_id
        left join public.transport_drivers d on d.id=t.driver_id
        left join public.suppliers s on s.id=v.supplier_id
        left join public.transport_historical_trip_identity hi on hi.trip_id=t.id and hi.company_id=t.company_id and hi.business_unit_id=t.business_unit_id and hi.operating_location_id=t.operating_location_id
        left join public.transport_historical_operational_mapping hm on hm.trip_id=t.id and hm.company_id=t.company_id and hm.business_unit_id=t.business_unit_id and hm.operating_location_id=t.operating_location_id
        where t.id=x.id and t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
    ) fr on true
  ), agg as (
    select count(*) n,count(*) filter(where status='complete') completed,
      count(*) filter(where ppr_status='received') received,count(*) filter(where ppr_status is distinct from 'received') pending,
      count(*) filter(where historical_received>0) collected,count(*) filter(where historical_paid>0) paid,
      jsonb_build_object('charge',0,'rent_driver',coalesce(sum(rent),0),'supplier_charges',0,'supplier_paid',coalesce(sum(historical_paid),0),'supplier_balance',coalesce(sum(greatest(historical_supplier_remaining,0)),0),
        'supplier_credit',coalesce(sum(greatest(-historical_supplier_remaining,0)),0),'driver_pay',coalesce(sum(driver_agreed),0),'driver_paid',0,'driver_balance',coalesce(sum(driver_agreed),0),'amount',coalesce(sum(historical_paid),0),
        'company_rate',coalesce(sum(rate),0),'received_company',coalesce(sum(historical_received),0),'remaining_company',coalesce(sum(greatest(historical_customer_remaining,0)),0),'customer_credit',coalesce(sum(greatest(-historical_customer_remaining,0)),0),
        'profit',coalesce(sum(rate-rent-driver_agreed),0),'commission',0) totals from base
  ), statuses as (
    select v.key,v.label,v.narration,v.sort_order,count(x.id) count from (values
      ('status:draft','Draft','No customer or supplier rate has been finalized yet.',1),
      ('status:incomplete','Incomplete','Only one of Customer Rate or Supplier Rent is finalized; the other side is still pending.',2),
      ('status:complete','Complete','Customer Rate and Supplier Rent are both finalized, but both financial sides are not yet posted.',3),
      ('status:locked','Locked','Customer billing and every required Supplier Rent are posted. Normal Trip/commercial editing is locked.',4),
      ('status:settled','Settled','Both sides are posted and Customer/Supplier outstanding balances are fully settled.',5)
    ) v(key,label,narration,sort_order) left join base x on 'status:'||x.status=v.key group by v.key,v.label,v.narration,v.sort_order
  ) select jsonb_build_object('snapshot',null,'rows',coalesce((select jsonb_agg(item order by ordinal) from page),'[]'),
    'count',a.n,'completed',a.completed,'paper_pending',a.pending,
    'summary',jsonb_build_object('paper',jsonb_build_object('received',a.received,'not_received',a.pending),
      'collections',case when cv then jsonb_build_object('received',a.collected,'not_received',a.n-a.collected) end,
      'payment',case when sv then jsonb_build_object('paid',a.paid,'not_paid',a.n-a.paid) end),
    'statuses',coalesce((select jsonb_agg(to_jsonb(statuses)-'sort_order' order by sort_order) from statuses),'[]'),'totals',a.totals)
    into answer from agg a;
  if not (cv and sv) then
    answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public._transport_mask_financial_row(value,cv,sv)) from jsonb_array_elements(answer->'rows')),'[]'));
    answer:=jsonb_set(answer,'{totals}',public._transport_mask_financial_row(answer->'totals',cv,sv));
  end if;
  return answer||jsonb_build_object('permissions',jsonb_build_object('customer',cv,'supplier',sv));
 end if;
 needs_cells:=p_filters->>'snapshot'='true' or p_option_key is not null or (coalesce(p_sort,'')<>'' and p_sort not in ('trip_date','payment_date')) or coalesce(p_filters->>'search','')<>'' or exists(select 1 from jsonb_each(coalesce(p_filters->'columns','{}')) f where jsonb_array_length(f.value)>0);
 with agreed_rents as materialized (
  select trip_id,sum(coalesce(finalized_amount_snapshot,amount)) amount
  from public.transport_trip_supplier_rents
  where company_id=c and business_unit_id=b group by trip_id
 ),
 customer_charge_agg as materialized (
  select trip_id,sum(amount) amount
  from public.transport_trip_customer_charges
  where company_id=c and business_unit_id=b group by trip_id
 ),
 supplier_charge_agg as materialized (
  select trip_id,sum(amount) amount,
         string_agg(charge_key_snapshot,' + ' order by sort_order,id) charge_names
  from public.transport_trip_supplier_charges
  where company_id=c and business_unit_id=b group by trip_id
 ),
 customer_invoice_agg as materialized (
  select distinct on (l.trip_id) l.trip_id,s.order_no
  from public.transport_customer_document_trips l
  join public.transport_customer_documents d on d.id=l.document_id
  join public.sales_orders s on s.id=d.sales_order_id
  where cv and not l.is_adjustment
  order by l.trip_id,l.id
 ),
 supplier_invoice_agg as materialized (
  select r.trip_id,
         string_agg(distinct p.order_no, ', ' order by p.order_no) order_nos
  from public.transport_trip_supplier_rents r
  join public.transport_supplier_document_rents l on l.rent_id=r.id and not l.is_adjustment
  join public.transport_supplier_documents d on d.id=l.document_id
  join public.purchase_orders p on p.id=d.purchase_order_id
  join public.transport_active_journals j on j.id=d.journal_entry_id
  where sv and r.company_id=c and r.business_unit_id=b
  group by r.trip_id
 ),
 supplier_status_agg as materialized (
  select r.trip_id,
         count(*) rent_count,
         bool_and(r.state='finalized') all_finalized,
         bool_and(exists(
           select 1
           from public.transport_supplier_document_rents l
           join public.transport_supplier_documents d on d.id=l.document_id
           join public.transport_active_journals j on j.id=d.journal_entry_id
           where l.rent_id=r.id and not l.is_adjustment
         )) all_posted
  from public.transport_trip_supplier_rents r
  where r.company_id=c and r.business_unit_id=b
  group by r.trip_id
 ), scoped as materialized (
  select r.id,r.trip_date,r.payment_date,r.trip_no,r full_row,
  case
   when coalesce(r.customer_rate_locked,false)
    and ((coalesce(r.owner_rent,0)>0 or coalesce(ssa.rent_count,0)>0) and coalesce(r.supplier_rate_locked,false) and case when coalesce(ssa.rent_count,0)>0 then coalesce(ssa.all_posted,false) else true end)
    and coalesce(r.customer_outstanding_gross,0)<=0.005 and coalesce(r.supplier_outstanding_gross,0)<=0.005 then 'settled'
   when coalesce(r.customer_rate_locked,false)
    and ((coalesce(r.owner_rent,0)>0 or coalesce(ssa.rent_count,0)>0) and coalesce(r.supplier_rate_locked,false) and case when coalesce(ssa.rent_count,0)>0 then coalesce(ssa.all_posted,false) else true end) then 'locked'
   when coalesce(r.customer_rate_state,'pending')='finalized'
    and case when coalesce(ssa.rent_count,0)>0 then coalesce(ssa.all_finalized,false) else coalesce(r.rent_state,'pending')='finalized' end then 'complete'
   when coalesce(r.customer_rate_state,'pending')='finalized'
    or case when coalesce(ssa.rent_count,0)>0 then coalesce(ssa.all_finalized,false) else coalesce(r.rent_state,'pending')='finalized' end then 'incomplete'
   else 'draft'
  end status,
  r.financial_status,r.ppr_status,r.customer_name,r.driver_name,r.vehicle_no,r.po_do_job_no,r.from_location,r.to_location,case when cv then coalesce(cca.amount,0) else 0 end n_customer_charges,(coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end) n_rent_driver,case when sv then coalesce(sca.amount,0) else 0 end n_supplier_charges,coalesce(r.supplier_paid_net,0) n_supplier_paid,greatest(coalesce(r.supplier_outstanding_gross,r.remaining_with_us,0),0) n_supplier_balance,greatest(coalesce(r.supplier_credit_gross,0),0) n_supplier_credit,coalesce(r.driver_accrued,r.driver_pay,0) n_driver_pay,coalesce(r.driver_paid,0) n_driver_paid,coalesce(r.driver_outstanding,0) n_driver_balance,coalesce(r.payment_amount,0) n_amount,coalesce(r.billed_customer_net,r.customer_rate,0) n_company_rate,coalesce(r.received_from_company,0) n_received_company,greatest(coalesce(r.customer_outstanding_gross,r.remaining_with_company,0),0) n_remaining_company,greatest(coalesce(r.customer_credit_gross,0),0) n_customer_credit,(coalesce(r.billed_customer_net,r.customer_rate,0)
 - (coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end)
 - greatest(coalesce(r.driver_pay,0),coalesce(r.driver_accrued,0))
 - coalesce(r.other_cost_net,0)) n_profit,coalesce(r.commission_paid_net,0) n_commission,case when cv then coalesce(cia.order_no,r.historical_customer_invoice_ref) end invoice_no_raw,case when sv then coalesce(sia.order_nos,r.historical_supplier_invoice_ref) end supplier_invoice_no_raw,jsonb_build_object('cells',case when needs_cells then jsonb_build_object(
'trip_no',coalesce(nullif(r.trip_no,''),'?'),
'source_trip_id',coalesce(nullif((select bt.transport_source_trip_id from public.transport_trips bt where bt.id=r.id),''),nullif(substring(r.notes from 'Legacy CSV Trip ([0-9]+)'),''),'?'),
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
'charge',to_char(case when cv then coalesce(cca.amount,0) else 0 end,'FM999,999,999,999,999,990.00'),
'supplier_charge',case when sv then coalesce(nullif(sca.charge_names,''),'?') else '?' end,
'paper_received_by',coalesce(nullif(case when r.ppr_status='received' then coalesce(nullif(r.ppr_received_by_name,''),'—')||coalesce(' · '||to_char(r.ppr_received_date,'DD-Mon-YY'),'') else 'Pending' end,''),'?'),
'payment_date',coalesce(nullif(to_char(r.payment_date,'DD-Mon-YY'),''),'?'),
'invoice_no',coalesce(nullif(case when cv then coalesce(cia.order_no,r.historical_customer_invoice_ref) end,''),'?'),
'supplier_invoice_no',coalesce(nullif(case when sv then coalesce(sia.order_nos,r.historical_supplier_invoice_ref) end,''),'?'),
'sale_type',coalesce(nullif(r.sale_type,''),'?'),
'rent_driver',to_char((coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end),'FM999,999,999,999,999,990.00'),
'supplier_charges',to_char(case when sv then coalesce(sca.amount,0) else 0 end,'FM999,999,999,999,999,990.00'),
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
'profit',to_char((coalesce(r.billed_customer_net,r.customer_rate,0)
 - (coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end)
 - greatest(coalesce(r.driver_pay,0),coalesce(r.driver_accrued,0))
 - coalesce(r.other_cost_net,0)),'FM999,999,999,999,999,990.00'),
'commission',to_char(coalesce(r.commission_paid_net,0),'FM999,999,999,999,999,990.00')) else '{}'::jsonb end, 'numbers',case when needs_cells then jsonb_build_object(
'charge',case when cv then coalesce(cca.amount,0) else 0 end,
'rent_driver',(coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end),
'supplier_charges',case when sv then coalesce(sca.amount,0) else 0 end,
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
'profit',(coalesce(r.billed_customer_net,r.customer_rate,0)
 - (coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end)
 - greatest(coalesce(r.driver_pay,0),coalesce(r.driver_accrued,0))
 - coalesce(r.other_cost_net,0)),
'commission',coalesce(r.commission_paid_net,0)) || case when r.trip_no ~ '^[0-9]+$' then jsonb_build_object('trip_no',r.trip_no::numeric) else '{}'::jsonb end else '{}'::jsonb end) vals from (select fr.* from public.transport_financial_register fr where cv and sv and fr.company_id=c and fr.business_unit_id=b and exists(select 1 from public.transport_trips bt where bt.id=fr.id and bt.operating_location_id=loc) union all select masked.* from public.transport_financial_register fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,public._transport_mask_financial_row(to_jsonb(fr),cv,sv)) masked where not (cv and sv) and fr.company_id=c and fr.business_unit_id=b and exists(select 1 from public.transport_trips bt where bt.id=fr.id and bt.operating_location_id=loc)) r left join agreed_rents ar on ar.trip_id=r.id
    left join customer_charge_agg cca on cca.trip_id=r.id
    left join supplier_charge_agg sca on sca.trip_id=r.id
    left join customer_invoice_agg cia on cia.trip_id=r.id
    left join supplier_invoice_agg sia on sia.trip_id=r.id
    left join supplier_status_agg ssa on ssa.trip_id=r.id
  where r.company_id=c and r.business_unit_id=b
   and (coalesce(p_filters->>'fromDate','')='' or r.trip_date>=(p_filters->>'fromDate')::date)
   and (coalesce(p_filters->>'toDate','')='' or r.trip_date<=(p_filters->>'toDate')::date)
   and (coalesce(p_filters->>'customer','')='' or r.customer_name=p_filters->>'customer')
   and (coalesce(p_filters->>'driver','')='' or r.driver_name=p_filters->>'driver')
   and (coalesce(p_filters->>'vehicle','')='' or r.vehicle_no=p_filters->>'vehicle')
   and (coalesce(p_filters->>'from','')='' or r.from_location=p_filters->>'from')
   and (coalesce(p_filters->>'to','')='' or r.to_location=p_filters->>'to')
   and (coalesce(p_filters->>'ppr','')='' or r.ppr_status=p_filters->>'ppr')
 ), filtered_without_status as materialized (
  select * from scoped x where
   (coalesce(btrim(p_filters->>'search'),'')='' or case when p_filters->>'searchMode'='starts_with' then
     exists (
       select 1 from jsonb_each_text(x.vals->'cells'||jsonb_build_object('status',x.status,'ppr_status',x.ppr_status)) cell
       cross join lateral (
         select lower(replace(btrim(cell.value),',','')) value
         union all
         select word from regexp_split_to_table(lower(replace(btrim(cell.value),',','')), '[[:space:]]+') word
       ) candidate
       where left(candidate.value,length(lower(replace(btrim(p_filters->>'search'),',',''))))=lower(replace(btrim(p_filters->>'search'),',',''))
     )
     else position(
     lower(replace(btrim(p_filters->>'search'),',',''))
     in lower(replace(concat_ws(' ',
       x.vals->'cells'->>'trip_no',x.vals->'cells'->>'source_trip_id',x.vals->'cells'->>'trip_date',x.vals->'cells'->>'truck_type',
       x.vals->'cells'->>'job_no',x.vals->'cells'->>'invoiced',x.vals->'cells'->>'company',
       x.vals->'cells'->>'driver',x.vals->'cells'->>'owner',x.vals->'cells'->>'plate',
       x.vals->'cells'->>'from',x.vals->'cells'->>'to',x.vals->'cells'->>'charge',x.vals->'cells'->>'supplier_charge',x.vals->'cells'->>'supplier_charges',x.vals->'cells'->>'paper_received_by',
       x.vals->'cells'->>'rent_driver',x.vals->'cells'->>'supplier_paid',x.vals->'cells'->>'supplier_balance',
       x.vals->'cells'->>'supplier_credit',x.vals->'cells'->>'driver_pay',x.vals->'cells'->>'driver_paid',
       x.vals->'cells'->>'driver_balance',x.vals->'cells'->>'payment_date',x.vals->'cells'->>'amount',
       x.vals->'cells'->>'company_rate',x.vals->'cells'->>'received_company',x.vals->'cells'->>'remaining_company',
       x.vals->'cells'->>'customer_credit',x.vals->'cells'->>'profit',x.vals->'cells'->>'commission',
       x.vals->'cells'->>'invoice_no',x.vals->'cells'->>'supplier_invoice_no',x.vals->'cells'->>'sale_type',x.status,x.ppr_status
     ),',',''))
   )>0 end)
   and not exists(select 1 from jsonb_each(coalesce(p_filters->'columns','{}')) f
    where f.key is distinct from p_option_key and jsonb_array_length(f.value)>0
     and not f.value @> jsonb_build_array(x.vals->'cells'->>f.key))
 ), filtered as materialized (
  select * from filtered_without_status x where coalesce(jsonb_array_length(p_filters->'statuses'),0)=0 or exists(select 1 from jsonb_array_elements_text(p_filters->'statuses') s where s='status:'||x.status)
 ), chosen as materialized (
  select x.id,x.status,x.full_row,x.n_customer_charges customer_charges,x.n_rent_driver rent,x.n_supplier_charges supplier_charges,x.n_profit profit,x.invoice_no_raw invoice_no,x.supplier_invoice_no_raw supplier_invoice_no,row_number() over(order by case when p_direction='asc' and p_sort='trip_date' then x.trip_date end asc,
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
  select case when cv and sv then to_jsonb(chosen.full_row) else public._transport_mask_financial_row(to_jsonb(chosen.full_row),cv,sv) end||jsonb_build_object('status',chosen.status,'customer_charges',chosen.customer_charges,'supplier_rent',chosen.rent,'supplier_charges',chosen.supplier_charges,'trip_profit',chosen.profit,'invoice_no',case when cv then nullif(chosen.invoice_no,'') end,'supplier_invoice_no',case when sv then nullif(chosen.supplier_invoice_no,'') end) row,chosen.ordinal
  from chosen
 ), filtered_agg as materialized (
  select
   count(*) row_count,
   count(*) filter (where status in ('complete','locked','settled')) completed_count,
   count(*) filter (where ppr_status='received') paper_received_count,
   count(*) filter (where ppr_status is distinct from 'received') paper_pending_count,
   count(*) filter (where n_received_company>0) collection_received_count,
   count(*) filter (where n_received_company<=0) collection_pending_count,
   count(*) filter (where n_supplier_paid>0) supplier_paid_count,
   count(*) filter (where n_supplier_paid<=0) supplier_unpaid_count,
   jsonb_build_object('charge',coalesce(sum(x.n_customer_charges),0),'rent_driver',coalesce(sum(x.n_rent_driver),0),'supplier_charges',coalesce(sum(x.n_supplier_charges),0),'supplier_paid',coalesce(sum(x.n_supplier_paid),0),'supplier_balance',coalesce(sum(x.n_supplier_balance),0),'supplier_credit',coalesce(sum(x.n_supplier_credit),0),'driver_pay',coalesce(sum(x.n_driver_pay),0),'driver_paid',coalesce(sum(x.n_driver_paid),0),'driver_balance',coalesce(sum(x.n_driver_balance),0),'amount',coalesce(sum(x.n_amount),0),'company_rate',coalesce(sum(x.n_company_rate),0),'received_company',coalesce(sum(x.n_received_company),0),'remaining_company',coalesce(sum(x.n_remaining_company),0),'customer_credit',coalesce(sum(x.n_customer_credit),0),'profit',coalesce(sum(x.n_profit),0),'commission',coalesce(sum(x.n_commission),0)) totals
  from filtered x
 ),
 options as (select distinct x.vals->'cells'->>p_option_key value from filtered x
  where position(
 lower(case when x.vals->'numbers' ? p_option_key then replace(btrim(coalesce(p_option_search,'')),',','') else btrim(coalesce(p_option_search,'')) end)
 in lower(case when x.vals->'numbers' ? p_option_key then replace(x.vals->'cells'->>p_option_key,',','') else x.vals->'cells'->>p_option_key end))>0
  order by value),
 statuses as (
  select v.key,v.label,v.narration,v.sort_order,count(x.id) count
  from (values
    ('status:draft','Draft','No customer or supplier rate has been finalized yet.',1),
    ('status:incomplete','Incomplete','Only one of Customer Rate or Supplier Rent is finalized; the other side is still pending.',2),
    ('status:complete','Complete','Customer Rate and Supplier Rent are both finalized, but both financial sides are not yet posted.',3),
    ('status:locked','Locked','Customer billing and every required Supplier Rent are posted. Normal Trip/commercial editing is locked.',4),
    ('status:settled','Settled','Both sides are posted and Customer/Supplier outstanding balances are fully settled.',5)
  ) v(key,label,narration,sort_order)
  left join filtered_without_status x on 'status:'||x.status=v.key
  group by v.key,v.label,v.narration,v.sort_order
)
 select case when p_option_key is not null then jsonb_build_object('options',coalesce((select jsonb_agg(value) from options),'[]'))
 else jsonb_build_object('snapshot',case when p_filters->>'snapshot'='true' then (select md5(coalesce(string_agg(id::text||md5(concat_ws('|',status,financial_status,ppr_status,vals::text)),'' order by id),'')) from filtered) end,'rows',coalesce((select jsonb_agg(row order by ordinal) from page),'[]'),'count',(select row_count from filtered_agg),
  'completed',(select completed_count from filtered_agg),
  'paper_pending',(select paper_pending_count from filtered_agg),
  'summary',jsonb_build_object(
    'paper',jsonb_build_object('received',(select paper_received_count from filtered_agg),'not_received',(select paper_pending_count from filtered_agg)),
    'collections',case when cv then jsonb_build_object('received',(select collection_received_count from filtered_agg),'not_received',(select collection_pending_count from filtered_agg)) else null end,
    'payment',case when sv then jsonb_build_object('paid',(select supplier_paid_count from filtered_agg),'not_paid',(select supplier_unpaid_count from filtered_agg)) else null end
  ),
  'statuses',coalesce((select jsonb_agg(to_jsonb(statuses)-'sort_order' order by sort_order) from statuses),'[]'),
  'totals',coalesce((select totals from filtered_agg),'{}')) end into answer;
 if not (cv and sv) then
 answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public._transport_mask_financial_row(value,cv,sv)) from jsonb_array_elements(answer->'rows')),'[]'));
 answer:=jsonb_set(answer,'{totals}',public._transport_mask_financial_row(answer->'totals',cv,sv));
 end if;
 return answer||jsonb_build_object('permissions',jsonb_build_object('customer',cv,'supplier',sv));
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_transfer_export_page(p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();company_name text;total bigint;items jsonb;
begin if auth.uid() is null or c is null or b is null then raise exception 'Active workspace required';end if;if not public.has_module_permission(c,'transport','read') then raise exception 'Transport read permission required';end if;if p_limit not between 1 and 500 or p_offset<0 then raise exception 'Invalid export page';end if;
select name into company_name from public.companies where id=c;select count(*) into total from public.transport_trips t where t.company_id=c and t.business_unit_id=b;
select coalesce(jsonb_agg(x.obj order by x.trip_date,x.trip_no),'[]'::jsonb) into items from(select t.trip_date,public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,jsonb_build_object('source_company',company_name,'source_trip_id',t.id::text,'source_trip_no',public.transport_display_trip_no(t.id,t.trip_no),'trip_date',t.trip_date,'customer_id',t.customer_id,'customer',coalesce(cu.name,t.customer_name_snapshot),'vehicle_id',t.vehicle_id,'vehicle_no',v.vehicle_no,'driver_id',t.driver_id,'driver',d.driver_name,'driver_code',d.driver_code,'truck_type_id',t.truck_type_id,'truck_type',tt.name,'from_location',coalesce(fl.name,t.from_location),'to_location',coalesce(tl.name,t.to_location),'from_location_id',t.from_location_id,'to_location_id',t.to_location_id,'job_no',t.po_do_job_no,'sale_type',t.sale_type,'notes',t.notes) obj from public.transport_trips t left join public.customers cu on cu.id=t.customer_id and cu.company_id=t.company_id left join public.transport_vehicles v on v.id=t.vehicle_id and v.company_id=t.company_id and v.business_unit_id=t.business_unit_id left join public.transport_drivers d on d.id=t.driver_id and d.company_id=t.company_id and d.business_unit_id=t.business_unit_id left join public.transport_truck_types tt on tt.id=t.truck_type_id and tt.company_id=t.company_id and tt.business_unit_id=t.business_unit_id left join public.transport_locations fl on fl.id=t.from_location_id and fl.company_id=t.company_id and fl.business_unit_id=t.business_unit_id left join public.transport_locations tl on tl.id=t.to_location_id and tl.company_id=t.company_id and tl.business_unit_id=t.business_unit_id where t.company_id=c and t.business_unit_id=b order by t.trip_date,public.transport_display_trip_no(t.id,t.trip_no) limit p_limit offset p_offset)x;return jsonb_build_object('rows',items,'total_count',total);end$function$
;

CREATE OR REPLACE FUNCTION public.transport_trip_audit_report(p_trip_no text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();n text:=upper(btrim(p_trip_no));answer jsonb;
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active Company/Business Unit required';end if;
 if n is null or length(n) not between 1 and 120 then raise exception 'Enter an exact Trip No';end if;
 with filtered as materialized (
  select a.*,coalesce(u.email,a.changed_by::text,a.actor_id::text,'Not recorded') actor_name,
   coalesce(a.changed_at,a.occurred_at) event_at,
   coalesce(a.new_data->>'source',a.old_data->>'source','Not recorded') source,
   coalesce(a.reason,a.new_data->>'reason',a.old_data->>'reason') event_reason
  from public.transport_trip_audit a left join public.user_profiles u on u.id=coalesce(a.changed_by,a.actor_id)
  where a.company_id=c and a.business_unit_id=b and a.operating_location_id=loc and (upper(btrim(a.trip_no))=n or upper(btrim(public.transport_display_trip_no(a.trip_id,a.trip_no)))=n)
 ), page as (select * from filtered order by event_at asc nulls first,id asc limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0)),
 ids as (select distinct v.value#>>'{}' id from filtered a cross join lateral jsonb_each(case when jsonb_typeof(a.old_data)='object' then a.old_data else '{}'::jsonb end) v
  union select distinct v.value#>>'{}' from filtered a cross join lateral jsonb_each(case when jsonb_typeof(a.new_data)='object' then a.new_data else '{}'::jsonb end) v),
 labels as (
  select id::text id,name label from public.customers where company_id=c and id::text in (select id from ids)
  union all select id::text,name from public.suppliers where company_id=c and id::text in (select id from ids)
  union all select id::text,driver_name from public.transport_drivers where company_id=c and business_unit_id=b and id::text in (select id from ids)
  union all select id::text,vehicle_no from public.transport_vehicles where company_id=c and business_unit_id=b and id::text in (select id from ids)
  union all select id::text,name from public.transport_locations where company_id=c and business_unit_id=b and id::text in (select id from ids)
  union all select id::text,name from public.transport_truck_types where company_id=c and business_unit_id=b and id::text in (select id from ids)
  union all select id::text,name from public.employees where company_id=c and id::text in (select id from ids)
 )
 select jsonb_build_object('trip_no',n,'rows',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('trip_no',public.transport_display_trip_no(p.trip_id,p.trip_no)) order by p.event_at asc nulls first,p.id) from page p),'[]'::jsonb),
 'count',(select count(*) from filtered),'labels',coalesce((select jsonb_object_agg(id,label) from labels),'{}'::jsonb),
 'deleted',exists(select 1 from filtered) and not exists(select 1 from public.transport_trips t where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc and (upper(btrim(t.trip_no))=n or upper(btrim(public.transport_display_trip_no(t.id,t.trip_no)))=n)),
 'snapshot',coalesce((select coalesce(nullif(a.new_data,'{}'),a.old_data) from filtered a where coalesce(a.new_data,a.old_data) ? 'trip_no' order by a.event_at desc,a.id desc limit 1),'{}'::jsonb)) into answer;
 return answer;
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_trip_service_description(p_trip_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select concat_ws(' · ','Transport service',public.transport_display_trip_no(t.id,t.trip_no),to_char(t.trip_date,'DD-Mon-YYYY'),t.from_location||' → '||t.to_location,
 'Vehicle: '||coalesce(v.vehicle_no,'Unassigned'),'Driver: '||coalesce(d.driver_name,'Unassigned'),'Job/PO/DO: '||nullif(t.po_do_job_no,''))
 from public.transport_trips t left join public.transport_vehicles v on v.id=t.vehicle_id left join public.transport_drivers d on d.id=t.driver_id where t.id=p_trip_id
$function$
;

CREATE OR REPLACE FUNCTION public.transport_work_queue(p_desk text DEFAULT 'operations'::text, p_page integer DEFAULT 0, p_search text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c uuid := public.current_company_id();
  b uuid := public.current_business_unit_id();
  loc uuid := public.current_operating_location_id();
  result jsonb;
  needle text := lower(btrim(coalesce(p_search,'')));
begin
  if auth.uid() is null or c is null or b is null or loc is null
     or not public.has_module_permission(c,'transport','view') then
    raise exception 'Transport view permission and active Company/Business Unit/Location required';
  end if;
  if p_desk not in ('operations','billing','supplier','payments','ppr')
     or p_page is null or p_page < 0 or p_page > 1000
     or length(needle) > 80 then
    raise exception 'Invalid Transport work queue request';
  end if;
  if p_desk='billing' and not public.transport_financial_read_allowed('customer') then
    raise exception 'Customer financial view permission required';
  end if;
  if p_desk='supplier' and not public.transport_financial_read_allowed('supplier') then
    raise exception 'Supplier financial view permission required';
  end if;
  if p_desk='payments' and not (
    public.transport_financial_read_allowed('customer') or
    public.transport_financial_read_allowed('supplier')
  ) then
    raise exception 'Transport financial view permission required';
  end if;

  -- Scope, sort and page BEFORE joining names/snapshots. No ledger or
  -- invoice joins, no count(*) of the entire historical register.
  with picked as materialized (
    select t.id,public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,t.trip_date,t.po_do_job_no,t.customer_id,
      t.customer_name_snapshot,t.from_location,t.to_location,t.driver_id,
      t.vehicle_id,t.truck_type,t.ppr_status,t.ppr_received_date,
      t.ppr_received_by_name,t.customer_rate_status,t.supplier_rent_status,
      t.trip_status,t.company_id,t.business_unit_id,t.operating_location_id
    from public.transport_trips t
    where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
      and (p_desk <> 'ppr' or t.ppr_status is distinct from 'received')
      and (p_desk <> 'billing' or t.customer_rate_status = 'pending')
      and (p_desk <> 'supplier' or t.supplier_rent_status = 'pending')
      and (needle='' or lower(public.transport_display_trip_no(t.id,t.trip_no)) like needle||'%' or lower(coalesce(t.po_do_job_no,'')) like needle||'%')
    order by t.trip_date desc,public.transport_display_trip_no(t.id,t.trip_no) desc
    limit 51 offset (p_page*50)
  ), detailed as (
    select t.*,coalesce(cu.name,t.customer_name_snapshot,'') as customer_name,
      coalesce(d.driver_name,hi.driver_name_snapshot,'') as driver_name,
      coalesce(v.vehicle_no,hi.vehicle_no_snapshot,'') as vehicle_no
    from picked t
    left join public.customers cu on cu.id=t.customer_id
    left join public.transport_drivers d on d.id=t.driver_id
    left join public.transport_vehicles v on v.id=t.vehicle_id
    left join public.transport_historical_trip_identity hi
      on hi.trip_id=t.id and hi.company_id=t.company_id
      and hi.business_unit_id=t.business_unit_id
      and hi.operating_location_id=t.operating_location_id
  )
  select jsonb_build_object(
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',x.id,'trip_no',x.trip_no,'trip_date',x.trip_date,
        'job_no',x.po_do_job_no,'customer',x.customer_name,
        'driver',x.driver_name,'vehicle',x.vehicle_no,
        'truck_type',x.truck_type,'from',x.from_location,'to',x.to_location,
        'ppr_status',x.ppr_status,'ppr_received_date',x.ppr_received_date,
        'ppr_received_by',x.ppr_received_by_name,
        'customer_rate_status',x.customer_rate_status,
        'supplier_rent_status',x.supplier_rent_status,
        'trip_status',x.trip_status
      ) order by x.trip_date desc,x.trip_no desc)
      from (select * from detailed order by trip_date desc,trip_no desc limit 50) x
    ),'[]'::jsonb),
    'has_more',(select count(*)>50 from picked),
    'page',p_page,'desk',p_desk
  ) into result;
  return result;
end
$function$
;

CREATE OR REPLACE VIEW public.transport_vehicle_contributions AS
 SELECT existing.event_id,
    existing.company_id,
    existing.business_unit_id,
    existing.operating_location_id,
    existing.trip_id,
    existing.trip_no,
    existing.account_id,
    existing.account_name,
    existing.event_date,
    existing.entry_no,
    existing.event_type,
    existing.category,
    existing.expense_accounts,
    existing.revenue,
    existing.cost
   FROM ( SELECT canonical.event_id,
            canonical.company_id,
            canonical.business_unit_id,
            canonical.operating_location_id,
            canonical.trip_id,
            canonical.trip_no,
            canonical.account_id,
            canonical.account_name,
            canonical.event_date,
            canonical.entry_no,
            canonical.event_type,
            canonical.category,
            canonical.expense_accounts,
            canonical.revenue,
            canonical.cost
           FROM ( WITH customer_lines AS (
                         SELECT (('vehicle-line:'::text || m.event_id) || ':'::text) || l.id::text AS event_id,
                            m.company_id,
                            m.business_unit_id,
                            m.operating_location_id,
                            t.id AS trip_id,
                            public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,
                            a.vehicle_id AS account_id,
                            a.vehicle_no_snapshot AS account_name,
                            m.event_date,
                            m.entry_no,
                            m.event_type,
                            'Revenue'::text AS category,
                            ''::text AS expense_accounts,
                                CASE
                                    WHEN m.event_type = ANY (ARRAY['credit_note'::text, 'reversal_bill'::text]) THEN - l.amount
                                    WHEN m.event_type = ANY (ARRAY['bill'::text, 'reversal_credit_note'::text]) THEN l.amount
                                    ELSE 0::numeric
                                END AS revenue,
                            0::numeric AS cost
                           FROM transport_party_movements m
                             JOIN sales_service_lines l ON m.side = 'customer'::text AND l.order_id = m.order_id AND l.source_module = 'transport_trip'::text AND (l.source_id = ANY (m.trip_ids))
                             JOIN transport_trips t ON t.id = l.source_id
                             JOIN journal_entries j ON j.id = m.journal_entry_id
                             JOIN LATERAL ( SELECT x.vehicle_id,
                                    x.vehicle_no_snapshot
                                   FROM transport_trip_assignments x
                                  WHERE x.trip_id = t.id AND x.company_id = m.company_id AND x.business_unit_id = m.business_unit_id AND x.created_at <= j.created_at AND x.effective_at <= j.created_at AND (x.ended_at IS NULL OR j.created_at < x.ended_at)
                                  ORDER BY x.effective_at DESC
                                 LIMIT 1) a ON a.vehicle_id IS NOT NULL
                          WHERE m.event_type = ANY (ARRAY['bill'::text, 'credit_note'::text, 'reversal_bill'::text, 'reversal_credit_note'::text])
                        ), supplier_docs AS (
                         SELECT m.event_id,
                            m.company_id,
                            m.business_unit_id,
                            m.operating_location_id,
                            m.trip_ids[1] AS trip_id,
                            m.trip_no,
                            m.account_id,
                            m.account_name,
                            m.event_date,
                            m.entry_no,
                            m.event_type,
                                CASE
                                    WHEN m.kind = 'rent'::text THEN 'Supplier rent'::text
                                    ELSE 'Trip expense'::text
                                END AS category,
                            COALESCE(( SELECT string_agg(DISTINCT c.name, ', '::text ORDER BY c.name) AS string_agg
                                   FROM purchase_service_lines l
                                     JOIN chart_of_accounts c ON c.id = l.cost_account_id
                                  WHERE l.order_id = m.order_id), ''::text) AS expense_accounts,
                            0::numeric AS revenue,
                            m.net_amount AS cost
                           FROM transport_vehicle_account_movements m
                          WHERE m.side = 'supplier'::text AND (m.event_type = ANY (ARRAY['bill'::text, 'credit_note'::text, 'reversal_bill'::text, 'reversal_credit_note'::text]))
                        ), legacy_driver_costs AS (
                         SELECT m.event_id,
                            m.company_id,
                            m.business_unit_id,
                            m.operating_location_id,
                            m.trip_id,
                            m.trip_no,
                            a.vehicle_id AS account_id,
                            a.vehicle_no_snapshot AS account_name,
                            m.event_date,
                            m.entry_no,
                            m.event_type,
                            'Driver pay'::text AS category,
                            ''::text AS expense_accounts,
                            0::numeric AS revenue,
                            m.amount AS cost
                           FROM transport_driver_account_movements_before_salary_link m
                             JOIN journal_entries source ON source.id = m.journal_entry_id
                             JOIN journal_entries original ON original.id = COALESCE(source.reversal_of_entry_id, source.id)
                             JOIN LATERAL ( SELECT x.vehicle_id,
                                    x.vehicle_no_snapshot
                                   FROM transport_trip_assignments x
                                  WHERE x.trip_id = m.trip_id AND x.company_id = m.company_id AND x.business_unit_id = m.business_unit_id AND x.created_at <= original.created_at AND x.effective_at <= original.created_at AND (x.ended_at IS NULL OR original.created_at < x.ended_at)
                                  ORDER BY x.effective_at DESC
                                 LIMIT 1) a ON a.vehicle_id IS NOT NULL
                          WHERE m.event_type = ANY (ARRAY['salary_accrual'::text, 'reversal_salary_accrual'::text])
                        ), month_driver_costs AS (
                         SELECT x.event_id,
                            x.company_id,
                            x.business_unit_id,
                            x.operating_location_id,
                            x.trip_id,
                            x.trip_no,
                            x.account_id,
                            x.account_name,
                            x.trip_date AS event_date,
                            j.entry_no,
                            'driver_month_closing'::text AS event_type,
                            x.category,
                            ''::text AS expense_accounts,
                            0::numeric AS revenue,
                            x.amount AS cost
                           FROM transport_driver_month_trip_costs x
                             JOIN journal_entries j ON j.id = x.journal_entry_id
                        )
                 SELECT customer_lines.event_id,
                    customer_lines.company_id,
                    customer_lines.business_unit_id,
                    customer_lines.operating_location_id,
                    customer_lines.trip_id,
                    customer_lines.trip_no,
                    customer_lines.account_id,
                    customer_lines.account_name,
                    customer_lines.event_date,
                    customer_lines.entry_no,
                    customer_lines.event_type,
                    customer_lines.category,
                    customer_lines.expense_accounts,
                    customer_lines.revenue,
                    customer_lines.cost
                   FROM customer_lines
                UNION ALL
                 SELECT supplier_docs.event_id,
                    supplier_docs.company_id,
                    supplier_docs.business_unit_id,
                    supplier_docs.operating_location_id,
                    supplier_docs.trip_id,
                    supplier_docs.trip_no,
                    supplier_docs.account_id,
                    supplier_docs.account_name,
                    supplier_docs.event_date,
                    supplier_docs.entry_no,
                    supplier_docs.event_type,
                    supplier_docs.category,
                    supplier_docs.expense_accounts,
                    supplier_docs.revenue,
                    supplier_docs.cost
                   FROM supplier_docs
                UNION ALL
                 SELECT legacy_driver_costs.event_id,
                    legacy_driver_costs.company_id,
                    legacy_driver_costs.business_unit_id,
                    legacy_driver_costs.operating_location_id,
                    legacy_driver_costs.trip_id,
                    legacy_driver_costs.trip_no,
                    legacy_driver_costs.account_id,
                    legacy_driver_costs.account_name,
                    legacy_driver_costs.event_date,
                    legacy_driver_costs.entry_no,
                    legacy_driver_costs.event_type,
                    legacy_driver_costs.category,
                    legacy_driver_costs.expense_accounts,
                    legacy_driver_costs.revenue,
                    legacy_driver_costs.cost
                   FROM legacy_driver_costs
                UNION ALL
                 SELECT month_driver_costs.event_id,
                    month_driver_costs.company_id,
                    month_driver_costs.business_unit_id,
                    month_driver_costs.operating_location_id,
                    month_driver_costs.trip_id,
                    month_driver_costs.trip_no,
                    month_driver_costs.account_id,
                    month_driver_costs.account_name,
                    month_driver_costs.event_date,
                    month_driver_costs.entry_no,
                    month_driver_costs.event_type,
                    month_driver_costs.category,
                    month_driver_costs.expense_accounts,
                    month_driver_costs.revenue,
                    month_driver_costs.cost
                   FROM month_driver_costs) canonical
        UNION ALL
         SELECT transport_vehicle_manual_contributions.event_id,
            transport_vehicle_manual_contributions.company_id,
            transport_vehicle_manual_contributions.business_unit_id,
            transport_vehicle_manual_contributions.operating_location_id,
            transport_vehicle_manual_contributions.trip_id,
            transport_vehicle_manual_contributions.trip_no,
            transport_vehicle_manual_contributions.account_id,
            transport_vehicle_manual_contributions.account_name,
            transport_vehicle_manual_contributions.event_date,
            transport_vehicle_manual_contributions.entry_no,
            transport_vehicle_manual_contributions.event_type,
            transport_vehicle_manual_contributions.category,
            transport_vehicle_manual_contributions.expense_accounts,
            transport_vehicle_manual_contributions.revenue,
            transport_vehicle_manual_contributions.cost
           FROM transport_vehicle_manual_contributions) existing
UNION ALL
 SELECT transport_external_vehicle_contributions.event_id,
    transport_external_vehicle_contributions.company_id,
    transport_external_vehicle_contributions.business_unit_id,
    transport_external_vehicle_contributions.operating_location_id,
    transport_external_vehicle_contributions.trip_id,
    transport_external_vehicle_contributions.trip_no,
    transport_external_vehicle_contributions.account_id,
    transport_external_vehicle_contributions.account_name,
    transport_external_vehicle_contributions.event_date,
    transport_external_vehicle_contributions.entry_no,
    transport_external_vehicle_contributions.event_type,
    transport_external_vehicle_contributions.category,
    transport_external_vehicle_contributions.expense_accounts,
    transport_external_vehicle_contributions.revenue,
    transport_external_vehicle_contributions.cost
   FROM transport_external_vehicle_contributions;

CREATE OR REPLACE VIEW public.transport_financial_register AS
 SELECT t.id,
    t.company_id,
    t.business_unit_id,
    public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,
    t.trip_date,
    t.customer_id,
    t.customer_name_snapshot,
    t.vehicle_id,
    t.driver_id,
    t.owner_name_snapshot,
    t.truck_type,
    t.po_do_job_no,
    t.from_location,
    t.to_location,
    t.service_period,
    t.ppr_status,
    t.status,
    t.customer_rate,
    t.driver_pay,
    t.owner_rent,
    t.fuel_cost,
    t.toll_cost,
    t.other_cost,
    t.sales_order_id,
    t.notes,
    t.created_by,
    t.created_at,
    t.updated_at,
    t.truck_type_id,
    t.from_location_id,
    t.to_location_id,
    t.lifecycle_status,
    t.rent_state,
    t.job_status,
    t.ppr_received_by_employee_id,
    t.ppr_received_by_name,
    t.ppr_received_date,
    t.ppr_attachment_path,
    t.customer_rate_state,
    t.customer_rate_source,
    t.customer_rate_reference_id,
    t.customer_rate_snapshot,
    t.customer_rate_finalized_at,
    t.customer_rate_finalized_by,
    t.rent_finalized_at,
    t.rent_finalized_by,
    t.owner_supplier_id,
    t.ownership_id,
    t.trip_status,
    t.customer_rate_status,
    t.supplier_rent,
    t.supplier_rent_status,
    t.ppr_received_by,
    t.updated_by,
    t.sale_type,
    COALESCE(c.name, t.customer_name_snapshot) AS customer_name,
        CASE
            WHEN NOT hm.vehicle_master_id IS DISTINCT FROM t.vehicle_id THEN COALESCE(hi.vehicle_no_snapshot, v.vehicle_no)
            ELSE COALESCE(v.vehicle_no, hi.vehicle_no_snapshot)
        END AS vehicle_no,
    COALESCE(tt.name, t.truck_type, v.truck_type) AS truck_type_name,
        CASE
            WHEN NOT hm.driver_master_id IS DISTINCT FROM t.driver_id THEN COALESCE(hi.driver_name_snapshot, d.driver_name)
            ELSE COALESCE(d.driver_name, hi.driver_name_snapshot)
        END AS driver_name,
    COALESCE(t.owner_name_snapshot, v.owner_name, s.name, hi.owner_name_snapshot) AS owner_name,
    f.financial_status,
    f.customer_documents > 0 AS invoiced,
    f.customer_rate_locked,
    f.supplier_rate_locked,
        CASE
            WHEN f.customer_documents > 0 THEN f.customer_net
            ELSE NULL::numeric
        END AS billed_customer_net,
        CASE
            WHEN f.customer_documents > 0 THEN f.customer_received_net
            ELSE hp.received_gross
        END AS received_from_company,
        CASE
            WHEN f.customer_documents > 0 THEN f.customer_outstanding_net
            ELSE (hm.raw_source ->> 25)::numeric
        END AS remaining_with_company,
        CASE
            WHEN f.customer_documents > 0 THEN f.customer_received_gross
            ELSE COALESCE(hp.received_gross, 0::numeric)
        END AS customer_received_gross,
        CASE
            WHEN f.customer_documents > 0 OR hm.trip_id IS NULL THEN f.customer_outstanding_gross
            ELSE GREATEST((hm.raw_source ->> 25)::numeric, 0::numeric)
        END AS customer_outstanding_gross,
        CASE
            WHEN f.customer_documents > 0 OR hm.trip_id IS NULL THEN f.customer_credit_gross
            ELSE GREATEST(- ((hm.raw_source ->> 25)::numeric), 0::numeric)
        END AS customer_credit_gross,
        CASE
            WHEN f.supplier_rate_locked THEN f.supplier_net
            ELSE NULL::numeric
        END AS billed_supplier_net,
        CASE
            WHEN f.supplier_rate_locked THEN f.supplier_paid_net
            ELSE hp.paid_gross
        END AS supplier_paid_net,
        CASE
            WHEN f.supplier_rate_locked OR hm.trip_id IS NULL THEN f.supplier_outstanding_gross
            ELSE GREATEST((hm.raw_source ->> 18)::numeric, 0::numeric)
        END AS supplier_outstanding_gross,
        CASE
            WHEN f.supplier_rate_locked OR hm.trip_id IS NULL THEN f.supplier_credit_gross
            ELSE GREATEST(- ((hm.raw_source ->> 18)::numeric), 0::numeric)
        END AS supplier_credit_gross,
        CASE
            WHEN f.driver_accrued > 0::numeric THEN f.driver_accrued
            ELSE NULL::numeric
        END AS driver_accrued,
    f.driver_paid,
    f.driver_outstanding,
        CASE
            WHEN f.customer_rate_locked OR f.supplier_rate_locked THEN f.supplier_outstanding_gross + f.driver_outstanding
            ELSE NULL::numeric
        END AS remaining_with_us,
        CASE
            WHEN f.supplier_rate_locked THEN f.supplier_payment_date
            ELSE hp.payment_date
        END AS payment_date,
        CASE
            WHEN f.supplier_rate_locked THEN f.supplier_paid_gross
            ELSE hp.paid_gross
        END AS payment_amount,
    f.posted_profit AS trip_profit,
    f.commission_paid_net,
    f.other_cost_net,
    hm.customer_invoice_ref AS historical_customer_invoice_ref,
    hm.supplier_invoice_ref AS historical_supplier_invoice_ref,
    hm.company_owned AS historical_company_owned,
    hm.company_cost_net AS historical_company_cost_net,
    hm.paper_status AS historical_paper_status
   FROM transport_trips t
     JOIN transport_trip_financial_summary f ON f.id = t.id
     LEFT JOIN customers c ON c.id = t.customer_id
     LEFT JOIN transport_vehicles v ON v.id = t.vehicle_id
     LEFT JOIN transport_truck_types tt ON tt.id = t.truck_type_id
     LEFT JOIN transport_drivers d ON d.id = t.driver_id
     LEFT JOIN suppliers s ON s.id = v.supplier_id
     LEFT JOIN user_profiles u ON u.id = t.ppr_received_by
     LEFT JOIN transport_historical_trip_identity hi ON hi.trip_id = t.id AND hi.company_id = t.company_id AND hi.business_unit_id = t.business_unit_id AND hi.operating_location_id = t.operating_location_id
     LEFT JOIN transport_historical_operational_mapping hm ON hm.trip_id = t.id AND hm.company_id = t.company_id AND hm.business_unit_id = t.business_unit_id AND hm.operating_location_id = t.operating_location_id
     LEFT JOIN transport_historical_payment_snapshots hp ON hp.trip_id = t.id AND hp.company_id = t.company_id AND hp.business_unit_id = t.business_unit_id AND hp.operating_location_id = t.operating_location_id;

CREATE OR REPLACE VIEW public.transport_trip_register AS
 SELECT t.id,
    t.company_id,
    t.business_unit_id,
    public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,
    t.trip_date,
    t.trip_status,
    t.job_status,
    t.ppr_status,
    t.po_do_job_no,
    COALESCE(c.name, t.customer_name_snapshot) AS customer_name,
    COALESCE(v.vehicle_no, hi.vehicle_no_snapshot) AS vehicle_no,
    COALESCE(d.driver_name, hi.driver_name_snapshot) AS driver_name,
    t.from_location,
    t.to_location,
    t.customer_rate,
    t.customer_rate_status,
    t.supplier_rent,
    t.supplier_rent_status,
        CASE
            WHEN t.customer_rate IS NULL OR t.supplier_rent IS NULL THEN NULL::numeric
            ELSE t.customer_rate - t.supplier_rent
        END AS trip_margin,
    t.created_at,
    t.updated_at
   FROM transport_trips t
     LEFT JOIN customers c ON c.id = t.customer_id
     LEFT JOIN transport_vehicles v ON v.id = t.vehicle_id
     LEFT JOIN transport_drivers d ON d.id = t.driver_id
     LEFT JOIN transport_historical_trip_identity hi ON hi.trip_id = t.id AND hi.company_id = t.company_id AND hi.business_unit_id = t.business_unit_id AND hi.operating_location_id = t.operating_location_id;

CREATE OR REPLACE VIEW public.transport_trip_register_legacy_foundation AS
 SELECT t.id,
    t.company_id,
    t.business_unit_id,
    public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,
    t.trip_date,
    t.status,
    t.ppr_status,
    t.po_do_job_no,
    COALESCE(c.name, t.customer_name_snapshot) AS customer_name,
    v.vehicle_no,
    COALESCE(tt.name, t.truck_type, v.truck_type) AS truck_type,
    d.driver_name,
    COALESCE(NULLIF(btrim(t.owner_name_snapshot), ''::text), NULLIF(btrim(v.owner_name), ''::text)) AS owner_name,
    t.from_location,
    t.to_location,
    t.service_period,
    t.customer_rate,
    t.driver_pay,
    t.owner_rent,
    t.fuel_cost,
    t.toll_cost,
    t.other_cost,
    COALESCE(e.expense_total, 0::numeric)::numeric(18,2) AS extra_expenses,
    (t.driver_pay + t.owner_rent + t.fuel_cost + t.toll_cost + t.other_cost + COALESCE(e.expense_total, 0::numeric))::numeric(18,2) AS total_cost,
    (t.customer_rate - (t.driver_pay + t.owner_rent + t.fuel_cost + t.toll_cost + t.other_cost + COALESCE(e.expense_total, 0::numeric)))::numeric(18,2) AS trip_profit,
    t.sales_order_id,
    t.notes,
    t.created_at,
    t.updated_at,
    t.ppr_received_by_name,
    t.ppr_received_date,
    t.sale_type
   FROM transport_trips t
     LEFT JOIN customers c ON c.id = t.customer_id
     LEFT JOIN transport_vehicles v ON v.id = t.vehicle_id
     LEFT JOIN transport_truck_types tt ON tt.id = t.truck_type_id
     LEFT JOIN transport_drivers d ON d.id = t.driver_id
     LEFT JOIN ( SELECT transport_trip_expenses.trip_id,
            sum(transport_trip_expenses.amount) AS expense_total
           FROM transport_trip_expenses
          GROUP BY transport_trip_expenses.trip_id) e ON e.trip_id = t.id;

CREATE OR REPLACE VIEW public.transport_party_document_sources AS
 SELECT existing.side,
    existing.order_id,
    existing.company_id,
    existing.business_unit_id,
    existing.operating_location_id,
    existing.party_id,
    existing.party_name,
    existing.order_no,
    existing.order_date,
    existing.original_gross,
    existing.original_net,
    existing.journal_entry_id,
    existing.kind,
    existing.trip_ids,
    existing.trip_no,
    existing.entry_no,
    existing.posted_date
   FROM ( WITH links AS (
                 SELECT 'customer'::text AS side,
                    d.sales_order_id AS order_id,
                    d.journal_entry_id,
                    d.document_kind AS kind,
                    l.trip_id
                   FROM transport_customer_documents d
                     JOIN transport_customer_document_trips l ON l.document_id = d.id
                UNION ALL
                 SELECT 'supplier'::text AS text,
                    d.purchase_order_id,
                    d.journal_entry_id,
                    'rent'::text AS text,
                    l.trip_id
                   FROM transport_supplier_documents d
                     JOIN transport_supplier_document_rents l ON l.document_id = d.id
                UNION ALL
                 SELECT 'supplier'::text AS text,
                    l.purchase_order_id,
                    l.journal_entry_id,
                    l.cost_kind,
                    l.trip_id
                   FROM transport_service_cost_links l
                ), grouped AS (
                 SELECT l.side,
                    l.order_id,
                    l.journal_entry_id,
                    l.kind,
                    array_agg(DISTINCT t.id ORDER BY t.id) AS trip_ids,
                    string_agg(DISTINCT public.transport_display_trip_no(t.id,t.trip_no), ', '::text ORDER BY public.transport_display_trip_no(t.id,t.trip_no)) AS trip_no
                   FROM links l
                     JOIN transport_trips t ON t.id = l.trip_id
                  GROUP BY l.side, l.order_id, l.journal_entry_id, l.kind
                ), orders AS (
                 SELECT 'customer'::text AS side,
                    s.id AS order_id,
                    s.company_id,
                    s.business_unit_id,
                    s.operating_location_id,
                    s.customer_id AS party_id,
                    COALESCE(s.customer_name_snapshot, c.name, s.customer_id::text) AS party_name,
                    s.order_no,
                    s.order_date,
                    s.total AS original_gross,
                    COALESCE(( SELECT sum(sales_service_lines.amount) AS sum
                           FROM sales_service_lines
                          WHERE sales_service_lines.order_id = s.id), 0::numeric) AS original_net
                   FROM sales_orders s
                     LEFT JOIN customers c ON c.id = s.customer_id
                UNION ALL
                 SELECT 'supplier'::text AS text,
                    p.id,
                    p.company_id,
                    p.business_unit_id,
                    p.operating_location_id,
                    p.supplier_id,
                    COALESCE(p.supplier_name_snapshot, c.name, p.supplier_id::text) AS "coalesce",
                    p.order_no,
                    p.order_date,
                    p.total,
                    COALESCE(( SELECT sum(purchase_service_lines.amount) AS sum
                           FROM purchase_service_lines
                          WHERE purchase_service_lines.order_id = p.id), 0::numeric) AS "coalesce"
                   FROM purchase_orders p
                     LEFT JOIN suppliers c ON c.id = p.supplier_id
                )
         SELECT o.side,
            o.order_id,
            o.company_id,
            o.business_unit_id,
            o.operating_location_id,
            o.party_id,
            o.party_name,
            o.order_no,
            o.order_date,
            o.original_gross,
            o.original_net,
            g.journal_entry_id,
            g.kind,
            g.trip_ids,
            g.trip_no,
            j.entry_no,
            j.entry_date AS posted_date
           FROM orders o
             JOIN grouped g ON g.side = o.side AND g.order_id = o.order_id
             JOIN journal_entries j ON j.id = g.journal_entry_id AND j.status = 'posted'::text
          WHERE o.company_id = current_company_id() AND o.business_unit_id = current_business_unit_id() AND o.operating_location_id = current_operating_location_id() AND has_module_permission(o.company_id, 'transport'::text, 'view'::text)) existing
UNION ALL
 SELECT 'customer'::text AS side,
    s.id AS order_id,
    s.company_id,
    s.business_unit_id,
    s.operating_location_id,
    s.customer_id AS party_id,
    COALESCE(s.customer_name_snapshot, c.name, s.customer_id::text) AS party_name,
    s.order_no,
    s.order_date,
    s.total AS original_gross,
    COALESCE(( SELECT sum(sales_service_lines.amount) AS sum
           FROM sales_service_lines
          WHERE sales_service_lines.order_id = s.id), 0::numeric) AS original_net,
    d.journal_entry_id,
    d.document_kind AS kind,
    ARRAY[]::uuid[] AS trip_ids,
    COALESCE(( SELECT string_agg(DISTINCT transport_external_invoice_lines.reference_trip_no, ', '::text) AS string_agg
           FROM transport_external_invoice_lines
          WHERE transport_external_invoice_lines.sales_order_id = s.id), ''::text) AS trip_no,
    j.entry_no,
    j.entry_date AS posted_date
   FROM sales_orders s
     JOIN transport_customer_documents d ON d.sales_order_id = s.id
     JOIN journal_entries j ON j.id = d.journal_entry_id AND j.status = 'posted'::text
     LEFT JOIN customers c ON c.id = s.customer_id
  WHERE (EXISTS ( SELECT 1
           FROM transport_external_invoice_lines
          WHERE transport_external_invoice_lines.sales_order_id = s.id)) AND s.company_id = current_company_id() AND s.business_unit_id = current_business_unit_id() AND s.operating_location_id = current_operating_location_id() AND has_module_permission(s.company_id, 'transport'::text, 'view'::text);

CREATE OR REPLACE VIEW public.transport_driver_account_movements_before_salary_link AS
 WITH sources AS (
         SELECT 'accrual:'::text || a.id AS event_id,
            a.company_id,
            a.business_unit_id,
            a.operating_location_id,
            a.trip_id,
            s.employee_id,
            s.journal_entry_id,
            a.amount,
            'salary_accrual'::text AS event_type
           FROM transport_driver_accrual_attributions a
             JOIN employee_salary_accruals s ON s.id = a.accrual_id
        UNION ALL
         SELECT 'payment:'::text || a.id,
            a.company_id,
            a.business_unit_id,
            a.operating_location_id,
            a.trip_id,
            s.employee_id,
            s.journal_entry_id,
            - a.amount,
            'salary_payment'::text AS text
           FROM transport_driver_payment_attributions a
             JOIN employee_salary_payments s ON s.id = a.salary_payment_id
        UNION ALL
         SELECT 'month:'::text || c.id,
            c.company_id,
            c.business_unit_id,
            c.operating_location_id,
            NULL::uuid AS uuid,
            c.employee_id,
            c.journal_entry_id,
            c.trip_pay + c.allowance + c.bonus + c.other_earning - c.loan_deduction - c.other_deduction,
            'driver_month_closing'::text AS text
           FROM transport_driver_month_closings c
        ), posted AS (
         SELECT s.event_id,
            s.company_id,
            s.business_unit_id,
            s.operating_location_id,
            s.trip_id,
            s.employee_id,
            s.journal_entry_id,
            s.amount,
            s.event_type,
            public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,
            COALESCE(e.name, 'Payroll employee '::text || s.employee_id::text) AS party_name,
            j.entry_no,
            j.entry_date AS event_date,
            j.description,
            j.created_at,
            GREATEST(s.amount, 0::numeric) AS debit,
            GREATEST(- s.amount, 0::numeric) AS credit
           FROM sources s
             LEFT JOIN transport_trips t ON t.id = s.trip_id AND t.company_id = s.company_id AND t.business_unit_id = s.business_unit_id
             JOIN journal_entries j ON j.id = s.journal_entry_id AND j.status = 'posted'::text
             LEFT JOIN employees e ON e.id = s.employee_id AND e.company_id = s.company_id
          WHERE s.company_id = current_company_id() AND s.business_unit_id = current_business_unit_id() AND s.operating_location_id = current_operating_location_id() AND has_module_permission(s.company_id, 'transport'::text, 'view'::text)
        )
 SELECT posted.event_id,
    posted.company_id,
    posted.business_unit_id,
    posted.operating_location_id,
    posted.trip_id,
    posted.employee_id,
    posted.party_name,
    posted.journal_entry_id,
    posted.amount,
    posted.event_type,
    posted.trip_no,
    posted.entry_no,
    posted.event_date,
    posted.description,
    posted.created_at,
    posted.debit,
    posted.credit
   FROM posted
UNION ALL
 SELECT (p.event_id || ':reversal:'::text) || r.id AS event_id,
    p.company_id,
    p.business_unit_id,
    p.operating_location_id,
    p.trip_id,
    p.employee_id,
    p.party_name,
    r.id AS journal_entry_id,
    - p.amount AS amount,
    'reversal_'::text || p.event_type AS event_type,
    p.trip_no,
    r.entry_no,
    r.entry_date AS event_date,
    r.description,
    r.created_at,
    p.credit AS debit,
    p.debit AS credit
   FROM posted p
     JOIN journal_entries r ON r.reversal_of_entry_id = p.journal_entry_id AND r.status = 'posted'::text;

CREATE OR REPLACE VIEW public.transport_driver_month_trip_costs AS
 SELECT (('driver-month-trip:'::text || c.id::text) || ':'::text) || t.id::text AS event_id,
    c.company_id,
    c.business_unit_id,
    c.operating_location_id,
    c.id AS closing_id,
    c.journal_entry_id,
    t.id AS trip_id,
    public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,
    t.trip_date,
    c.employee_id,
    a.vehicle_id AS account_id,
    a.vehicle_no_snapshot AS account_name,
    round(COALESCE(t.driver_pay, 0::numeric), 2) AS amount,
    'Driver pay'::text AS category
   FROM transport_driver_month_closings c
     JOIN transport_drivers d ON d.company_id = c.company_id AND d.business_unit_id = c.business_unit_id AND d.employee_id = c.employee_id AND lower(COALESCE(d.driver_type, ''::text)) = 'company'::text AND d.supplier_id IS NULL
     JOIN transport_trips t ON t.company_id = c.company_id AND t.business_unit_id = c.business_unit_id AND t.operating_location_id = c.operating_location_id AND t.driver_id = d.id AND t.trip_date >= c.month AND t.trip_date < (c.month + '1 mon'::interval)::date AND COALESCE(t.driver_pay, 0::numeric) > 0::numeric
     JOIN journal_entries j ON j.id = c.journal_entry_id AND j.status = 'posted'::text
     JOIN LATERAL ( SELECT x.vehicle_id,
            x.vehicle_no_snapshot
           FROM transport_trip_assignments x
          WHERE x.trip_id = t.id AND x.company_id = c.company_id AND x.business_unit_id = c.business_unit_id AND x.effective_at <= t.trip_date::timestamp with time zone AND (x.ended_at IS NULL OR t.trip_date::timestamp with time zone < x.ended_at)
          ORDER BY x.effective_at DESC
         LIMIT 1) a ON a.vehicle_id IS NOT NULL
     JOIN transport_vehicle_ownership o ON o.id = t.ownership_id AND o.vehicle_id = a.vehicle_id AND o.company_id = c.company_id AND o.business_unit_id = c.business_unit_id AND (lower(COALESCE(o.owner_type, ''::text)) = ANY (ARRAY['company'::text, 'company_owned'::text, 'owned'::text, 'self'::text]))
  WHERE c.company_id = current_company_id() AND c.business_unit_id = current_business_unit_id() AND c.operating_location_id = current_operating_location_id() AND has_module_permission(c.company_id, 'transport'::text, 'view'::text);