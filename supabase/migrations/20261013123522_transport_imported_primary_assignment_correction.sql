-- Explicit, audited primary identity correction for immutable imported evidence.
-- Original CSV, ownership evidence and all commercial/financial snapshots remain intact.
create function public.transport_import_primary_label(p_label text,p_kind text) returns text
language sql immutable set search_path=public,pg_temp as $$
 select case when p_label is null then null
 when position('/' in p_label)=0 then p_label
 when p_kind='driver' and p_label ~* '^[[:space:]]*C[[:space:]]*/[[:space:]]*O([[:space:]]|$)' then p_label
 when p_kind='vehicle' and btrim(split_part(p_label,'/',1)) !~ '^[0-9]+$' then p_label
 else btrim(split_part(p_label,'/',1)) end
$$;
revoke all on function public.transport_import_primary_label(text,text) from public,anon;
grant execute on function public.transport_import_primary_label(text,text) to authenticated;

create or replace function public.transport_opening_trip_commercial_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.transport_opening_invoice_lines where trip_id=old.id) then
  if exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=old.id and action='import_primary_assignment') then
   if auth.uid() is null or old.company_id is distinct from public.current_company_id()
    or old.business_unit_id is distinct from public.current_business_unit_id()
    or old.operating_location_id is distinct from public.current_operating_location_id()
    or not public.has_transport_action_permission(old.company_id,'assignment_replace')
    or not public.has_transport_action_permission(old.company_id,'master_manage')
    or not public.has_module_permission(old.company_id,'transport','edit')
   then raise exception 'Imported primary assignment permission required';end if;
   if (to_jsonb(new)-array['job_status','driver_id','vehicle_id','ownership_id','updated_at','updated_by'])
    is distinct from (to_jsonb(old)-array['job_status','driver_id','vehicle_id','ownership_id','updated_at','updated_by'])
   then raise exception 'Primary assignment correction cannot change commercial, ownership, paper or financial snapshots';end if;
   if new.ownership_id is distinct from old.ownership_id and new.ownership_id is not null then raise exception 'Primary assignment correction cannot fabricate ownership history';end if;
   if new.driver_id is distinct from old.driver_id and not exists(
    select 1 from public.transport_historical_trip_identity h join public.transport_drivers d on d.id=new.driver_id
    where h.trip_id=old.id and d.company_id=old.company_id and d.business_unit_id=old.business_unit_id and d.is_active
    and public.transport_master_normalized_key(d.driver_name)=public.transport_master_normalized_key(public.transport_import_primary_label(h.driver_name_snapshot,'driver')))
   then raise exception 'Driver must be the original source primary Driver';end if;
   if new.vehicle_id is distinct from old.vehicle_id and not exists(
    select 1 from public.transport_historical_trip_identity h join public.transport_vehicles v on v.id=new.vehicle_id
    where h.trip_id=old.id and v.company_id=old.company_id and v.business_unit_id=old.business_unit_id and v.is_active
    and public.transport_master_normalized_key(v.vehicle_no)=public.transport_master_normalized_key(public.transport_import_primary_label(h.vehicle_no_snapshot,'vehicle')))
   then raise exception 'Vehicle must be the original source primary plate';end if;
   return new;
  end if;
  if (to_jsonb(new)-array['job_status','notes','ppr_status','ppr_receiver_type','ppr_received_by','ppr_received_by_employee_id','ppr_received_by_name','ppr_received_date','ppr_attachment_path','updated_at','updated_by'])
   is distinct from (to_jsonb(old)-array['job_status','notes','ppr_status','ppr_receiver_type','ppr_received_by','ppr_received_by_employee_id','ppr_received_by_name','ppr_received_date','ppr_attachment_path','updated_at','updated_by'])
  then raise exception 'Imported Trip is linked to posted opening balances; only Papers Received and Remarks may change (fields: %)',(select string_agg(k,',') from jsonb_object_keys(to_jsonb(new)) k where to_jsonb(new)->k is distinct from to_jsonb(old)->k);end if;
 end if;return new;
end $$;

create function public.transport_correct_imported_primary_assignment(p_trip_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 t public.transport_trips;h public.transport_historical_trip_identity;m public.transport_historical_operational_mapping;
 d public.transport_drivers;v public.transport_vehicles;old_d public.transport_drivers;old_v public.transport_vehicles;
 driver_label text;plate text;d_id uuid;v_id uuid;o_id uuid;stamp timestamptz;renamed boolean:=false;
begin
 if auth.uid() is null or c is null or b is null or loc is null or nullif(btrim(p_reason),'') is null
  or not public.has_module_permission(c,'transport','edit')
  or not public.has_transport_action_permission(c,'assignment_replace')
  or not public.has_transport_action_permission(c,'master_manage')
 then raise exception 'Authorized imported primary assignment correction and reason required';end if;
 select * into t from public.transport_trips where id=p_trip_id and company_id=c and business_unit_id=b and operating_location_id=loc for update;
 if not found then raise exception 'Imported Trip outside active workspace/branch';end if;
 select * into strict h from public.transport_historical_trip_identity where trip_id=t.id and company_id=c and business_unit_id=b and operating_location_id=loc;
 select * into strict m from public.transport_historical_operational_mapping where trip_id=t.id and company_id=c and business_unit_id=b and operating_location_id=loc;
 select * into old_d from public.transport_drivers where id=t.driver_id;
 select * into old_v from public.transport_vehicles where id=t.vehicle_id;
 driver_label:=public.transport_import_primary_label(h.driver_name_snapshot,'driver');
 plate:=public.transport_import_primary_label(h.vehicle_no_snapshot,'vehicle');
 d_id:=t.driver_id;v_id:=t.vehicle_id;o_id:=t.ownership_id;
 if driver_label is distinct from h.driver_name_snapshot then
  select * into strict d from public.transport_drivers where company_id=c and business_unit_id=b and is_active and public.transport_master_normalized_key(driver_name)=public.transport_master_normalized_key(driver_label) for share;
  if t.driver_id is distinct from m.driver_master_id and t.driver_id is distinct from d.id then raise exception 'Driver was subsequently replaced; source cleanup cannot overwrite it';end if;
  -- Historical identity references may point to pre-classification masters. This does
  -- not authorize their use for new Trips, payroll, driver expenses or salary postings.
  d_id:=d.id;
 end if;
 if plate is distinct from h.vehicle_no_snapshot then
  select * into v from public.transport_vehicles where company_id=c and business_unit_id=b and is_active and public.transport_master_normalized_key(vehicle_no)=public.transport_master_normalized_key(plate) for share;
  if not found then
   if t.vehicle_id is distinct from m.vehicle_master_id or public.transport_master_normalized_key(old_v.vehicle_no) is distinct from public.transport_master_normalized_key(h.vehicle_no_snapshot)
   or exists(select 1 from public.transport_trips x left join public.transport_historical_trip_identity hx on hx.trip_id=x.id where x.vehicle_id=t.vehicle_id and (hx.trip_id is null or public.transport_import_primary_label(hx.vehicle_no_snapshot,'vehicle') is distinct from plate))
   then raise exception 'Primary Vehicle master missing or used by unrelated Trips';end if;
   update public.transport_vehicles set vehicle_no=plate,updated_at=now() where id=t.vehicle_id returning * into v;
   renamed:=true;
  end if;
  if t.vehicle_id is distinct from m.vehicle_master_id and t.vehicle_id is distinct from v.id then raise exception 'Vehicle was subsequently replaced; source cleanup cannot overwrite it';end if;
  v_id:=v.id;
  -- A prior ownership pointer belongs to the combined plate alias. Preserve the
  -- supplied owner/supplier snapshots, and keep the old dated evidence in its history.
  -- Do not manufacture a new ownership period or change the supplied Trip Truck Type.
  if v_id is distinct from t.vehicle_id then o_id:=null;end if;
 end if;
 if (d_id,v_id,o_id) is not distinct from (t.driver_id,t.vehicle_id,t.ownership_id) and not renamed then return jsonb_build_object('trip_id',t.id,'changed',false);end if;
 insert into public.transport_action_gate values(txid_current(),t.id,'assignment_replace'),(txid_current(),t.id,'import_primary_assignment');
 stamp:=clock_timestamp();
 update public.transport_trip_assignments set ended_at=greatest(stamp,effective_at+interval '1 microsecond') where trip_id=t.id and ended_at is null;
 select greatest(stamp,coalesce(max(ended_at),stamp)) into stamp from public.transport_trip_assignments where trip_id=t.id;
 insert into public.transport_trip_assignments(company_id,business_unit_id,trip_id,vehicle_id,driver_id,vehicle_no_snapshot,driver_name_snapshot,owner_name_snapshot,effective_at,reason,actor_id)
 select c,b,t.id,v_id,d_id,vv.vehicle_no,dd.driver_name,t.owner_name_snapshot,stamp,p_reason,auth.uid()
 from (select 1) seed left join public.transport_vehicles vv on vv.id=v_id left join public.transport_drivers dd on dd.id=d_id;
 update public.transport_trips set vehicle_id=v_id,driver_id=d_id,ownership_id=o_id where id=t.id;
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(c,b,t.id,t.trip_no,'import_primary_assignment',jsonb_build_object('vehicle_id',t.vehicle_id,'driver_id',t.driver_id,'ownership_id',t.ownership_id,'vehicle_no',old_v.vehicle_no,'driver_name',old_d.driver_name),jsonb_build_object('vehicle_id',v_id,'driver_id',d_id,'ownership_id',o_id,'vehicle_no',plate,'driver_name',driver_label,'source_owner_preserved',true,'source_truck_type_preserved',true),p_reason,auth.uid());
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action in('assignment_replace','import_primary_assignment');
 return jsonb_build_object('trip_id',t.id,'changed',true,'vehicle_id',v_id,'driver_id',d_id,'vehicle_master_renamed',renamed);
end $$;
revoke all on function public.transport_correct_imported_primary_assignment(uuid,text) from public,anon;
grant execute on function public.transport_correct_imported_primary_assignment(uuid,text) to authenticated;

create index transport_trip_audit_primary_assignment_idx on public.transport_trip_audit(trip_id) where action='import_primary_assignment';

-- Read-side correction of source labels; raw source snapshots are never rewritten.
-- Apply only to rows with an audited primary assignment correction, so unrelated
-- sources and later operational replacements retain their normal display behavior.
do $$
declare fn regprocedure;body text;
begin
 foreach fn in array array['public._transport_opening_register_rows(uuid,uuid,uuid)'::regprocedure,'public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure] loop
  body:=pg_get_functiondef(fn);
  body:=replace(body,'hi.driver_name_snapshot','CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action=''import_primary_assignment'') THEN public.transport_import_primary_label(hi.driver_name_snapshot,''driver'') ELSE hi.driver_name_snapshot END');
  body:=replace(body,'hi.vehicle_no_snapshot','CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action=''import_primary_assignment'') THEN public.transport_import_primary_label(hi.vehicle_no_snapshot,''vehicle'') ELSE hi.vehicle_no_snapshot END');
  execute body;
 end loop;
 body:=pg_get_functiondef('public.transport_opening_invoice_query(text,text,jsonb,integer,integer)'::regprocedure);
 body:=replace(body,'h.vehicle_no_snapshot vehicle_no,h.driver_name_snapshot driver_name','CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action=''import_primary_assignment'') THEN public.transport_import_primary_label(h.vehicle_no_snapshot,''vehicle'') ELSE h.vehicle_no_snapshot END vehicle_no,CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action=''import_primary_assignment'') THEN public.transport_import_primary_label(h.driver_name_snapshot,''driver'') ELSE h.driver_name_snapshot END driver_name');
 execute body;
end $$;
