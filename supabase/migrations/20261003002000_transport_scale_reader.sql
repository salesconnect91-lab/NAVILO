-- Additive reader; canonical financial view remains the accounting source.
-- Created with CLI; moved after the latest existing migration to preserve forward replay.
begin;
create index if not exists transport_register_scope_date_id_idx on public.transport_trips(company_id,business_unit_id,trip_date desc,trip_no desc,id);
create index if not exists transport_register_rents_trip_idx on public.transport_trip_supplier_rents(trip_id,id);
create index if not exists transport_register_rent_link_idx on public.transport_supplier_document_rents(rent_id);
create index if not exists transport_register_adjustment_rent_idx on public.transport_rate_adjustments(rent_id);

create function public.transport_register_query(
 p_limit integer default 500,p_offset integer default 0,p_filters jsonb default '{}',
 p_sort text default '',p_direction text default 'asc',p_option_key text default null,p_option_search text default ''
) returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();answer jsonb;needs_cells boolean;
begin
 if auth.uid() is null or c is null or b is null or not public.has_module_permission(c,'transport','view')
 then raise exception 'Transport view permission and active Company/Business Unit required';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>100000 then raise exception 'Invalid filters';end if;
 needs_cells:=p_option_key is not null or coalesce(p_sort,'')<>'' or coalesce(p_filters->>'search','')<>'' or exists(select 1 from jsonb_each(coalesce(p_filters->'columns','{}')) f where jsonb_array_length(f.value)>0);
 with scoped as materialized (
  select r.id,r.trip_date,r.payment_date,r.trip_no,r.status,r.financial_status,r.ppr_status,r.customer_name,r.driver_name,r.vehicle_no,r.po_do_job_no,r.from_location,r.to_location,jsonb_build_object('cells',case when needs_cells then jsonb_build_object(
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
'invoice_no',coalesce(nullif(coalesce((select s.order_no from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders s on s.id=d.sales_order_id where l.trip_id=r.id and not l.is_adjustment order by l.id limit 1),(select nullif(btrim(t.source_invoice_no),'') from public.transport_trips t where t.id=r.id)),''),'?'),
'sale_type',coalesce(nullif(r.sale_type,''),'?'),
'rent_driver',to_char(coalesce(r.billed_supplier_net,(select sum(coalesce(q.finalized_amount_snapshot,q.amount)) from public.transport_trip_supplier_rents q where q.trip_id=r.id),r.supplier_rent,r.owner_rent,0),'FM999,999,999,999,999,990.00'),
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
'rent_driver',coalesce(r.billed_supplier_net,(select sum(coalesce(q.finalized_amount_snapshot,q.amount)) from public.transport_trip_supplier_rents q where q.trip_id=r.id),r.supplier_rent,r.owner_rent,0),
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
'commission',coalesce(r.commission_paid_net,0))) vals from public.transport_financial_register r
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
  select to_jsonb(r)||jsonb_build_object('supplier_rent',chosen.rent,'invoice_no',coalesce(
   (select so.order_no from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders so on so.id=d.sales_order_id where l.trip_id=r.id and not l.is_adjustment order by l.id limit 1),
   (select nullif(btrim(t.source_invoice_no),'') from public.transport_trips t where t.id=r.id))) row,chosen.ordinal
  from chosen join public.transport_financial_register r on r.id=chosen.id and r.company_id=c and r.business_unit_id=b
 ), sums as (select jsonb_build_object('rent_driver',coalesce(sum((x.vals->'numbers'->>'rent_driver')::numeric),0),'supplier_paid',coalesce(sum((x.vals->'numbers'->>'supplier_paid')::numeric),0),'supplier_balance',coalesce(sum((x.vals->'numbers'->>'supplier_balance')::numeric),0),'supplier_credit',coalesce(sum((x.vals->'numbers'->>'supplier_credit')::numeric),0),'driver_pay',coalesce(sum((x.vals->'numbers'->>'driver_pay')::numeric),0),'driver_paid',coalesce(sum((x.vals->'numbers'->>'driver_paid')::numeric),0),'driver_balance',coalesce(sum((x.vals->'numbers'->>'driver_balance')::numeric),0),'amount',coalesce(sum((x.vals->'numbers'->>'amount')::numeric),0),'company_rate',coalesce(sum((x.vals->'numbers'->>'company_rate')::numeric),0),'received_company',coalesce(sum((x.vals->'numbers'->>'received_company')::numeric),0),'remaining_company',coalesce(sum((x.vals->'numbers'->>'remaining_company')::numeric),0),'customer_credit',coalesce(sum((x.vals->'numbers'->>'customer_credit')::numeric),0),'profit',coalesce(sum((x.vals->'numbers'->>'profit')::numeric),0),'commission',coalesce(sum((x.vals->'numbers'->>'commission')::numeric),0)) totals from filtered x),
 options as (select distinct x.vals->'cells'->>p_option_key value from filtered x
  where position(lower(coalesce(p_option_search,'')) in lower(x.vals->'cells'->>p_option_key))>0
  order by value limit 200),
 statuses as (select distinct 'trip:'||x.status key,'Trip · '||x.status label from scoped x
  union select distinct 'financial:'||x.financial_status,'Financial · '||x.financial_status from scoped x)
 select case when p_option_key is not null then jsonb_build_object('options',coalesce((select jsonb_agg(value) from options),'[]'))
 else jsonb_build_object('rows',coalesce((select jsonb_agg(row order by ordinal) from page),'[]'),'count',(select count(*) from filtered),
  'completed',(select count(*) from filtered where financial_status in ('Complete','Closed')),
  'paper_pending',(select count(*) from filtered where ppr_status is distinct from 'received'),
  'statuses',coalesce((select jsonb_agg(to_jsonb(statuses)) from statuses),'[]'),
  'totals',coalesce((select totals from sums),'{}')) end into answer;
 return answer;
end $$;
revoke all on function public.transport_register_query(integer,integer,jsonb,text,text,text,text) from public,anon;
grant execute on function public.transport_register_query(integer,integer,jsonb,text,text,text,text) to authenticated;

-- Only import metadata lives here. Trip/accounting creation still uses the existing coordinator.
create table public.transport_trip_import_jobs(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,created_by uuid not null,
 source_hash text not null,file_name text not null,manifest jsonb not null,completed_batches integer not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(company_id,business_unit_id,source_hash));
alter table public.transport_trip_import_jobs enable row level security;
revoke all on public.transport_trip_import_jobs from public,anon,authenticated;

create function public.transport_prepare_trip_import(p_source_hash text,p_file_name text,p_manifest jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();job public.transport_trip_import_jobs;total integer;
begin
 if auth.uid() is null or c is null or b is null or not public.has_module_permission(c,'transport','create')
 or not public.has_transport_action_permission(c,'trip_create') then raise exception 'Trip create permission and active workspace required';end if;
 if p_source_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_manifest) is distinct from 'array'
 or jsonb_array_length(p_manifest) not between 1 and 200 or octet_length(p_manifest::text)>500000
 then raise exception 'Invalid import manifest';end if;
 if exists(select 1 from jsonb_array_elements(p_manifest) x where jsonb_typeof(x)<>'array' or jsonb_array_length(x) not between 1 and 100)
 then raise exception 'Each import batch requires 1–100 source rows';end if;
 select count(*) into total from jsonb_array_elements(p_manifest) a cross join lateral jsonb_array_elements_text(a) n;
 if total>20000 or exists(select 1 from jsonb_array_elements(p_manifest) a cross join lateral jsonb_array_elements_text(a) n where n !~ '^[0-9]+$' or n::numeric<2)
 or (select count(distinct n) from jsonb_array_elements(p_manifest) a cross join lateral jsonb_array_elements_text(a) n)<>total
 then raise exception 'Import requires up to 20,000 unique source row numbers';end if;
 perform pg_advisory_xact_lock(hashtextextended('transport-import:'||c::text||b::text||p_source_hash,0));
 select * into job from public.transport_trip_import_jobs where company_id=c and business_unit_id=b and source_hash=p_source_hash;
 if found then
  if job.created_by is distinct from auth.uid() then raise exception 'This file already has an import in this workspace by another user';end if;
  if job.manifest is distinct from p_manifest then raise exception 'This file already has a different import selection. Resume its saved job; use a corrected file for rejected rows.';end if;
 else
  insert into public.transport_trip_import_jobs(company_id,business_unit_id,created_by,source_hash,file_name,manifest)
  values(c,b,auth.uid(),p_source_hash,left(p_file_name,255),p_manifest) returning * into job;
 end if;
 return jsonb_build_object('id',job.id,'completed',job.completed_batches);
end $$;
create function public.transport_import_trip_batch(p_job_id uuid,p_batch integer,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.transport_trip_import_jobs;request uuid;answer jsonb;c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();
begin
 if auth.uid() is null or c is null or b is null then raise exception 'Active workspace required';end if;
 select * into job from public.transport_trip_import_jobs where id=p_job_id and company_id=c and business_unit_id=b and created_by=auth.uid() for update;
 if not found then raise exception 'Import job does not belong to this user/workspace';end if;
 if p_batch is null or p_batch<0 or p_batch>=jsonb_array_length(job.manifest) or p_batch>job.completed_batches
 or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<>jsonb_array_length(job.manifest->p_batch)
 then raise exception 'Invalid batch; resume the next incomplete batch';end if;
 request:=md5('transport-import:'||job.id::text||':'||p_batch::text)::uuid;
 answer:=public.transport_create_trips(request,c,b,p_rows);
 update public.transport_trip_import_jobs set completed_batches=greatest(completed_batches,p_batch+1),updated_at=now() where id=job.id;
 return answer;
end $$;
revoke all on function public.transport_prepare_trip_import(text,text,jsonb),public.transport_import_trip_batch(uuid,integer,jsonb) from public,anon;
grant execute on function public.transport_prepare_trip_import(text,text,jsonb),public.transport_import_trip_batch(uuid,integer,jsonb) to authenticated;

create function public.transport_bulk_rate_page(p_side text,p_limit integer default 500,p_offset integer default 0,p_filters jsonb default '{}')
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();answer jsonb;
begin
 if auth.uid() is null or c is null or b is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active workspace required';end if;
 if p_side not in ('customer','supplier') or jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>100000 then raise exception 'Invalid bulk filters';end if;
 with base as materialized (
  select t.id,t.trip_no,t.trip_date,t.status trip_status,t.customer_id,coalesce(cu.name,t.customer_name_snapshot) customer_name,
   v.vehicle_no,dr.driver_name,t.from_location,t.to_location,t.po_do_job_no,t.sale_type,t.customer_rate,t.customer_rate_state,
   t.sales_order_id,t.owner_supplier_id,t.owner_name_snapshot,t.supplier_rent,t.owner_rent,t.rent_state,t.rent_finalized_at,
   (t.sales_order_id is not null or exists(select 1 from public.transport_customer_document_trips l where l.trip_id=t.id)) customer_rate_locked,
   case when p_side='customer' then (select r.billed_customer_net from public.transport_financial_register r where r.id=t.id) end billed_customer_net
  from public.transport_trips t left join public.customers cu on cu.id=t.customer_id
  left join public.transport_vehicles v on v.id=t.vehicle_id left join public.transport_drivers dr on dr.id=t.driver_id
  where t.company_id=c and t.business_unit_id=b
   and (coalesce(p_filters->>'initialTrip','')='' or t.id::text=p_filters->>'initialTrip')
   and (coalesce(p_filters->>'status','')='' or t.status=p_filters->>'status')
   and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(concat_ws(' ',t.trip_no,t.po_do_job_no,cu.name,t.customer_name_snapshot,dr.driver_name,v.vehicle_no,t.from_location,t.to_location)))>0)
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
    where f.value<>'' and position(lower(btrim(f.value)) in lower(coalesce(x.cell_values->>f.key,'')))=0)
 ), page as (select row from filtered order by trip_date desc,trip_no desc,key
  limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(row) from page),'[]'),'count',(select count(*) from filtered),
  'amount',coalesce((select sum(case when p_side='supplier' then (row->>'supplier_rent')::numeric when (row->>'posted')::boolean then (row->>'billed_customer_net')::numeric else (row->>'customer_rate')::numeric end) from filtered),0),
  'statuses',coalesce((select jsonb_agg(status) from (select distinct trip_status status from base) s),'[]')) into answer;
 return answer;
end $$;
revoke all on function public.transport_bulk_rate_page(text,integer,integer,jsonb) from public,anon;
grant execute on function public.transport_bulk_rate_page(text,integer,integer,jsonb) to authenticated;

create function public.transport_audit_page(p_limit integer default 500,p_offset integer default 0,p_search text default '')
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();answer jsonb;
begin
 if auth.uid() is null or c is null or b is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active workspace required';end if;
 with filtered as materialized (
  select a.*,t.trip_no from public.transport_trip_audit a left join public.transport_trips t on t.id=a.trip_id and t.company_id=c and t.business_unit_id=b
  where a.company_id=c and a.business_unit_id=b
   and (coalesce(p_search,'')='' or position(lower(p_search) in lower(concat_ws(' ',t.trip_no,a.event_type,a.changed_by,a.new_data::text)))>0)
 ), page as (select * from filtered order by id desc limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'count',(select count(*) from filtered)) into answer;
 return answer;
end $$;
revoke all on function public.transport_audit_page(integer,integer,text) from public,anon;
grant execute on function public.transport_audit_page(integer,integer,text) to authenticated;

-- Read reporting views under one checked workspace scope instead of repeatedly
-- expanding every underlying table's RLS policy through the financial joins.
create function public.transport_party_report_page(p_kind text,p_limit integer default 1000,p_offset integer default 0)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view')
 then raise exception 'Transport view permission and active Company/Business Unit/branch required';end if;
 if p_kind='canonical' and not public.has_module_permission(c,'accounting','view') then raise exception 'Accounting view permission required';end if;
 if p_kind='documents' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select * from public.transport_party_documents where company_id=c and business_unit_id=b and operating_location_id=loc order by side,order_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 elsif p_kind='movements' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select * from public.transport_party_movements where company_id=c and business_unit_id=b and operating_location_id=loc order by event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 elsif p_kind='canonical' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select * from public.transport_canonical_party_movements where company_id=c and business_unit_id=b and operating_location_id=loc order by event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 else raise exception 'Invalid report kind';end if;
 return answer;
end $$;
revoke all on function public.transport_party_report_page(text,integer,integer) from public,anon;
grant execute on function public.transport_party_report_page(text,integer,integer) to authenticated;
commit;
