begin;
-- Keep the existing bulk-rate query semantics; correct only the nested supplier-rent Trip reference.
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
   'rent',case when r.id is not null then to_jsonb(r)||jsonb_build_object('trip_id',t.id,'amount',r.amount+a.difference,'finalized_amount_snapshot',r.amount+a.difference) end),
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
revoke all on function public.transport_bulk_rate_page(text,integer,integer,jsonb) from public,anon;
grant execute on function public.transport_bulk_rate_page(text,integer,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
