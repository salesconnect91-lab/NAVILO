-- Company-wide numeric Transport Trip Numbers. Preserve original imported Trip identities.
ALTER TABLE public.transport_trip_number_settings DROP CONSTRAINT transport_trip_number_settings_prefix_check;
ALTER TABLE public.transport_trip_number_settings ADD CONSTRAINT transport_trip_number_settings_prefix_check CHECK (length(prefix)<=24 and prefix !~ '[0-9]$');
ALTER TABLE public.transport_trip_number_settings ALTER COLUMN prefix SET DEFAULT '';
UPDATE public.transport_trip_number_settings s SET prefix='',next_number=greatest(s.next_number,
 coalesce((select max(h.source_trip_id::bigint) from public.transport_historical_trip_identity h where h.company_id=s.company_id and h.source_trip_id ~ '^[0-9]{1,12}$'),0)+1,
 coalesce((select max(t.trip_no::bigint) from public.transport_trips t where t.company_id=s.company_id and t.trip_no ~ '^[0-9]{1,12}$'),0)+1,
 coalesce((select max(r.sequence_no) from public.transport_trip_number_registry r where r.company_id=s.company_id),0)+1),updated_at=now();

CREATE OR REPLACE FUNCTION public.transport_v1_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if coalesce(current_setting('app.maintenance_reset',true),'')='1' then return new; end if;
 if tg_op='INSERT' then
  new.company_id:=coalesce(new.company_id,public.current_company_id());
  new.business_unit_id:=coalesce(new.business_unit_id,public.current_business_unit_id());
  new.created_by:=coalesce(new.created_by,auth.uid());
 end if;
 if new.company_id is distinct from public.current_company_id() or new.business_unit_id is distinct from public.current_business_unit_id()
 then raise exception 'Transport record must belong to active company and business unit';end if;
 if not exists(select 1 from public.business_units where id=new.business_unit_id and company_id=new.company_id and unit_type='transport' and is_active)
 then raise exception 'Active Transport business unit required';end if;
 if tg_table_name='transport_trips' then
  if tg_op='INSERT' then
   new.trip_no:=coalesce(nullif(btrim(new.trip_no),''),'');
   new.customer_rate:=coalesce(new.customer_rate,0);
   new.owner_rent:=coalesce(new.supplier_rent,new.owner_rent,0);
   new.supplier_rent:=new.owner_rent;
  else
   if new.owner_rent is distinct from old.owner_rent then new.supplier_rent:=new.owner_rent;
   elsif new.supplier_rent is distinct from old.supplier_rent then new.owner_rent:=coalesce(new.supplier_rent,0);end if;
  end if;
  new.updated_by:=auth.uid();new.updated_at:=now();
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.transport_trip_batch1_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_no text;v_seq bigint;v_prefix text;v_name text;v_owner public.transport_vehicle_ownership%rowtype;
begin
 if tg_op='INSERT' then
  if not public.has_transport_action_permission(new.company_id,'trip_create') then raise exception 'Trip create permission required';end if;
  insert into public.transport_trip_number_settings(company_id) values(new.company_id) on conflict do nothing;
  select next_number into v_seq from public.transport_trip_number_settings where company_id=new.company_id for update;
  v_no:=nullif(btrim(new.trip_no),'');
  if v_no is not null and (v_no !~ '^[0-9]{1,12}$' or v_no::numeric<1) then
   raise exception 'Trip Number must be positive numeric (up to 12 digits)';end if;
  if v_no is null then
   loop
    v_no:=v_seq::text;
    exit when not exists(select 1 from public.transport_trip_number_registry r where r.company_id=new.company_id and r.trip_no=v_no)
     and not exists(select 1 from public.transport_historical_trip_identity h where h.company_id=new.company_id and h.source_trip_id ~ '^[0-9]+$' and ltrim(h.source_trip_id,'0')=ltrim(v_no,'0'));
    v_seq:=v_seq+1;
   end loop;
  end if;
  if exists(select 1 from public.transport_trip_number_registry r where r.company_id=new.company_id and r.trip_no ~ '^[0-9]+$' and ltrim(r.trip_no,'0')=ltrim(v_no,'0'))
   or exists(select 1 from public.transport_historical_trip_identity h where h.company_id=new.company_id and h.source_trip_id ~ '^[0-9]+$' and ltrim(h.source_trip_id,'0')=ltrim(v_no,'0'))
   or exists(select 1 from public.transport_trips t where t.company_id=new.company_id and t.trip_no ~ '^[0-9]+$' and ltrim(t.trip_no,'0')=ltrim(v_no,'0'))
  then raise exception 'Duplicate Trip Number % in Company',v_no;end if;
  update public.transport_trip_number_settings set next_number=greatest(next_number,v_seq+1,v_no::bigint+1),updated_at=now() where company_id=new.company_id;
  new.trip_no:=v_no;new.status:='draft';new.lifecycle_status:='not_complete';new.rent_state:='pending';new.customer_rate_state:='pending';
  if new.vehicle_id is not null then select * into v_owner from public.transport_vehicle_ownership where vehicle_id=new.vehicle_id and company_id=new.company_id and business_unit_id=new.business_unit_id and effective_from<=new.trip_date and (effective_to is null or effective_to>=new.trip_date) order by effective_from desc limit 1;if found then new.ownership_id:=v_owner.id;new.owner_supplier_id:=v_owner.supplier_id;new.owner_name_snapshot:=v_owner.owner_name_snapshot;end if;end if;
  insert into public.transport_trip_number_registry(company_id,business_unit_id,trip_no,sequence_no,trip_id,issued_by) values(new.company_id,new.business_unit_id,v_no,v_seq,new.id,auth.uid());
 else
  if (new.company_id,new.business_unit_id,new.trip_no) is distinct from (old.company_id,old.business_unit_id,old.trip_no) then raise exception 'Trip number and tenant scope are immutable';end if;
  if new.status is distinct from old.status then raise exception 'Legacy status cannot be set manually';end if;
  if new.trip_date is distinct from old.trip_date and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='operational_correction') then raise exception 'Trip date correction requires controlled ownership review';end if;
  if not public.has_transport_action_permission(new.company_id,'trip_edit') and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action in ('rent_finalize','rent_correct','customer_rate_finalize','assignment_replace','operational_correction')) then raise exception 'Trip edit permission required';end if;
  if (new.lifecycle_status,new.rent_state,new.rent_finalized_at,new.rent_finalized_by) is distinct from (old.lifecycle_status,old.rent_state,old.rent_finalized_at,old.rent_finalized_by) and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='rent_finalize') then raise exception 'Rent lifecycle requires controlled finalization';end if;
  if (new.customer_rate_state,new.customer_rate_snapshot,new.customer_rate_finalized_at,new.customer_rate_finalized_by) is distinct from (old.customer_rate_state,old.customer_rate_snapshot,old.customer_rate_finalized_at,old.customer_rate_finalized_by) and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='customer_rate_finalize') then raise exception 'Customer rate requires controlled finalization';end if;
  if new.owner_rent is distinct from old.owner_rent and old.rent_state='finalized' and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='rent_correct') then raise exception 'Finalized owner rent requires controlled correction';end if;
  if new.owner_rent<>0 and exists(select 1 from public.transport_trip_supplier_rents where trip_id=new.id) then raise exception 'Structured supplier rents require zero legacy owner rent';end if;
  if (new.vehicle_id,new.driver_id) is distinct from (old.vehicle_id,old.driver_id) and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='assignment_replace') then raise exception 'Driver/vehicle replacement requires controlled action';end if;
  if (new.ownership_id,new.owner_supplier_id,new.owner_name_snapshot) is distinct from (old.ownership_id,old.owner_supplier_id,old.owner_name_snapshot) and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action in ('assignment_replace','operational_correction')) then raise exception 'Ownership snapshot requires controlled replacement';end if;
  if (new.customer_rate_source,new.customer_rate_reference_id) is distinct from (old.customer_rate_source,old.customer_rate_reference_id) and old.customer_rate_state='finalized' and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='customer_rate_finalize') then raise exception 'Finalized rate source is immutable without override';end if;
 end if;
 if new.customer_id is not null and not exists(select 1 from public.customers where id=new.customer_id and company_id=new.company_id) then raise exception 'Customer company mismatch';end if;
 if new.vehicle_id is not null and not exists(select 1 from public.transport_vehicles where id=new.vehicle_id and company_id=new.company_id and business_unit_id=new.business_unit_id and is_active) then raise exception 'Active vehicle not found in Trip workspace';end if;
 if new.driver_id is not null and not exists(select 1 from public.transport_drivers where id=new.driver_id and company_id=new.company_id and business_unit_id=new.business_unit_id and is_active) then raise exception 'Active driver not found in Trip workspace';end if;
 if new.truck_type_id is not null and not exists(select 1 from public.transport_truck_types where id=new.truck_type_id and company_id=new.company_id and business_unit_id=new.business_unit_id and is_active) then raise exception 'Inactive or missing Truck Type';end if;
 if new.from_location_id is not null and not exists(select 1 from public.transport_locations where id=new.from_location_id and company_id=new.company_id and business_unit_id=new.business_unit_id and is_active) then raise exception 'Inactive or missing From Location';end if;
 if new.to_location_id is not null and not exists(select 1 from public.transport_locations where id=new.to_location_id and company_id=new.company_id and business_unit_id=new.business_unit_id and is_active) then raise exception 'Inactive or missing To Location';end if;
 if new.owner_supplier_id is not null and not exists(select 1 from public.suppliers where id=new.owner_supplier_id and company_id=new.company_id) then raise exception 'Owner supplier company mismatch';end if;
 if new.ownership_id is not null and not exists(select 1 from public.transport_vehicle_ownership where id=new.ownership_id and vehicle_id=new.vehicle_id and company_id=new.company_id and business_unit_id=new.business_unit_id and effective_from<=new.trip_date and (effective_to is null or effective_to>=new.trip_date)) then raise exception 'Vehicle ownership does not cover Trip date';end if;
 if new.ppr_status='received' then
  if (tg_op='INSERT' or (new.ppr_status,new.ppr_received_by_employee_id,new.ppr_received_date,new.ppr_attachment_path) is distinct from (old.ppr_status,old.ppr_received_by_employee_id,old.ppr_received_date,old.ppr_attachment_path)) and not public.has_transport_action_permission(new.company_id,'ppr_receive') then raise exception 'PPR receipt permission required';end if;
  if tg_op='INSERT' or old.ppr_status is distinct from new.ppr_status or old.ppr_received_by_employee_id is distinct from new.ppr_received_by_employee_id or old.ppr_received_date is distinct from new.ppr_received_date then
   if not exists(select 1 from public.transport_historical_mapping_gate g join public.transport_historical_operational_mapping m on m.trip_id=g.trip_id where g.transaction_id=txid_current() and g.actor_id=auth.uid() and g.trip_id=new.id and m.paper_status='received' and new.ppr_received_date is not distinct from m.paper_date and new.ppr_received_by_employee_id is null and new.ppr_received_by_name is not distinct from m.paper_receiver) then
   if new.ppr_received_date is null or (new.ppr_received_by_employee_id is null and (new.ppr_receiver_type is null or nullif(btrim(new.ppr_received_by_name),'') is null)) then raise exception 'PPR received requires receiver name and date';end if;
   if new.ppr_received_by_employee_id is not null then select name into v_name from public.employees where id=new.ppr_received_by_employee_id and company_id=new.company_id and is_active;if v_name is null then raise exception 'PPR employee company mismatch or inactive';end if;new.ppr_received_by_name:=v_name;end if;
   end if;
  end if;
 elsif new.ppr_received_by_employee_id is not null or new.ppr_received_date is not null then raise exception 'PPR receipt details require received status';end if;
 if tg_op='UPDATE' and new.po_do_job_no is distinct from old.po_do_job_no then insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,actor_id) values(new.company_id,new.business_unit_id,new.id,new.trip_no,'job_change',to_jsonb(old.po_do_job_no),to_jsonb(new.po_do_job_no),auth.uid());end if;
 if tg_op='UPDATE' and (new.ppr_status,new.ppr_received_by_employee_id,new.ppr_received_date) is distinct from (old.ppr_status,old.ppr_received_by_employee_id,old.ppr_received_date) then insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,actor_id) values(new.company_id,new.business_unit_id,new.id,new.trip_no,'ppr_change',jsonb_build_object('status',old.ppr_status,'employee_id',old.ppr_received_by_employee_id,'date',old.ppr_received_date),jsonb_build_object('status',new.ppr_status,'employee_id',new.ppr_received_by_employee_id,'date',new.ppr_received_date),auth.uid());end if;
 if tg_op='UPDATE' and new.customer_rate is distinct from old.customer_rate and old.customer_rate_state='finalized' and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='customer_rate_finalize') then raise exception 'Finalized customer rate requires controlled override';end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.transport_create_trips(p_request_id uuid, p_company_id uuid, p_business_unit_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  ppr:=coalesce(nullif(row_data->>'ppr_status',''),'pending');

  if ppr not in ('pending','received','not_required') then raise exception 'Invalid PPR Status';end if;
  employee:=nullif(row_data->>'ppr_received_by_employee_id','')::uuid;ppr_day:=nullif(row_data->>'ppr_received_date','')::date;
  if ppr='received' then
   if employee is null or ppr_day is null then raise exception 'PPR Received requires Employee and Date';end if;
   if not public.has_transport_action_permission(c,'ppr_receive') or not exists(select 1 from public.employees where id=employee and company_id=c and is_active)
   then raise exception 'PPR permission and active same-company Employee required';end if;
  elsif employee is not null or ppr_day is not null then raise exception 'PPR details require Received status';end if;
  select * into customer from public.customers where id=(row_data->>'customer_id')::uuid and company_id=c and is_active for share;
  if not found then raise exception 'Active same-company Customer required';end if;
  sale:=public.transport_trip_customer_sale_type(c,b,customer.id);
  if nullif(row_data->>'sale_type','') is not null and row_data->>'sale_type'<>sale
  then raise exception 'Customer Master billing mode disagrees with uploaded Trip mode';end if;
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
   perform public.transport_assert_trip_driver((row_data->>'driver_id')::uuid);
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
  values(t,c,b,loc,coalesce(nullif(btrim(row_data->>'trip_no'),''),''),trip_day,customer.id,customer.name,truck,vehicle.id,driver.id,from_place.id,to_place.id,from_place.name,to_place.name,
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
end $function$;

CREATE OR REPLACE FUNCTION public.transport_display_trip_no(p_trip_id uuid,p_fallback text) RETURNS text LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $function$
 SELECT case when p_fallback ~ '^[0-9]+$' then p_fallback else coalesce((select nullif(h.source_trip_id,'') from public.transport_historical_trip_identity h where h.trip_id=p_trip_id),p_fallback) end;
$function$;
