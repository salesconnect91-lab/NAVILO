-- Derived Transport read cache only. Financial source records are never written.
create table public.transport_register_snapshots (
 company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 permission_mask smallint not null check(permission_mask between 0 and 3),
 built boolean not null default false,refreshed_at timestamptz,
 primary key(company_id,business_unit_id,operating_location_id,permission_mask)
);
create table public.transport_register_snapshot_rows (
 company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 permission_mask smallint not null,trip_id uuid not null,data jsonb not null,
 primary key(company_id,business_unit_id,operating_location_id,permission_mask,trip_id)
);
create sequence public.transport_register_dirty_version;
create table public.transport_register_dirty_rows (
 company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 permission_mask smallint not null,trip_id uuid not null,
 revision bigint not null default nextval('public.transport_register_dirty_version'),
 primary key(company_id,business_unit_id,operating_location_id,permission_mask,trip_id)
);
alter table public.transport_register_snapshots enable row level security;
alter table public.transport_register_snapshot_rows enable row level security;
alter table public.transport_register_dirty_rows enable row level security;
revoke all on public.transport_register_snapshots,public.transport_register_snapshot_rows,public.transport_register_dirty_rows from public,anon,authenticated;
revoke all on sequence public.transport_register_dirty_version from public,anon,authenticated;

create type public.transport_register_snapshot_item as (
 id uuid,trip_date date,payment_date date,trip_no text,full_row jsonb,
 status text,financial_status text,ppr_status text,customer_name text,driver_name text,
 vehicle_no text,po_do_job_no text,from_location text,to_location text,
 n_customer_charges numeric,n_rent_driver numeric,n_supplier_charges numeric,
 n_supplier_paid numeric,n_supplier_balance numeric,n_supplier_credit numeric,
 n_driver_pay numeric,n_driver_paid numeric,n_driver_balance numeric,n_amount numeric,
 n_company_rate numeric,n_received_company numeric,n_remaining_company numeric,
 n_customer_credit numeric,n_profit numeric,n_commission numeric,
 invoice_no_raw text,supplier_invoice_no_raw text,vals jsonb
);

-- Clone the canonical formulas, limiting document scope BEFORE weighting.
-- Every invoice line is retained, including lines belonging to other Trips.
do $source$
declare
 summary_definition text:=pg_get_viewdef('public.transport_trip_financial_summary'::regclass,true);
 register_definition text:=pg_get_viewdef('public.transport_financial_register'::regclass,true);
 opening_definition text:=pg_get_viewdef('public.transport_historical_payment_effective'::regclass,true);
 prefix text:=$prefix$with register_selected_ids as materialized (
  select id from public.transport_trips where company_id=p_company and business_unit_id=p_unit
   and operating_location_id=p_location and (p_ids is null or id=any(p_ids))
 ), register_selected_orders as materialized (
  select distinct 'customer'::text side,d.sales_order_id order_id
  from register_selected_ids x join public.transport_customer_document_trips l on l.trip_id=x.id
  join public.transport_customer_documents d on d.id=l.document_id
  union
  select 'supplier',d.purchase_order_id
  from register_selected_ids x join public.transport_supplier_document_rents l on l.trip_id=x.id
  join public.transport_supplier_documents d on d.id=l.document_id
  union
  select 'supplier',l.purchase_order_id from register_selected_ids x
  join public.transport_service_cost_links l on l.trip_id=x.id
 ) $prefix$;
 scoped_balances text:=$balances$FROM public._transport_service_balances_for_orders(
  coalesce((select array_agg(order_id) from register_selected_orders where side='customer'),'{}'::uuid[]),
  coalesce((select array_agg(order_id) from register_selected_orders where side='supplier'),'{}'::uuid[])
 ) transport_service_document_balances$balances$;
begin
 if position('FROM transport_service_document_balances_fast transport_service_document_balances' in summary_definition)=0
 or position('JOIN transport_trip_financial_summary f ON f.id = t.id' in register_definition)=0
 or position('FROM transport_historical_operational_mapping m' in opening_definition)=0
 then raise exception 'Canonical snapshot source changed; inspect before applying';end if;
 summary_definition:=replace(summary_definition,'FROM transport_service_document_balances_fast transport_service_document_balances',scoped_balances);
 summary_definition:=replace(summary_definition,'FROM transport_trips t',
  'FROM transport_trips t JOIN register_selected_ids scoped_id ON scoped_id.id=t.id');
 opening_definition:=replace(opening_definition,'FROM transport_historical_operational_mapping m',
  'FROM (SELECT * FROM public.transport_historical_operational_mapping WHERE trip_id IN (SELECT id FROM register_selected_ids)) m');
 opening_definition:=replace(opening_definition,'FROM transport_opening_invoice_lines',
  'FROM (SELECT * FROM public.transport_opening_invoice_lines WHERE trip_id IN (SELECT id FROM register_selected_ids)) transport_opening_invoice_lines');
 opening_definition:=regexp_replace(btrim(opening_definition),';[[:space:]]*$','');
 summary_definition:=regexp_replace(btrim(summary_definition),';[[:space:]]*$','');
 register_definition:=replace(register_definition,'FROM transport_trips t',
  'FROM transport_trips t JOIN register_selected_ids scoped_id ON scoped_id.id=t.id');
 register_definition:=replace(register_definition,'JOIN transport_trip_financial_summary f ON f.id = t.id',
  'JOIN ('||summary_definition||') f ON f.id=t.id');
 register_definition:=replace(register_definition,'LEFT JOIN transport_historical_payment_effective hp ON',
  'LEFT JOIN ('||opening_definition||') hp ON');
 execute format('create function public._transport_register_snapshot_source(p_company uuid,p_unit uuid,p_location uuid,p_ids uuid[]) returns setof public.transport_financial_register language sql stable security invoker as %L',prefix||register_definition);
 revoke all on function public._transport_register_snapshot_source(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;
end $source$;

-- Populate only missing/dirty Trips, using the original Register projection.
do $builder$
declare
 definition text:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 query_text text;
 start_position integer;
 end_position integer;
 header text:=$header$create function public._transport_register_snapshot_fill(p_ids uuid[]) returns void
 language plpgsql volatile security invoker set search_path to public,pg_temp as $body$
 declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');
 mask smallint:=(case when cv then 1 else 0 end)+(case when sv then 2 else 0 end);
 p_filters jsonb:='{}';needs_cells boolean:=true;needs_text_cells boolean:=true;needs_invoice_cells boolean:=true;
 begin
 $header$;
begin
 start_position:=position(' with register_source as materialized (' in definition);
 end_position:=position('), filtered_without_status as materialized (' in definition);
 if start_position=0 or end_position<=start_position then raise exception 'Register projection baseline changed';end if;
 query_text:=substr(definition,start_position,end_position-start_position)||')';
 query_text:=replace(query_text,'public._transport_linked_register_source(c,b,loc)',
   'public._transport_register_snapshot_source(c,b,loc,p_ids)');
 query_text:=replace(query_text,'null::public.transport_financial_register full_row','to_jsonb(r) full_row');
 execute header||query_text||$insert$
 insert into public.transport_register_snapshot_rows(company_id,business_unit_id,operating_location_id,permission_mask,trip_id,data)
 select c,b,loc,mask,x.id,to_jsonb(x) from scoped x
 on conflict(company_id,business_unit_id,operating_location_id,permission_mask,trip_id)
 do update set data=excluded.data;
 end $body$;$insert$;
 revoke all on function public._transport_register_snapshot_fill(uuid[]) from public,anon,authenticated;
end $builder$;

create function public._transport_register_snapshot_sync(p_refresh boolean) returns void
language plpgsql volatile security invoker set search_path to public,pg_temp as $body$
declare
 c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');
 mask smallint:=(case when cv then 1 else 0 end)+(case when sv then 2 else 0 end);
 is_built boolean;tokens jsonb;ids uuid[];
begin
 if not p_refresh and exists(select 1 from public.transport_register_snapshots where company_id=c and business_unit_id=b and operating_location_id=loc and permission_mask=mask and built) then return;end if;
 insert into public.transport_register_snapshots(company_id,business_unit_id,operating_location_id,permission_mask)
 values(c,b,loc,mask) on conflict do nothing;
 select built into is_built from public.transport_register_snapshots
 where company_id=c and business_unit_id=b and operating_location_id=loc and permission_mask=mask for update;
 if is_built and not p_refresh then return;end if;
 select jsonb_agg(jsonb_build_object('id',trip_id,'revision',revision)),array_agg(trip_id)
 into tokens,ids from public.transport_register_dirty_rows
 where company_id=c and business_unit_id=b and operating_location_id=loc and permission_mask=mask;
 if is_built and ids is null then return;end if;
 if not is_built then ids:=null;end if;
 perform public._transport_register_snapshot_fill(ids);
 delete from public.transport_register_snapshot_rows cached
 where cached.company_id=c and cached.business_unit_id=b and cached.operating_location_id=loc and cached.permission_mask=mask
 and (ids is null or cached.trip_id=any(ids))
 and not exists(select 1 from public.transport_trips t where t.id=cached.trip_id
  and t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc);
 -- Match exact captured versions: a concurrent save cannot be consumed by an
 -- older refresh, even if it commits while the snapshot is being rebuilt.
 delete from public.transport_register_dirty_rows dirty
 using jsonb_to_recordset(coalesce(tokens,'[]'::jsonb)) token(id uuid,revision bigint)
 where dirty.company_id=c and dirty.business_unit_id=b and dirty.operating_location_id=loc and dirty.permission_mask=mask
 and dirty.trip_id=token.id and dirty.revision=token.revision;
 update public.transport_register_snapshots set built=true,refreshed_at=clock_timestamp()
 where company_id=c and business_unit_id=b and operating_location_id=loc and permission_mask=mask;
end $body$;
revoke all on function public._transport_register_snapshot_sync(boolean) from public,anon,authenticated;
-- Versioned dirty queues are metadata only; source operations remain canonical.
create function public._transport_register_dirty_scope(p_c uuid,p_b uuid,p_l uuid,p_trip uuid) returns void
language sql volatile security definer set search_path to public,pg_temp as $$
 insert into public.transport_register_dirty_rows(company_id,business_unit_id,operating_location_id,permission_mask,trip_id)
 select p_c,p_b,p_l,mask,p_trip from generate_series(0,3) mask
 where p_c is not null and p_b is not null and p_l is not null and p_trip is not null
 on conflict(company_id,business_unit_id,operating_location_id,permission_mask,trip_id)
 do update set revision=nextval('public.transport_register_dirty_version');
$$;
create function public._transport_register_dirty_trips(p_ids uuid[]) returns void
language sql volatile security definer set search_path to public,pg_temp as $$
 insert into public.transport_register_dirty_rows(company_id,business_unit_id,operating_location_id,permission_mask,trip_id)
 select distinct t.company_id,t.business_unit_id,t.operating_location_id,mask,t.id
 from public.transport_trips t cross join generate_series(0,3) mask
 where t.id=any(p_ids) and t.operating_location_id is not null
 on conflict(company_id,business_unit_id,operating_location_id,permission_mask,trip_id)
 do update set revision=nextval('public.transport_register_dirty_version');
$$;
create function public._transport_register_dirty_orders(p_side text,p_ids uuid[]) returns void
language plpgsql volatile security definer set search_path to public,pg_temp as $$
declare trips uuid[];
begin
 if p_side='customer' then
  select array_agg(distinct trip_id) into trips from (
   select l.trip_id from public.transport_customer_documents d
   join public.transport_customer_document_trips l on l.document_id=d.id where d.sales_order_id=any(p_ids)
   union select id from public.transport_trips where sales_order_id=any(p_ids)
  ) x;
 else
  select array_agg(distinct trip_id) into trips from (
   select l.trip_id from public.transport_supplier_documents d
   join public.transport_supplier_document_rents l on l.document_id=d.id where d.purchase_order_id=any(p_ids)
   union select trip_id from public.transport_service_cost_links where purchase_order_id=any(p_ids)
  ) x;
 end if;
 perform public._transport_register_dirty_trips(trips);
end $$;
create function public._transport_register_dirty_journals(p_ids uuid[]) returns void
language plpgsql volatile security definer set search_path to public,pg_temp as $$
declare event record;trips uuid[];
begin
 for event in
  select 'customer'::text side,sales_order_id order_id from public.transport_customer_documents where journal_entry_id=any(p_ids)
  union select 'supplier',purchase_order_id from public.transport_supplier_documents where journal_entry_id=any(p_ids)
  union select 'customer',sales_order_id from public.invoice_payment_allocations where journal_entry_id=any(p_ids)
  union select 'supplier',purchase_order_id from public.purchase_payment_allocations where journal_entry_id=any(p_ids)
  union select side,order_id from public.transport_service_refunds where journal_entry_id=any(p_ids)
  union select l.side,l.order_id from public.return_notes n join public.transport_service_note_lines l on l.note_id=n.id where n.journal_entry_id=any(p_ids)
  union select 'supplier',purchase_order_id from public.transport_service_cost_links where journal_entry_id=any(p_ids)
 loop perform public._transport_register_dirty_orders(event.side,array[event.order_id]);end loop;
 select array_agg(distinct trip_id) into trips from (
  select a.trip_id from public.transport_driver_accrual_attributions a
  join public.employee_salary_accruals p on p.id=a.accrual_id where p.journal_entry_id=any(p_ids)
  union select a.trip_id from public.transport_driver_payment_attributions a
  join public.employee_salary_payments p on p.id=a.salary_payment_id where p.journal_entry_id=any(p_ids)
  union select a.trip_id from public.transport_opening_invoice_allocations a where a.journal_entry_id=any(p_ids)
 ) x;
 perform public._transport_register_dirty_trips(trips);
end $$;
create function public._transport_register_dirty_event() returns trigger
language plpgsql volatile security definer set search_path to public,pg_temp as $$
declare payload jsonb;row_data jsonb;ids uuid[];event record;linked_order uuid;record_id uuid;
begin
 for payload in select value from jsonb_array_elements(
  case when tg_op='INSERT' then jsonb_build_array(to_jsonb(new))
       when tg_op='DELETE' then jsonb_build_array(to_jsonb(old))
       else jsonb_build_array(to_jsonb(old),to_jsonb(new)) end)
 loop
  record_id:=case when payload->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (payload->>'id')::uuid end;
  if tg_table_name='transport_trips' then
   perform public._transport_register_dirty_scope((payload->>'company_id')::uuid,(payload->>'business_unit_id')::uuid,(payload->>'operating_location_id')::uuid,record_id);
  end if;
  if payload ? 'trip_id' then perform public._transport_register_dirty_trips(array[(payload->>'trip_id')::uuid]);end if;
  if payload ? 'sales_order_id' then perform public._transport_register_dirty_orders('customer',array[(payload->>'sales_order_id')::uuid]);end if;
  if payload ? 'purchase_order_id' then perform public._transport_register_dirty_orders('supplier',array[(payload->>'purchase_order_id')::uuid]);end if;
  if tg_table_name='sales_orders' then perform public._transport_register_dirty_orders('customer',array[record_id]);end if;
  if tg_table_name='purchase_orders' then perform public._transport_register_dirty_orders('supplier',array[record_id]);end if;
  if tg_table_name in ('sales_service_lines','purchase_service_lines') then
   perform public._transport_register_dirty_orders(case when tg_table_name='sales_service_lines' then 'customer' else 'supplier' end,array[(payload->>'order_id')::uuid]);
  end if;
  if tg_table_name in ('transport_service_note_lines','transport_service_refunds') then
   perform public._transport_register_dirty_orders(payload->>'side',array[(payload->>'order_id')::uuid]);
  end if;
  if tg_table_name='transport_customer_document_trips' then
   select sales_order_id into linked_order from public.transport_customer_documents where id=(payload->>'document_id')::uuid;
   perform public._transport_register_dirty_orders('customer',array[linked_order]);
  end if;
  if tg_table_name='transport_supplier_document_rents' then
   select purchase_order_id into linked_order from public.transport_supplier_documents where id=(payload->>'document_id')::uuid;
   perform public._transport_register_dirty_orders('supplier',array[linked_order]);
  end if;
  if tg_table_name='journal_entries' then
   perform public._transport_register_dirty_journals(array[record_id,(payload->>'reversal_of_entry_id')::uuid]);
  end if;
  if tg_table_name='return_notes' then
   for event in select distinct side,order_id from public.transport_service_note_lines where note_id=record_id
   loop perform public._transport_register_dirty_orders(event.side,array[event.order_id]);end loop;
  end if;
  if tg_table_name in ('transport_opening_invoice_documents','transport_register_invoice_conversions') then
   select array_agg(trip_id) into ids from public.transport_opening_invoice_lines
   where document_id=case when tg_table_name='transport_opening_invoice_documents' then record_id else (payload->>'document_id')::uuid end;
   perform public._transport_register_dirty_trips(ids);
  end if;
  if tg_table_name='employee_salary_accruals' then
   select array_agg(trip_id) into ids from public.transport_driver_accrual_attributions where accrual_id=record_id;
   perform public._transport_register_dirty_trips(ids);
  end if;
  if tg_table_name='employee_salary_payments' then
   select array_agg(trip_id) into ids from public.transport_driver_payment_attributions where salary_payment_id=record_id;
   perform public._transport_register_dirty_trips(ids);
  end if;
  if tg_table_name in ('customers','suppliers','transport_vehicles','transport_drivers','transport_truck_types') then
   select array_agg(t.id) into ids from public.transport_trips t
   left join public.transport_vehicles v on v.id=t.vehicle_id
   where (tg_table_name='customers' and t.customer_id=record_id)
      or (tg_table_name='suppliers' and (t.owner_supplier_id=record_id or v.supplier_id=record_id))
      or (tg_table_name='transport_vehicles' and t.vehicle_id=record_id)
      or (tg_table_name='transport_drivers' and t.driver_id=record_id)
      or (tg_table_name='transport_truck_types' and (t.truck_type_id=record_id or v.truck_type_id=record_id));
   perform public._transport_register_dirty_trips(ids);
  end if;
 end loop;
 return null;
end $$;
revoke all on function public._transport_register_dirty_scope(uuid,uuid,uuid,uuid),
 public._transport_register_dirty_trips(uuid[]),public._transport_register_dirty_orders(text,uuid[]),
 public._transport_register_dirty_journals(uuid[]),public._transport_register_dirty_event() from public,anon,authenticated;

do $triggers$
declare relation_name text;
begin
 foreach relation_name in array array[
 'transport_trips','transport_trip_customer_charges','transport_trip_supplier_charges','transport_trip_supplier_rents',
 'transport_customer_document_trips','transport_customer_documents','transport_supplier_document_rents','transport_supplier_documents',
 'sales_orders','purchase_orders','sales_service_lines','purchase_service_lines','invoice_payment_allocations','purchase_payment_allocations',
 'return_notes','transport_service_note_lines','transport_service_refunds','journal_entries',
 'employee_salary_accruals','employee_salary_payments','transport_driver_accrual_attributions','transport_driver_payment_attributions','transport_service_cost_links',
 'transport_opening_invoice_lines','transport_opening_invoice_documents','transport_opening_invoice_allocations','transport_register_invoice_conversions',
 'transport_historical_trip_identity','transport_historical_operational_mapping','transport_historical_payment_snapshots','transport_ppr_receiver_corrections',
 'transport_trip_audit','customers','suppliers','transport_vehicles','transport_drivers','transport_truck_types'
 ] loop
  execute format('create trigger transport_register_cache_dirty after insert or update or delete on public.%I for each row execute function public._transport_register_dirty_event()',relation_name);
 end loop;
end $triggers$;
-- Keep the original 28-column query contract, full-dataset filtering/sorting,
-- totals, pagination, financial masking and export permission checks.
do $query$
declare
 definition text:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 header text;tail text;raw_filters text;replacement text;
 start_position integer;end_position integer;
begin
 execute replace(definition,'FUNCTION public.transport_register_query(', 'FUNCTION public._transport_register_canonical_query(');
 revoke all on function public._transport_register_canonical_query(integer,integer,jsonb,text,text,text,text) from public,anon,authenticated;
 header:=left(definition,position(' opening_read:=' in definition)-1);
 if length(header)<100 then raise exception 'Register authorization header changed';end if;
 header:=replace(header,' STABLE SECURITY DEFINER',' VOLATILE SECURITY DEFINER');
 header:=replace(header,'answer jsonb;','answer jsonb;cache_mask smallint;');
 start_position:=position('  where true' in substr(definition,position('), scoped as materialized (' in definition)));
 raw_filters:=substr(definition,position('), scoped as materialized (' in definition));
 raw_filters:=substr(raw_filters,start_position+length('  where true'));
 raw_filters:=left(raw_filters,position(' ), filtered_without_status as materialized (' in raw_filters)-1);
 raw_filters:=replace(raw_filters,'r.','x.');
 tail:=substr(definition,position('), filtered_without_status as materialized (' in definition)+1);
 start_position:=position('), balance_page_ids as materialized (' in tail);
 end_position:=position('), page as (' in substr(tail,start_position));
 if start_position=0 or end_position=0 then raise exception 'Register page projection changed';end if;
 tail:=left(tail,start_position-1)||substr(tail,start_position+end_position-1);
 tail:=replace(tail,'from chosen join register_source fr on fr.id=chosen.id left join page_document_balances pb on pb.trip_id=chosen.id',
  'from chosen cross join lateral jsonb_populate_record(null::public.transport_financial_register,chosen.full_row) fr');
 start_position:=position(' left join lateral (' in substr(tail,position('), page as (' in tail)));
 if start_position=0 then raise exception 'Page invoice joins changed';end if;
 start_position:=position('), page as (' in tail)+start_position-1;
 end_position:=position(' ), filtered_agg as materialized (' in tail);
 if end_position=0 then raise exception 'Register totals projection changed';end if;
 tail:=left(tail,start_position-1)||substr(tail,end_position);
 tail:=replace(tail,'coalesce(ci_page.order_no,chosen.invoice_no)','chosen.invoice_no');
 tail:=replace(tail,'coalesce(si_page.order_nos,chosen.supplier_invoice_no)','chosen.supplier_invoice_no');
 tail:=replace(tail,'coalesce(pb.customer_outstanding_gross,fr.customer_outstanding_gross)','fr.customer_outstanding_gross');
 tail:=replace(tail,'coalesce(pb.supplier_outstanding_gross,fr.supplier_outstanding_gross)','fr.supplier_outstanding_gross');
 replacement:=$replacement$
 if p_option_key is null then
  answer:=answer||jsonb_build_object(
   'rows_order',coalesce((select jsonb_agg(value->>'id' order by ord) from jsonb_array_elements(answer->'rows') with ordinality r(value,ord)),'[]'),
   'row_versions',coalesce((select jsonb_object_agg(value->>'id',md5(value::text)) from jsonb_array_elements(answer->'rows') r(value)),'{}')
  );
  if jsonb_typeof(p_filters->'known_rows')='object' then
   answer:=jsonb_set(answer,'{rows}',coalesce((
    select jsonb_agg(value order by ord)
    from jsonb_array_elements(answer->'rows') with ordinality r(value,ord)
    where p_filters->'known_rows'->>(value->>'id') is distinct from md5(value::text)
   ),'[]'))||jsonb_build_object('rows_delta',true);
  end if;
 end if;
 return answer||jsonb_build_object('permissions',jsonb_build_object('customer',cv,'supplier',sv));$replacement$;
 tail:=replace(tail,$return$return answer||jsonb_build_object('permissions',jsonb_build_object('customer',cv,'supplier',sv));$return$,replacement);
 execute header||$scoped$
 if coalesce(p_filters->>'use_cache','false')<>'true' then
  return public._transport_register_canonical_query(p_limit,p_offset,p_filters,p_sort,p_direction,p_option_key,p_option_search);
 end if;
 cache_mask:=(case when cv then 1 else 0 end)+(case when sv then 2 else 0 end);
 perform public._transport_register_snapshot_sync(coalesce(p_filters->>'refresh','false')='true');
 with scoped as materialized (
  select x.* from public.transport_register_snapshot_rows cached
  cross join lateral jsonb_populate_record(null::public.transport_register_snapshot_item,cached.data) x
  where cached.company_id=c and cached.business_unit_id=b and cached.operating_location_id=loc and cached.permission_mask=cache_mask
 $scoped$||raw_filters||')'||tail;
end $query$;
