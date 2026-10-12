-- Registered original CSV evidence, source Master links, PPR and unposted references.
-- No fabricated ownership periods, employees, salaries or financial postings.
create table public.transport_historical_operational_mapping (
 trip_id uuid primary key references public.transport_trips(id),company_id uuid not null,business_unit_id uuid not null,
 operating_location_id uuid not null,source_file_hash text not null,source_row integer not null,
 raw_source jsonb not null check(jsonb_typeof(raw_source)='array' and jsonb_array_length(raw_source)=32),
 company_owned boolean not null,company_cost_net numeric not null default 0,
 driver_master_id uuid references public.transport_drivers(id),vehicle_master_id uuid references public.transport_vehicles(id),
 customer_invoice_ref text,supplier_invoice_ref text,paper_receiver text,paper_date date,
 paper_status text not null check(paper_status in('received','pending')),
 archived_supplier_rent jsonb,created_by uuid not null,created_at timestamptz not null default now()
);
alter table public.transport_historical_operational_mapping enable row level security;
revoke all on public.transport_historical_operational_mapping from public,anon,authenticated;
grant select on public.transport_historical_operational_mapping to authenticated;
create policy historical_operational_read on public.transport_historical_operational_mapping for select to authenticated using(
 company_id=(select public.current_company_id()) and business_unit_id=(select public.current_business_unit_id())
 and operating_location_id=(select public.current_operating_location_id()) and public.has_module_permission(company_id,'transport','view')
 and public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier'));
create function public.transport_historical_operational_immutable() returns trigger language plpgsql as $$
begin raise exception 'Original operational source evidence is immutable';end $$;
revoke all on function public.transport_historical_operational_immutable() from public,anon,authenticated;
create trigger historical_operational_immutable before update or delete on public.transport_historical_operational_mapping
for each row execute function public.transport_historical_operational_immutable();
create table public.transport_historical_mapping_gate(transaction_id bigint not null,actor_id uuid not null,trip_id uuid not null,
 primary key(transaction_id,actor_id,trip_id));
alter table public.transport_historical_mapping_gate enable row level security;
revoke all on public.transport_historical_mapping_gate from public,anon,authenticated;
alter table public.transport_vehicles add column historical_reference_only boolean not null default false;
alter table public.transport_vehicles alter column ownership_type drop not null;
alter table public.transport_vehicles add constraint historical_vehicle_owner_review_required check(
 ownership_type is not null or (historical_reference_only and owner_type='other' and supplier_id is null));
create index historical_identity_driver_scope_idx on public.transport_historical_trip_identity(company_id,business_unit_id,source_file_hash,lower(btrim(driver_name_snapshot)));
create index historical_identity_plate_scope_idx on public.transport_historical_trip_identity(company_id,business_unit_id,source_file_hash,vehicle_no_snapshot);
-- Fail closed; preserve all existing guards except validated source-only cases.
do $$ declare f text;anchor text;begin
 f:=pg_get_functiondef('public.transport_master_data_guard()'::regprocedure);
 anchor:='   label:=new.vehicle_no;';
 if position(anchor in f)=0 then raise exception 'Master guard anchor changed';end if;
 f:=replace(f,anchor,anchor||E'\n   if new.ownership_type is null and not exists(select 1 from public.transport_historical_mapping_gate g join public.transport_historical_trip_identity h on h.trip_id=g.trip_id where g.transaction_id=txid_current() and g.actor_id=auth.uid() and h.company_id=new.company_id and h.business_unit_id=new.business_unit_id and h.vehicle_no_snapshot=new.vehicle_no) then raise exception ''Historical Vehicle requires registered source import'';end if;');execute f;
 f:=pg_get_functiondef('public.transport_financial_append_only()'::regprocedure);
 anchor:=E'begin\n';
 if position(anchor in f)=0 then raise exception 'Rent evidence guard anchor changed';end if;
 f:=replace(f,anchor,anchor||E' if tg_op=''DELETE'' and tg_table_name=''transport_trip_supplier_rents'' and exists(select 1 from public.transport_historical_mapping_gate g join public.transport_historical_operational_mapping m on m.trip_id=g.trip_id where g.transaction_id=txid_current() and g.actor_id=auth.uid() and g.trip_id=old.trip_id and m.company_owned and m.company_id=public.current_company_id() and m.business_unit_id=public.current_business_unit_id() and m.archived_supplier_rent=to_jsonb(old)) and not exists(select 1 from public.transport_supplier_document_rents where rent_id=old.id) then return old;end if;\n');execute f;
 f:=pg_get_functiondef('public.transport_trip_batch1_guard()'::regprocedure);
 anchor:='   if new.ppr_received_by_employee_id is null or new.ppr_received_date is null then raise exception ''PPR received requires employee and date'';end if;';
 if position(anchor in f)=0 then raise exception 'Historical PPR validation anchor changed';end if;
 anchor:=anchor||E'\n   select name into v_name from public.employees where id=new.ppr_received_by_employee_id and company_id=new.company_id and is_active;if v_name is null then raise exception ''PPR employee company mismatch or inactive'';end if;new.ppr_received_by_name:=v_name;';
 if position(anchor in f)=0 then raise exception 'PPR employee guard block changed';end if;
 f:=replace(f,anchor,E'   if not exists(select 1 from public.transport_historical_mapping_gate g join public.transport_historical_operational_mapping m on m.trip_id=g.trip_id where g.transaction_id=txid_current() and g.actor_id=auth.uid() and g.trip_id=new.id and m.paper_status=''received'' and new.ppr_received_date is not distinct from m.paper_date and new.ppr_received_by_employee_id is null and new.ppr_received_by_name is not distinct from m.paper_receiver) then\n'||anchor||E'\n   end if;');execute f;
 f:=pg_get_functiondef('public.transport_trip_ppr_guard()'::regprocedure);
 anchor:=E'begin\n';
 if position(anchor in f)=0 then raise exception 'Paper date guard anchor changed';end if;
 f:=replace(f,anchor,anchor||E' if new.ppr_status=''received'' and new.ppr_received_by_employee_id is null and exists(select 1 from public.transport_historical_operational_mapping m where m.trip_id=new.id and m.company_id=new.company_id and m.business_unit_id=new.business_unit_id and m.paper_status=''received'' and new.ppr_received_date is not distinct from m.paper_date and new.ppr_received_by_name is not distinct from m.paper_receiver) then new.ppr_received_by:=coalesce(new.ppr_received_by,auth.uid());return new;end if;\n');execute f;
end $$;
create function public.transport_complete_historical_operational_mapping(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 r jsonb;raw jsonb;h public.transport_historical_trip_identity;t public.transport_trips;already public.transport_historical_operational_mapping;
 d uuid;v uuid;sid uuid;party uuid;dtype text;owner_kind text;driver_label text;plate text;owner_label text;
 own_count integer;type_count integer;tt uuid;company_rows boolean;cost numeric;receiver text;paper_day date;paper_state text;
 rent public.transport_trip_supplier_rents;archived jsonb;added integer:=0;skipped integer:=0;row_count integer;
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','edit')
 or not public.has_transport_action_permission(c,'master_manage') or not public.has_transport_action_permission(c,'assignment_replace')
 or not public.has_transport_action_permission(c,'ppr_receive') or not public.has_transport_action_permission(c,'rent_correct')
 or not public.transport_financial_read_allowed('customer') or not public.transport_financial_read_allowed('supplier')
 then raise exception 'Authorized source operational import and active branch required';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception '1–100 original source rows required';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if exists(select 1 from jsonb_object_keys(r) k where k not in('trip_id','raw_source')) then raise exception 'Unsupported operational mapping fields';end if;
  raw:=r->'raw_source';if jsonb_typeof(raw) is distinct from 'array' or jsonb_array_length(raw)<>32 then raise exception 'Original positional CSV row required';end if;
  select * into strict h from public.transport_historical_trip_identity where trip_id=(r->>'trip_id')::uuid and company_id=c and business_unit_id=b and operating_location_id=loc;
  if raw->>0<>h.source_trip_id or raw->>6<>h.driver_name_snapshot or raw->>7 is distinct from h.owner_name_snapshot
  or nullif(raw->>8,'') is distinct from h.vehicle_no_snapshot or raw->>2<>h.truck_type_snapshot
  or to_char(h.source_trip_date,'DD-Mon-YY')<>raw->>1 then raise exception 'Source identity does not match registered CSV';end if;
  perform pg_advisory_xact_lock(hashtextextended('historical-operational:'||h.trip_id::text,0));
  select * into already from public.transport_historical_operational_mapping where trip_id=h.trip_id;
  if found then if already.raw_source is distinct from raw then raise exception 'Different operational source already recorded';end if;skipped:=skipped+1;continue;end if;
  select * into strict t from public.transport_trips where id=h.trip_id and company_id=c and business_unit_id=b and operating_location_id=loc for update;
  if t.transport_source_trip_id is not null and substring(t.notes from 'original positional values (.*)$')::jsonb is distinct from raw then raise exception 'Original raw source mismatch';end if;
  if nullif(btrim(raw->>4),'') is distinct from t.source_invoice_no then raise exception 'Original invoice reference mismatch';end if;
  if t.driver_id is not null or t.vehicle_id is not null then raise exception 'Trip has an independently assigned identity; review without overwriting';end if;
  company_rows:=upper(btrim(raw->>7))='TWAKKAL';cost:=case when company_rows then (raw->>15)::numeric else 0 end;
  driver_label:=btrim(h.driver_name_snapshot);plate:=nullif(btrim(h.vehicle_no_snapshot),'');
  insert into public.transport_historical_mapping_gate values(txid_current(),auth.uid(),h.trip_id);
  select id,driver_type into d,dtype from public.transport_drivers where company_id=c and business_unit_id=b and public.transport_master_normalized_key(driver_name)=public.transport_master_normalized_key(driver_label);
  if not found then
   select count(distinct upper(btrim(owner_name_snapshot))),min(owner_name_snapshot) into own_count,owner_label from public.transport_historical_trip_identity
   where company_id=c and business_unit_id=b and source_file_hash=h.source_file_hash and lower(btrim(driver_name_snapshot))=lower(driver_label);
   dtype:=case when company_rows then 'company' when own_count=1 and upper(btrim(owner_label))<>'TWAKKAL' then 'supplier' else null end;sid:=null;
   if dtype='supplier' then select id into strict sid from public.suppliers where company_id=c and is_active and public.transport_master_normalized_key(name)=public.transport_master_normalized_key(owner_label);end if;
   insert into public.transport_drivers(company_id,business_unit_id,driver_name,driver_type,supplier_id,notes,created_by)
   values(c,b,driver_label,dtype,sid,'Historical CSV source label; spelling aliases not merged; no employment dates or salary invented',auth.uid()) returning id into d;
  end if;
  if not company_rows and dtype='company' then d:=null;end if;
  v:=null;
  if plate is not null and plate<>'0' then
   select id into v from public.transport_vehicles where company_id=c and business_unit_id=b and public.transport_master_normalized_key(vehicle_no)=public.transport_master_normalized_key(plate);
   if not found then
    select count(distinct upper(btrim(owner_name_snapshot))),min(owner_name_snapshot),count(distinct truck_type_snapshot) into own_count,owner_label,type_count
    from public.transport_historical_trip_identity where company_id=c and business_unit_id=b and source_file_hash=h.source_file_hash and vehicle_no_snapshot=h.vehicle_no_snapshot;
    owner_kind:=case when own_count>1 then 'other' when upper(btrim(owner_label))='TWAKKAL' then 'company' else 'supplier' end;sid:=null;tt:=null;
    if owner_kind='supplier' then select id into strict sid from public.suppliers where company_id=c and is_active and public.transport_master_normalized_key(name)=public.transport_master_normalized_key(owner_label);end if;
    if type_count=1 then select id into strict tt from public.transport_truck_types where company_id=c and business_unit_id=b and public.transport_master_normalized_key(name)=public.transport_master_normalized_key(h.truck_type_snapshot);end if;
    insert into public.transport_vehicles(company_id,business_unit_id,vehicle_no,owner_type,ownership_type,supplier_id,truck_type_id,historical_reference_only,notes,created_by)
    values(c,b,plate,owner_kind,case when owner_kind='other' then null else owner_kind end,sid,tt,true,
      'Historical CSV Plate reference; current owner/type and effective ownership periods not inferred. Original Owner/Truck Type preserved per Trip.',auth.uid()) returning id into v;
   end if;
  end if;
  party:=null;if not company_rows then select id into strict party from public.suppliers where company_id=c and is_active and public.transport_master_normalized_key(name)=public.transport_master_normalized_key(h.owner_name_snapshot);end if;
  receiver:=nullif(btrim(raw->>11),'');paper_day:=null;if nullif(btrim(raw->>12),'') is not null then paper_day:=to_date(raw->>12,'DD-Mon-YY');if to_char(paper_day,'DD-Mon-YY')<>raw->>12 then raise exception 'Invalid original Paper Date';end if;end if;
  paper_state:=case when lower(coalesce(receiver,''))='no paper' or (receiver is null and paper_day is null) then 'pending' else 'received' end;
  archived:=null;
  if company_rows then
   select count(*) into row_count from public.transport_trip_supplier_rents where trip_id=t.id;
   if row_count>1 then raise exception 'Company Trip has multiple rent lines; preserve for explicit reconciliation';end if;
   select * into rent from public.transport_trip_supplier_rents where trip_id=t.id;
   if found then
    if rent.amount<>cost or exists(select 1 from public.transport_supplier_document_rents where rent_id=rent.id)
     or not exists(select 1 from public.suppliers where id=rent.supplier_id and company_id=c and upper(btrim(name))='TWAKKAL')
    then raise exception 'Company cost has different or posted supplier evidence';end if;archived:=to_jsonb(rent);
   elsif cost>0 then raise exception 'Original Company cost not present for reclassification';end if;
  end if;
  insert into public.transport_historical_operational_mapping(trip_id,company_id,business_unit_id,operating_location_id,source_file_hash,source_row,raw_source,
   company_owned,company_cost_net,driver_master_id,vehicle_master_id,customer_invoice_ref,supplier_invoice_ref,paper_receiver,paper_date,paper_status,archived_supplier_rent,created_by)
  values(t.id,c,b,loc,h.source_file_hash,h.source_row,raw,company_rows,cost,d,v,nullif(btrim(raw->>4),''),nullif(btrim(raw->>13),''),receiver,paper_day,paper_state,archived,auth.uid());
  if archived is not null then delete from public.transport_trip_supplier_rents where id=rent.id;end if;
  insert into public.transport_action_gate values(txid_current(),t.id,'assignment_replace');
  update public.transport_trips set driver_id=d,vehicle_id=v,owner_supplier_id=party,owner_name_snapshot=h.owner_name_snapshot where id=t.id;
  insert into public.transport_trip_assignments(company_id,business_unit_id,trip_id,vehicle_id,driver_id,vehicle_no_snapshot,driver_name_snapshot,owner_name_snapshot,effective_at,reason,actor_id)
   values(c,b,t.id,v,d,h.vehicle_no_snapshot,h.driver_name_snapshot,h.owner_name_snapshot,now(),'Historical source Master link; no dated ownership inferred; original Trip '||h.source_trip_id,auth.uid());
  delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='assignment_replace';
  if t.ppr_status='pending' and t.ppr_received_by_employee_id is null and t.ppr_attachment_path is null and paper_state='received' then
   update public.transport_trips set ppr_status='received',ppr_received_by_name=receiver,ppr_received_date=paper_day where id=t.id;
  end if;
  insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
   values(c,b,t.id,t.trip_no,'historical_source_mapping',jsonb_build_object('driver_id',t.driver_id,'vehicle_id',t.vehicle_id),
    jsonb_build_object('driver_id',d,'vehicle_id',v,'company_owned',company_rows,'company_cost',cost,'paper_status',paper_state),
    'Original final CSV mapping; TWAKKAL is company fleet; costs are total Company Trip cost, not salary or Supplier payable; no financial posting',auth.uid());
  delete from public.transport_historical_mapping_gate where transaction_id=txid_current() and actor_id=auth.uid() and trip_id=t.id;
  added:=added+1;
 end loop;
 return jsonb_build_object('mapped',added,'skipped',skipped);
end $$;
revoke all on function public.transport_complete_historical_operational_mapping(jsonb) from public,anon;
grant execute on function public.transport_complete_historical_operational_mapping(jsonb) to authenticated;
-- Append evidence to the existing invoker view; retain column order and all grants.
do $$ declare f text;begin
 f:=pg_get_viewdef('public.transport_financial_register'::regclass,true);
 if position('hi.operating_location_id = t.operating_location_id' in f)=0 then raise exception 'Historical Register identity join missing';end if;
 f:=replace(f,'COALESCE(v.vehicle_no, hi.vehicle_no_snapshot) AS vehicle_no','CASE WHEN hm.vehicle_master_id IS NOT DISTINCT FROM t.vehicle_id THEN COALESCE(hi.vehicle_no_snapshot,v.vehicle_no) ELSE COALESCE(v.vehicle_no,hi.vehicle_no_snapshot) END AS vehicle_no');
 f:=replace(f,'COALESCE(d.driver_name, hi.driver_name_snapshot) AS driver_name','CASE WHEN hm.driver_master_id IS NOT DISTINCT FROM t.driver_id THEN COALESCE(hi.driver_name_snapshot,d.driver_name) ELSE COALESCE(d.driver_name,hi.driver_name_snapshot) END AS driver_name');
 f:=replace(f,'f.commission_paid_net,','f.commission_paid_net,');
 f:=replace(f,'f.other_cost_net',E'f.other_cost_net,\n hm.customer_invoice_ref AS historical_customer_invoice_ref,hm.supplier_invoice_ref AS historical_supplier_invoice_ref,hm.company_owned AS historical_company_owned,hm.company_cost_net AS historical_company_cost_net,hm.paper_status AS historical_paper_status');
 f:=rtrim(rtrim(f),';')||' LEFT JOIN public.transport_historical_operational_mapping hm ON hm.trip_id=t.id AND hm.company_id=t.company_id AND hm.business_unit_id=t.business_unit_id AND hm.operating_location_id=t.operating_location_id';
 execute 'create or replace view public.transport_financial_register as '||f;
end $$;
-- Historical invoice refs are display/filter evidence. Invoiced/paid remain canonical.
do $$ declare f text;old text;begin
 select pg_get_functiondef(p.oid) into strict f from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='transport_register_query';
 old:='coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)';
 if position(old in f)=0 then raise exception 'Register cost expression changed';end if;
 f:=replace(f,old,'(coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end)');
 f:=replace(f,'case when cv then cia.order_no end','case when cv then coalesce(cia.order_no,r.historical_customer_invoice_ref) end');
 f:=replace(f,'case when sv then sia.order_nos end','case when sv then coalesce(sia.order_nos,r.historical_supplier_invoice_ref) end');
 execute f;
end $$;
