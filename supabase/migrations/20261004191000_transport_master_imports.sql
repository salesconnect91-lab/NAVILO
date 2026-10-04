-- Centralized Transport master imports. Additive only; existing masters/history are never overwritten.
create or replace function public.transport_import_master_rows(p_kind text,p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
 c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id();
 r jsonb; n int:=0; tt uuid; sid uuid; vid uuid; ef date; et date;
 owner_kind text; driver_kind text; scope_kind text; label text;
begin
 if auth.uid() is null or c is null or b is null or not public.has_transport_action_permission(c,'master_manage')
 then raise exception 'Transport master permission and active workspace required'; end if;
 if p_kind not in ('vehicles','drivers','truck_types','locations','vehicle_expense_types','vehicle_ownership')
   or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>500
 then raise exception 'Invalid Transport master import'; end if;
 if p_kind in ('vehicles','vehicle_ownership') and not public.has_transport_action_permission(c,'vehicle_owner_change')
 then raise exception 'Vehicle ownership permission required'; end if;

 for r in select * from jsonb_array_elements(p_rows) loop
  n:=n+1;
  if p_kind='truck_types' then
   label:=btrim(coalesce(r->>'name','')); if label='' then raise exception 'Row %: Truck Type name is required',n; end if;
   insert into public.transport_truck_types(company_id,business_unit_id,name,is_active,created_by) values(c,b,label,true,auth.uid());

  elsif p_kind='locations' then
   label:=btrim(coalesce(r->>'name','')); if label='' then raise exception 'Row %: Location name is required',n; end if;
   insert into public.transport_locations(company_id,business_unit_id,name,city_area,is_active,created_by)
   values(c,b,label,nullif(btrim(r->>'city_area'),''),true,auth.uid());

  elsif p_kind='vehicle_expense_types' then
   label:=btrim(coalesce(r->>'name','')); scope_kind:=lower(btrim(coalesce(r->>'expense_scope','')));
   if label='' or scope_kind not in ('trip','vehicle','both') then raise exception 'Row %: valid Expense Type name and scope (Trip/Vehicle/Both) are required',n; end if;
   insert into public.transport_vehicle_expense_types(company_id,business_unit_id,name,expense_scope,is_active,created_by)
   values(c,b,label,scope_kind,true,auth.uid());

  elsif p_kind='drivers' then
   label:=btrim(coalesce(r->>'driver_name','')); driver_kind:=lower(btrim(coalesce(r->>'driver_type','')));
   if label='' or driver_kind not in ('company','supplier') then raise exception 'Row %: Driver Name and Driver Type (Company/Supplier) are required',n; end if;
   sid:=null;
   if driver_kind='supplier' then
    select id into sid from public.suppliers where company_id=c and is_active and public.transport_master_normalized_key(name)=public.transport_master_normalized_key(r->>'supplier') limit 1;
    if sid is null then raise exception 'Row %: active Supplier not found',n; end if;
   end if;
   insert into public.transport_drivers(company_id,business_unit_id,driver_name,driver_code,mobile,driver_type,supplier_id,identity_no,driving_licence_no,licence_expiry,is_active,created_by)
   values(c,b,label,nullif(btrim(r->>'driver_code'),''),nullif(btrim(r->>'mobile'),''),driver_kind,sid,nullif(btrim(r->>'identity_no'),''),nullif(btrim(r->>'licence_no'),''),nullif(r->>'licence_expiry','')::date,true,auth.uid());

  elsif p_kind='vehicles' then
   label:=btrim(coalesce(r->>'vehicle_no','')); owner_kind:=lower(btrim(coalesce(r->>'owner_type','')));
   ef:=nullif(r->>'effective_from','')::date; tt:=null; sid:=null;
   if label='' or owner_kind not in ('company','supplier') or ef is null then raise exception 'Row %: Vehicle No, Owner Type and Effective From are required',n; end if;
   if nullif(btrim(r->>'truck_type'),'') is not null then
    select id into tt from public.transport_truck_types where company_id=c and business_unit_id=b and is_active and public.transport_master_normalized_key(name)=public.transport_master_normalized_key(r->>'truck_type') limit 1;
    if tt is null then raise exception 'Row %: active Truck Type not found',n; end if;
   end if;
   if owner_kind='supplier' then
    select id into sid from public.suppliers where company_id=c and is_active and public.transport_master_normalized_key(name)=public.transport_master_normalized_key(r->>'supplier') limit 1;
    if sid is null then raise exception 'Row %: active Supplier not found',n; end if;
   end if;
   perform public.transport_create_vehicle_master(label,tt,owner_kind,sid,ef);

  else
   label:=btrim(coalesce(r->>'vehicle_no','')); owner_kind:=lower(btrim(coalesce(r->>'owner_type','')));
   ef:=nullif(r->>'effective_from','')::date; et:=nullif(r->>'effective_to','')::date; sid:=null;
   if label='' or owner_kind not in ('company','supplier') or ef is null or (et is not null and et<ef) then raise exception 'Row %: valid Vehicle No, Owner Type and ownership dates are required',n; end if;
   select id into vid from public.transport_vehicles where company_id=c and business_unit_id=b and is_active and public.transport_master_normalized_key(vehicle_no)=public.transport_master_normalized_key(label) limit 1;
   if vid is null then raise exception 'Row %: active Vehicle not found',n; end if;
   if owner_kind='supplier' then
    select id into sid from public.suppliers where company_id=c and is_active and public.transport_master_normalized_key(name)=public.transport_master_normalized_key(r->>'supplier') limit 1;
    if sid is null then raise exception 'Row %: active Supplier not found',n; end if;
   end if;
   insert into public.transport_vehicle_ownership(company_id,business_unit_id,vehicle_id,owner_type,supplier_id,effective_from,effective_to,change_reason)
   values(c,b,vid,case when owner_kind='supplier' then 'third_party' else 'company' end,sid,ef,et,nullif(btrim(r->>'change_reason'),''));
  end if;
 end loop;
 return jsonb_build_object('imported',n,'kind',p_kind);
end $$;
revoke execute on function public.transport_import_master_rows(text,jsonb) from public,anon;
grant execute on function public.transport_import_master_rows(text,jsonb) to authenticated,service_role;
