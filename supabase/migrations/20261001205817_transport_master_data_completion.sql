-- Transport Master Data only. No business data backfill; canonical accounting unchanged.
begin;
alter table public.transport_drivers
 add column if not exists driver_type text,
 add column if not exists supplier_id uuid references public.suppliers(id) on delete restrict,
 add column if not exists identity_no text,
 add column if not exists driving_licence_no text,
 add column if not exists licence_expiry date;
alter table public.transport_drivers add constraint transport_driver_structure_check
 check ((driver_type is null and supplier_id is null) or
        (driver_type='company' and supplier_id is null) or
        (driver_type='supplier' and supplier_id is not null)) not valid;
-- Null means legacy scope not yet reviewed; do not classify historical expenses.
alter table public.transport_vehicle_expense_types add column if not exists expense_scope text;
alter table public.transport_vehicle_expense_types add constraint transport_expense_scope_check
 check(expense_scope in ('trip','vehicle','both')) not valid;

-- Private transaction gate used only to project an explicitly dated owner period.
create table public.transport_master_owner_gate (
 transaction_id bigint not null, vehicle_id uuid not null,
 primary key(transaction_id,vehicle_id));
alter table public.transport_master_owner_gate enable row level security;
revoke all on public.transport_master_owner_gate from public,anon,authenticated;

create function public.transport_master_normalized_key(value text) returns text
language sql immutable set search_path=public,pg_temp as $$
 select lower(regexp_replace(btrim(value),'[[:space:]]+',' ','g'))
$$;
revoke all on function public.transport_master_normalized_key(text) from public,anon,authenticated;

create function public.transport_master_data_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare label text; duplicate boolean; supplier_company uuid; supplier_name text;
 normal_key text; old_key text; structured boolean;
begin
 if auth.uid() is null or new.company_id is distinct from public.current_company_id()
 or new.business_unit_id is distinct from public.current_business_unit_id()
 or (not public.has_transport_action_permission(new.company_id,'master_manage')
     and not (tg_table_name='transport_vehicles' and exists(select 1 from public.transport_master_owner_gate where transaction_id=txid_current() and vehicle_id=new.id)))
 then raise exception 'Transport master permission and active company/business unit required';end if;
 if tg_op='UPDATE' and (new.company_id,new.business_unit_id) is distinct from (old.company_id,old.business_unit_id)
 then raise exception 'Transport master scope is immutable';end if;
 if tg_table_name='transport_vehicles' then
   label:=new.vehicle_no;
   if tg_op='UPDATE' then old_key:=public.transport_master_normalized_key(old.vehicle_no);end if;
   if tg_op='UPDATE' and (new.owner_type,new.ownership_type,new.supplier_id,new.owner_name) is distinct from
      (old.owner_type,old.ownership_type,old.supplier_id,old.owner_name)
      and not exists(select 1 from public.transport_master_owner_gate where transaction_id=txid_current() and vehicle_id=new.id)
   then raise exception 'Change current owner through Vehicle Ownership History with actual effective dates';end if;
   structured:=new.ownership_type is not null;
   if tg_op='INSERT' or (tg_op='UPDATE' and (new.truck_type_id,new.supplier_id,new.ownership_type) is distinct from
       (old.truck_type_id,old.supplier_id,old.ownership_type)) then
     if new.truck_type_id is not null and not exists(select 1 from public.transport_truck_types where id=new.truck_type_id
       and company_id=new.company_id and business_unit_id=new.business_unit_id and is_active)
     then raise exception 'Select an active Truck Type in the same company/business unit';end if;
     if structured then
       if new.ownership_type='supplier' and new.supplier_id is null then raise exception 'Supplier is required for Supplier Owned vehicle';end if;
       if new.ownership_type='company' and new.supplier_id is not null then raise exception 'Company Owned vehicle cannot have a Supplier';end if;
     end if;
     if new.supplier_id is not null then
       select company_id,name into supplier_company,supplier_name from public.suppliers where id=new.supplier_id and is_active;
       if supplier_company is distinct from new.company_id then raise exception 'Select an active Supplier in the same company';end if;
       if structured then new.owner_name:=supplier_name;new.owner_type:='supplier';end if;
     elsif structured then
       new.owner_type:='company';select name into new.owner_name from public.companies where id=new.company_id;
     end if;
   end if;
 elsif tg_table_name='transport_drivers' then
   label:=new.driver_name;
   if tg_op='UPDATE' then old_key:=public.transport_master_normalized_key(old.driver_name);end if;
   if tg_op='INSERT' or (tg_op='UPDATE' and (new.driver_type,new.supplier_id) is distinct from (old.driver_type,old.supplier_id)) then
     if new.driver_type='supplier' and new.supplier_id is null then raise exception 'Supplier is required for Supplier Driver';end if;
     if new.driver_type='company' and new.supplier_id is not null then raise exception 'Company Driver cannot have a Supplier';end if;
     if new.supplier_id is not null and not exists(select 1 from public.suppliers where id=new.supplier_id and company_id=new.company_id and is_active)
     then raise exception 'Select an active Supplier in the same company';end if;
   end if;
   if nullif(btrim(new.driver_code),'') is not null and (tg_op='INSERT' or new.driver_code is distinct from old.driver_code) then
     perform pg_advisory_xact_lock(hashtextextended(new.company_id::text||new.business_unit_id::text||'driver-code'||public.transport_master_normalized_key(new.driver_code),0));
     if exists(select 1 from public.transport_drivers where company_id=new.company_id and business_unit_id=new.business_unit_id
       and id<>new.id and public.transport_master_normalized_key(driver_code)=public.transport_master_normalized_key(new.driver_code))
     then raise exception 'Driver Code already exists in this company/business unit';end if;
   end if;
 else
   label:=new.name;
   if tg_op='UPDATE' then old_key:=public.transport_master_normalized_key(old.name);end if;
 end if;
 normal_key:=public.transport_master_normalized_key(label);
 if normal_key is null or normal_key='' then raise exception 'Master name / vehicle number is required';end if;
 if tg_op='INSERT' or normal_key is distinct from old_key then
   perform pg_advisory_xact_lock(hashtextextended(tg_table_name||new.company_id::text||new.business_unit_id::text||normal_key,0));
   execute format('select exists(select 1 from public.%I where company_id=$1 and business_unit_id=$2 and id<>$3 and public.transport_master_normalized_key(%I)=$4)',
     tg_table_name,case tg_table_name when 'transport_vehicles' then 'vehicle_no' when 'transport_drivers' then 'driver_name' else 'name' end)
     into duplicate using new.company_id,new.business_unit_id,new.id,normal_key;
   if duplicate then raise exception 'Duplicate master name / vehicle number in this company/business unit';end if;
 end if;
 return new;
end $$;
revoke all on function public.transport_master_data_guard() from public,anon,authenticated;
do $$ declare t text;begin
 foreach t in array array['transport_vehicles','transport_drivers','transport_truck_types','transport_locations','transport_vehicle_expense_types'] loop
 execute format('create trigger zzz_transport_master_data_guard before insert or update on public.%I for each row execute function public.transport_master_data_guard()',t);
 end loop;
end $$;

-- Keep an explicitly referenced historical Trip inside its saved ownership period.
create function public.transport_ownership_master_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' and new.owner_type='third_party' and not exists(select 1 from public.suppliers
   where id=new.supplier_id and company_id=new.company_id and is_active)
 then raise exception 'Select an active Supplier in the same company';end if;
 if tg_op='INSERT' then
   if new.owner_type='third_party' then select name into new.owner_name_snapshot from public.suppliers where id=new.supplier_id and company_id=new.company_id;
   else select name into new.owner_name_snapshot from public.companies where id=new.company_id;end if;
 end if;
 if tg_op='UPDATE' and new.effective_to is distinct from old.effective_to and new.effective_to is not null
 and exists(select 1 from public.transport_trips where ownership_id=new.id and trip_date>new.effective_to)
 then raise exception 'Ownership period must retain the dates of its historical Trips';end if;
 return new;
end $$;
revoke all on function public.transport_ownership_master_guard() from public,anon,authenticated;
create trigger zzz_transport_ownership_master_guard before insert or update on public.transport_vehicle_ownership
 for each row execute function public.transport_ownership_master_guard();

-- Existing guard owns overlap, scope, immutable historical identity and end-date reasons.
-- Reuse it; add only projection to the current master, never rewrite a Trip snapshot.
create function public.transport_project_current_vehicle_owner() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare period public.transport_vehicle_ownership%rowtype;
begin
 select * into period from public.transport_vehicle_ownership where vehicle_id=new.vehicle_id
 and company_id=new.company_id and business_unit_id=new.business_unit_id
 and effective_from<=current_date and (effective_to is null or effective_to>=current_date)
 order by effective_from desc limit 1;
 if not found then return new;end if;
 insert into public.transport_master_owner_gate values(txid_current(),new.vehicle_id) on conflict do nothing;
 update public.transport_vehicles set ownership_type=case when period.owner_type='third_party' then 'supplier' else 'company' end,
 owner_type=case when period.owner_type='third_party' then 'supplier' else 'company' end,
 supplier_id=period.supplier_id,owner_name=period.owner_name_snapshot
 where id=new.vehicle_id and company_id=new.company_id and business_unit_id=new.business_unit_id;
 delete from public.transport_master_owner_gate where transaction_id=txid_current() and vehicle_id=new.vehicle_id;
 return new;
end $$;
revoke all on function public.transport_project_current_vehicle_owner() from public,anon,authenticated;
create trigger zzz_transport_owner_projection after insert or update on public.transport_vehicle_ownership
 for each row execute function public.transport_project_current_vehicle_owner();

create function public.transport_create_vehicle_master(p_vehicle_no text,p_truck_type_id uuid,p_owner_type text,
 p_supplier_id uuid,p_effective_from date) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();v uuid;owner_label text;
begin
 if auth.uid() is null or not public.has_transport_action_permission(c,'master_manage')
 or not public.has_transport_action_permission(c,'vehicle_owner_change') then raise exception 'Vehicle master and owner-history permissions required';end if;
 if p_effective_from is null then raise exception 'Actual ownership Effective From date is required';end if;
 if p_owner_type not in ('company','supplier') or p_owner_type is null then raise exception 'Select Company Owned or Supplier Owned';end if;
 if p_owner_type='supplier' then
   select name into owner_label from public.suppliers where id=p_supplier_id and company_id=c and is_active;
   if not found then raise exception 'Select an active Supplier in the same company';end if;
 elsif p_supplier_id is not null then raise exception 'Company Owned vehicle cannot have a Supplier';
 else select name into owner_label from public.companies where id=c;end if;
 insert into public.transport_vehicles(company_id,business_unit_id,vehicle_no,truck_type_id,ownership_type,owner_type,supplier_id,owner_name)
 values(c,b,btrim(p_vehicle_no),p_truck_type_id,p_owner_type,p_owner_type,p_supplier_id,owner_label) returning id into v;
 insert into public.transport_vehicle_ownership(company_id,business_unit_id,vehicle_id,owner_type,supplier_id,owner_name_snapshot,effective_from)
 values(c,b,v,case when p_owner_type='supplier' then 'third_party' else 'company' end,p_supplier_id,owner_label,p_effective_from);
 return v;
end $$;
revoke all on function public.transport_create_vehicle_master(text,uuid,text,uuid,date) from public,anon;
grant execute on function public.transport_create_vehicle_master(text,uuid,text,uuid,date) to authenticated;
commit;
