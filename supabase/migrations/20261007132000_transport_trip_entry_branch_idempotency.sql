create or replace function public.transport_create_trips(p_request_id uuid,p_company_id uuid,p_business_unit_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 saved public.transport_trip_entry_requests%rowtype;row_data jsonb;body_hash text;answer jsonb:='[]';
 customer public.customers%rowtype;vehicle public.transport_vehicles%rowtype;driver public.transport_drivers%rowtype;
 own public.transport_vehicle_ownership%rowtype;rate public.transport_customer_rates%rowtype;
 from_place public.transport_locations%rowtype;to_place public.transport_locations%rowtype;
 t uuid;number text;truck uuid;trip_day date;ppr_day date;employee uuid;ppr text;sale text;
 customer_amount numeric;rent_amount numeric;pay_amount numeric;rent_id uuid;
begin
 if auth.uid() is null or loc is null or c is distinct from p_company_id or b is distinct from p_business_unit_id
 or not public.has_module_permission(c,'transport','create') or not public.has_transport_action_permission(c,'trip_create')
 or not exists(select 1 from public.business_units where id=b and company_id=c and unit_type='transport' and is_active)
 then raise exception 'Trip create permission and active Company/Business Unit/branch required';end if;
 if p_request_id is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500
 then raise exception 'A request ID and 1–500 Trip rows are required';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) v group by v having count(*)>1)
 then raise exception 'Duplicate Trip row in the same request';end if;
 body_hash:=md5(loc::text||':'||p_rows::text);
 perform pg_advisory_xact_lock(hashtextextended('transport-trip-entry:'||p_request_id::text,0));
 select * into saved from public.transport_trip_entry_requests where request_id=p_request_id;
 if found then
  if (saved.company_id,saved.business_unit_id,saved.created_by,saved.payload_hash) is distinct from (c,b,auth.uid(),body_hash)
  then raise exception 'Request ID already used for another payload or workspace';end if;
  return saved.result;
 end if;
 for row_data in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(row_data)<>'object' or exists(select 1 from jsonb_object_keys(row_data) k where k not in
   ('trip_date','customer_id','truck_type_id','vehicle_id','driver_id','from_location_id','to_location_id','po_do_job_no',
    'ppr_status','ppr_received_date','ppr_received_by_employee_id','customer_rate','supplier_rent','driver_pay','sale_type','source_invoice_no','notes'))
  then raise exception 'Unsupported Trip fields; free-text ownership and caller scope are not accepted';end if;
  trip_day:=(row_data->>'trip_date')::date;
  if trip_day is null then raise exception 'Trip Date required';end if;
  sale:=row_data->>'sale_type';ppr:=coalesce(nullif(row_data->>'ppr_status',''),'pending');
  if sale is null or sale not in ('cash','credit') then raise exception 'Sale Type must be Cash or Credit';end if;
  if ppr not in ('pending','received','not_required') then raise exception 'Invalid PPR Status';end if;
  employee:=nullif(row_data->>'ppr_received_by_employee_id','')::uuid;ppr_day:=nullif(row_data->>'ppr_received_date','')::date;
  if ppr='received' then
   if employee is null or ppr_day is null then raise exception 'PPR Received requires Employee and Date';end if;
   if not public.has_transport_action_permission(c,'ppr_receive') or not exists(select 1 from public.employees where id=employee and company_id=c and is_active)
   then raise exception 'PPR permission and active same-company Employee required';end if;
  elsif employee is not null or ppr_day is not null then raise exception 'PPR details require Received status';end if;
  select * into customer from public.customers where id=(row_data->>'customer_id')::uuid and company_id=c and is_active for share;
  if not found then raise exception 'Active same-company Customer required';end if;
  select * into from_place from public.transport_locations where id=(row_data->>'from_location_id')::uuid and company_id=c and business_unit_id=b and is_active for share;
  if not found then raise exception 'Active same-workspace From Location required';end if;
  select * into to_place from public.transport_locations where id=(row_data->>'to_location_id')::uuid and company_id=c and business_unit_id=b and is_active for share;
  if not found then raise exception 'Active same-workspace To Location required';end if;
  truck:=nullif(row_data->>'truck_type_id','')::uuid;
  if truck is not null and not exists(select 1 from public.transport_truck_types where id=truck and company_id=c and business_unit_id=b and is_active)
  then raise exception 'Active same-workspace Truck Type required';end if;
  vehicle:=null;own:=null;driver:=null;rate:=null;
  if nullif(row_data->>'vehicle_id','') is not null then
   select * into vehicle from public.transport_vehicles where id=(row_data->>'vehicle_id')::uuid and company_id=c and business_unit_id=b and is_active for share;
   if not found then raise exception 'Active same-workspace Vehicle required';end if;
   if truck is not null and vehicle.truck_type_id is distinct from truck then raise exception 'Vehicle does not match Truck Type';end if;
   truck:=coalesce(truck,vehicle.truck_type_id);
   if truck is not null and not exists(select 1 from public.transport_truck_types where id=truck and company_id=c and business_unit_id=b and is_active)
   then raise exception 'Active same-workspace Truck Type required';end if;
   select * into own from public.transport_vehicle_ownership where vehicle_id=vehicle.id and company_id=c and business_unit_id=b
     and effective_from<=trip_day and (effective_to is null or effective_to>=trip_day) for share;
   if not found then raise exception 'Vehicle Ownership History must cover Trip Date';end if;
   if own.owner_type='third_party' and not exists(select 1 from public.suppliers where id=own.supplier_id and company_id=c and is_active)
   then raise exception 'Active same-company Owner / Supplier required';end if;
  end if;
  if nullif(row_data->>'driver_id','') is not null then
   select * into driver from public.transport_drivers where id=(row_data->>'driver_id')::uuid and company_id=c and business_unit_id=b and is_active for share;
   if not found then raise exception 'Active same-workspace Driver required';end if;
   if driver.driver_type='supplier' and not exists(select 1 from public.suppliers where id=driver.supplier_id and company_id=c and is_active)
   then raise exception 'Driver Supplier must be active in the same Company';end if;
  end if;
  customer_amount:=nullif(row_data->>'customer_rate','')::numeric;
  rent_amount:=nullif(row_data->>'supplier_rent','')::numeric;pay_amount:=nullif(row_data->>'driver_pay','')::numeric;
  if exists(select 1 from unnest(array[customer_amount,rent_amount,pay_amount]) a where a<0 or a::text in ('NaN','Infinity','-Infinity') or round(a,2)<>a)
  then raise exception 'Amounts must be nonnegative with at most two decimal places';end if;
  if customer_amount is not null and not public.has_transport_action_permission(c,'customer_rate_finalize') then raise exception 'Customer rate finalization permission required';end if;
  if rent_amount is not null then
   if own.owner_type is distinct from 'third_party' then raise exception 'Supplier Rent requires dated Supplier Owned Vehicle';end if;
   if not public.has_transport_action_permission(c,'rent_finalize') then raise exception 'Rent finalization permission required';end if;
   perform public.transport_finance_assert('rent');
  end if;
  if coalesce(pay_amount,0)>0 then
   if driver.id is null then raise exception 'Driver Pay requires an active Driver';end if;
   perform public.transport_finance_assert('driver');
  end if;
  select * into rate from public.transport_customer_rates where company_id=c and business_unit_id=b and customer_id=customer.id
   and from_location_id=from_place.id and to_location_id=to_place.id and truck_type_id=truck and is_active
   and effective_from<=trip_day and (effective_to is null or effective_to>=trip_day) order by effective_from desc,id limit 1;
  t:=gen_random_uuid();
  insert into public.transport_action_gate values(txid_current(),t,'trip_entry');
  insert into public.transport_trips(id,company_id,business_unit_id,operating_location_id,trip_no,trip_date,customer_id,customer_name_snapshot,
    truck_type_id,vehicle_id,driver_id,from_location_id,to_location_id,from_location,to_location,po_do_job_no,
    ppr_status,ppr_received_by_employee_id,ppr_received_date,customer_rate,owner_rent,driver_pay,sale_type,source_invoice_no,notes)
  values(t,c,b,loc,'',trip_day,customer.id,customer.name,truck,vehicle.id,driver.id,from_place.id,to_place.id,from_place.name,to_place.name,
    nullif(btrim(row_data->>'po_do_job_no'),''),ppr,employee,ppr_day,coalesce(customer_amount,0),0,coalesce(pay_amount,0),sale,
    nullif(btrim(row_data->>'source_invoice_no'),''),nullif(btrim(row_data->>'notes'),'')) returning trip_no into number;
  delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t and action='trip_entry';
  if customer_amount is not null then
   perform public.transport_finalize_customer_rate(t,customer_amount,case when rate.id is not null and rate.amount=customer_amount then 'agreed' else 'manual' end,'Initial New Trip rate');
   if rate.id is not null and rate.amount=customer_amount then
    insert into public.transport_action_gate values(txid_current(),t,'customer_rate_finalize');
    update public.transport_trips set customer_rate_reference_id=rate.id where id=t;
    delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t and action='customer_rate_finalize';
   end if;
  end if;
  if rent_amount is not null then
   insert into public.transport_action_gate values(txid_current(),t,'trip_entry_rent');
   rent_id:=public.transport_add_supplier_rent(t,own.supplier_id,rent_amount,'Initial New Trip Supplier Rent');
   delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t and action='trip_entry_rent';
  end if;
  if coalesce(pay_amount,0)>0 then perform public.transport_financial_audit(t,'driver_pay_agreed',jsonb_build_object('new_value',pay_amount,'reason','Initial New Trip Driver Pay'));end if;
  answer:=answer||jsonb_build_array(jsonb_build_object('id',t,'trip_no',number));
 end loop;
 insert into public.transport_trip_entry_requests(request_id,company_id,business_unit_id,created_by,payload_hash,result)
 values(p_request_id,c,b,auth.uid(),body_hash,answer);
 return answer;
end $$;

notify pgrst,'reload schema';