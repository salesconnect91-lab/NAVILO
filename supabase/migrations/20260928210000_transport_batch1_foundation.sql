-- Transport Batch 1. Existing operational and financial columns remain intact.
-- This migration deliberately leaves transport_trip_register and posting untouched.
create table public.transport_trip_number_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  prefix text not null default 'OIC-' check (length(prefix) between 1 and 24 and prefix !~ '[0-9]$'),
  next_number bigint not null default 1 check (next_number > 0),
  updated_at timestamptz not null default now()
);
create table public.transport_trip_number_registry (
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  trip_no text not null,
  sequence_no bigint,
  trip_id uuid unique,
  issued_at timestamptz not null default now(),
  issued_by uuid,
  primary key (company_id,trip_no),
  unique (company_id,sequence_no)
);
create index transport_trip_number_registry_unit_idx on public.transport_trip_number_registry(company_id,business_unit_id);

do $$ begin
 if exists(select 1 from public.transport_trips group by company_id,trip_no having count(*)>1) then
   raise exception 'Existing company-wide Transport Trip numbers collide; resolve explicitly before migration.';
 end if;
end $$;
insert into public.transport_trip_number_registry(company_id,business_unit_id,trip_no,trip_id,issued_at,issued_by)
select company_id,business_unit_id,trip_no,id,created_at,created_by from public.transport_trips;
insert into public.transport_trip_number_settings(company_id,next_number)
select company_id,coalesce(max(substring(trip_no from '^OIC-([0-9]+)$')::bigint),0)+1
from public.transport_trips group by company_id;
create unique index transport_trips_company_trip_no_uidx on public.transport_trips(company_id,trip_no);

create table public.transport_truck_types (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  business_unit_id uuid not null references public.business_units(id), name text not null check (btrim(name)<>''),
  is_active boolean not null default true, created_by uuid, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique(company_id,business_unit_id,id)
);
create unique index transport_truck_types_name_uidx on public.transport_truck_types(company_id,business_unit_id,lower(btrim(name)));
create table public.transport_locations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  business_unit_id uuid not null references public.business_units(id), name text not null check (btrim(name)<>''),
  city_area text, is_active boolean not null default true, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,business_unit_id,id)
);
create unique index transport_locations_name_uidx on public.transport_locations(company_id,business_unit_id,lower(btrim(name)));
create table public.transport_vehicle_expense_types (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  business_unit_id uuid not null references public.business_units(id), name text not null check (btrim(name)<>''),
  is_active boolean not null default true, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,business_unit_id,id)
);
create unique index transport_vehicle_expense_types_name_uidx on public.transport_vehicle_expense_types(company_id,business_unit_id,lower(btrim(name)));
create table public.transport_customer_rates (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, business_unit_id uuid not null,
 customer_id uuid not null references public.customers(id) on delete restrict,
 from_location_id uuid not null, to_location_id uuid not null, truck_type_id uuid not null,
 effective_from date not null, effective_to date, amount numeric(18,2) not null check(amount>=0),
 is_active boolean not null default true, created_by uuid,created_at timestamptz not null default now(),
 check(effective_to is null or effective_to>=effective_from),
 foreign key(company_id,business_unit_id,from_location_id) references public.transport_locations(company_id,business_unit_id,id),
 foreign key(company_id,business_unit_id,to_location_id) references public.transport_locations(company_id,business_unit_id,id),
 foreign key(company_id,business_unit_id,truck_type_id) references public.transport_truck_types(company_id,business_unit_id,id)
);
create index transport_customer_rates_lookup_idx on public.transport_customer_rates(company_id,business_unit_id,customer_id,from_location_id,to_location_id,truck_type_id,effective_from desc);

alter table public.transport_vehicles add column truck_type_id uuid;
alter table public.transport_vehicles add constraint transport_vehicles_scope_id_unique unique(company_id,business_unit_id,id);
alter table public.transport_drivers add constraint transport_drivers_scope_id_unique unique(company_id,business_unit_id,id);
alter table public.transport_trips add constraint transport_trips_scope_id_unique unique(company_id,business_unit_id,id);
alter table public.transport_trips
  add column truck_type_id uuid, add column from_location_id uuid, add column to_location_id uuid,
  add column lifecycle_status text not null default 'not_complete' check (lifecycle_status in ('not_complete','complete')),
  add column rent_state text not null default 'pending' check (rent_state in ('pending','finalized')),
  add column job_status text generated always as (case when nullif(btrim(po_do_job_no),'') is null then 'pending' else 'done' end) stored,
  add column ppr_received_by_employee_id uuid references public.employees(id) on delete restrict,
  add column ppr_received_by_name text, add column ppr_received_date date, add column ppr_attachment_path text,
  add column customer_rate_state text not null default 'pending' check (customer_rate_state in ('pending','finalized')),
  add column customer_rate_source text check (customer_rate_source in ('agreed','manual','legacy')),
  add column customer_rate_reference_id uuid references public.transport_customer_rates(id) on delete restrict,
  add column customer_rate_snapshot numeric(18,2),
  add column customer_rate_finalized_at timestamptz, add column customer_rate_finalized_by uuid,
  add column rent_finalized_at timestamptz, add column rent_finalized_by uuid,
  add column owner_supplier_id uuid references public.suppliers(id) on delete restrict;
alter table public.transport_vehicles add constraint transport_vehicle_truck_type_fk
 foreign key(company_id,business_unit_id,truck_type_id) references public.transport_truck_types(company_id,business_unit_id,id);
alter table public.transport_trips
 add constraint transport_trip_truck_type_fk foreign key(company_id,business_unit_id,truck_type_id) references public.transport_truck_types(company_id,business_unit_id,id),
 add constraint transport_trip_from_location_fk foreign key(company_id,business_unit_id,from_location_id) references public.transport_locations(company_id,business_unit_id,id),
 add constraint transport_trip_to_location_fk foreign key(company_id,business_unit_id,to_location_id) references public.transport_locations(company_id,business_unit_id,id);
create index transport_trip_states_idx on public.transport_trips(company_id,business_unit_id,lifecycle_status,rent_state,job_status);

create table public.transport_vehicle_ownership (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, business_unit_id uuid not null,
 vehicle_id uuid not null references public.transport_vehicles(id) on delete restrict,
 owner_type text not null check(owner_type in ('company','third_party')),
 supplier_id uuid references public.suppliers(id) on delete restrict, owner_name_snapshot text,
 effective_from date not null, effective_to date,
 change_reason text, created_by uuid, created_at timestamptz not null default now(),
 check(effective_to is null or effective_to>=effective_from),
 check(owner_type<>'third_party' or supplier_id is not null),
 check(owner_type<>'company' or supplier_id is null),
 foreign key(company_id,business_unit_id,vehicle_id) references public.transport_vehicles(company_id,business_unit_id,id),
 unique(company_id,business_unit_id,id)
);
create index transport_vehicle_ownership_date_idx on public.transport_vehicle_ownership(company_id,business_unit_id,vehicle_id,effective_from desc);
alter table public.transport_trips add column ownership_id uuid;
alter table public.transport_trips add constraint transport_trip_ownership_fk
 foreign key(company_id,business_unit_id,ownership_id) references public.transport_vehicle_ownership(company_id,business_unit_id,id);

create table public.transport_trip_supplier_rents (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, business_unit_id uuid not null,
 trip_id uuid not null references public.transport_trips(id) on delete restrict,
 supplier_id uuid not null references public.suppliers(id) on delete restrict,
 supplier_name_snapshot text not null, amount numeric(18,2) not null check(amount>=0),
 state text not null default 'pending' check(state in ('pending','finalized')),
 source text check(source in ('spot','agreed','legacy')), rate_reference_id uuid,
 finalized_amount_snapshot numeric(18,2), finalized_by uuid, finalized_at timestamptz,
 created_by uuid, created_at timestamptz not null default now(),
 foreign key(company_id,business_unit_id,trip_id) references public.transport_trips(company_id,business_unit_id,id)
);
create index transport_trip_supplier_rents_trip_idx on public.transport_trip_supplier_rents(company_id,business_unit_id,trip_id);
create index transport_trip_supplier_rents_supplier_idx on public.transport_trip_supplier_rents(company_id,supplier_id);

create table public.transport_trip_assignments (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, business_unit_id uuid not null,
 trip_id uuid not null, vehicle_id uuid, driver_id uuid,
 vehicle_no_snapshot text, driver_name_snapshot text, owner_name_snapshot text,
 effective_at timestamptz not null default now(), ended_at timestamptz,
 reason text, actor_id uuid, created_at timestamptz not null default now(),
 check(ended_at is null or ended_at>effective_at),
 foreign key(company_id,business_unit_id,trip_id) references public.transport_trips(company_id,business_unit_id,id),
 foreign key(company_id,business_unit_id,vehicle_id) references public.transport_vehicles(company_id,business_unit_id,id),
 foreign key(company_id,business_unit_id,driver_id) references public.transport_drivers(company_id,business_unit_id,id)
);
create unique index transport_trip_current_assignment_uidx on public.transport_trip_assignments(trip_id) where ended_at is null;
create index transport_trip_assignments_history_idx on public.transport_trip_assignments(company_id,business_unit_id,trip_id,effective_at);

create table public.transport_trip_audit (
 id bigint generated always as identity primary key, company_id uuid not null,
 business_unit_id uuid not null, trip_id uuid, trip_no text not null,
 action text not null, old_value jsonb, new_value jsonb,
 reason text, actor_id uuid, occurred_at timestamptz not null default now(),
 foreign key(company_id,business_unit_id,trip_id) references public.transport_trips(company_id,business_unit_id,id) on delete set null (trip_id)
);
create index transport_trip_audit_history_idx on public.transport_trip_audit(company_id,business_unit_id,trip_no,occurred_at);

-- A private transaction token allows narrow RPCs through the same guards without
-- trusting a client-settable session variable. Authenticated has no table grants.
create table public.transport_action_gate (
 transaction_id bigint not null, trip_id uuid not null, action text not null,
 primary key(transaction_id,trip_id,action)
);
revoke all on public.transport_action_gate from public,anon,authenticated;

-- Existing rows are left pending. Only factual current assignments are recorded.
insert into public.transport_trip_assignments(company_id,business_unit_id,trip_id,vehicle_id,driver_id,vehicle_no_snapshot,driver_name_snapshot,owner_name_snapshot,effective_at)
select t.company_id,t.business_unit_id,t.id,t.vehicle_id,t.driver_id,v.vehicle_no,d.driver_name,t.owner_name_snapshot,t.created_at
from public.transport_trips t left join public.transport_vehicles v on v.id=t.vehicle_id
left join public.transport_drivers d on d.id=t.driver_id
where t.vehicle_id is not null or t.driver_id is not null;

-- Controlled guards and RPCs below govern all new Trip writes in this migration.

create or replace function public.has_transport_action_permission(p_company_id uuid,p_action text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_role text; v_permissions jsonb; v_override jsonb;
begin
 if auth.uid() is null or p_company_id is distinct from public.current_company_id()
   or not public.has_module_permission(p_company_id,'transport','view') then return false; end if;
 if public.is_platform_owner() then return true; end if;
 select role,permissions into v_role,v_permissions from public.business_unit_memberships
 where company_id=p_company_id and business_unit_id=public.current_business_unit_id()
   and user_id=auth.uid() and is_active limit 1;
 if v_role is null then return false; end if;
 v_override:=v_permissions#>array['transport_actions',p_action];
 if jsonb_typeof(v_override)='boolean' then return v_override::text::boolean; end if;
 -- Explicit company-level denial also wins, unless a BU-specific override exists.
 select permissions#>array['transport_actions',p_action] into v_override
 from public.company_memberships where company_id=p_company_id and user_id=auth.uid() and is_active limit 1;
 if jsonb_typeof(v_override)='boolean' then return v_override::text::boolean; end if;
 return v_role in ('company_owner','admin') or public.is_platform_owner();
end $$;
revoke all on function public.has_transport_action_permission(uuid,text) from public,anon;
grant execute on function public.has_transport_action_permission(uuid,text) to authenticated;

create or replace function public.transport_batch1_guard() returns trigger language plpgsql
security definer set search_path=public,pg_temp as $$
declare v_name text; v_company uuid;
begin
 if new.company_id is distinct from public.current_company_id()
   or new.business_unit_id is distinct from public.current_business_unit_id()
   or not public.has_module_permission(new.company_id,'transport','view')
 then raise exception 'Transport workspace permission required'; end if;
 if tg_op='INSERT' and tg_table_name<>'transport_trip_assignments' then new.created_by:=auth.uid(); end if;
 if tg_table_name in ('transport_truck_types','transport_locations','transport_vehicle_expense_types') then
   if not public.has_transport_action_permission(new.company_id,'master_manage') then raise exception 'Transport master permission required'; end if;
 elsif tg_table_name='transport_customer_rates' then
   if not public.has_transport_action_permission(new.company_id,'customer_rate_finalize') then raise exception 'Rate-card permission required'; end if;
   if not exists(select 1 from public.customers where id=new.customer_id and company_id=new.company_id) then raise exception 'Customer company mismatch'; end if;
   perform pg_advisory_xact_lock(hashtextextended(new.company_id::text||new.business_unit_id::text||new.customer_id::text||new.from_location_id::text||new.to_location_id::text||new.truck_type_id::text,0));
   if exists(select 1 from public.transport_customer_rates r where r.id<>new.id and r.company_id=new.company_id
      and r.business_unit_id=new.business_unit_id and r.customer_id=new.customer_id
      and r.from_location_id=new.from_location_id and r.to_location_id=new.to_location_id
      and r.truck_type_id=new.truck_type_id and r.is_active and new.is_active
      and daterange(r.effective_from,coalesce(r.effective_to+1,'infinity'::date),'[)')
       && daterange(new.effective_from,coalesce(new.effective_to+1,'infinity'::date),'[)'))
   then raise exception 'Customer rate periods overlap'; end if;
 elsif tg_table_name='transport_vehicle_ownership' then
   if not public.has_transport_action_permission(new.company_id,'vehicle_owner_change') then raise exception 'Vehicle owner change permission required'; end if;
   perform pg_advisory_xact_lock(hashtextextended(new.vehicle_id::text,0));
   if tg_op='UPDATE' then
     if (new.company_id,new.business_unit_id,new.vehicle_id,new.owner_type,new.supplier_id,new.owner_name_snapshot,new.effective_from)
       is distinct from (old.company_id,old.business_unit_id,old.vehicle_id,old.owner_type,old.supplier_id,old.owner_name_snapshot,old.effective_from)
     then raise exception 'Historical ownership identity is immutable'; end if;
     if new.effective_to is distinct from old.effective_to and nullif(btrim(new.change_reason),'') is null
     then raise exception 'Ownership end-date correction requires a reason'; end if;
   end if;
   select company_id into v_company from public.suppliers where id=new.supplier_id;
   if new.supplier_id is not null and v_company is distinct from new.company_id then raise exception 'Supplier company mismatch'; end if;
   if exists(select 1 from public.transport_vehicle_ownership o
     where o.vehicle_id=new.vehicle_id and o.id<>new.id
       and daterange(o.effective_from,coalesce(o.effective_to+1,'infinity'::date),'[)')
           && daterange(new.effective_from,coalesce(new.effective_to+1,'infinity'::date),'[)'))
   then raise exception 'Vehicle ownership periods overlap'; end if;
 elsif tg_table_name='transport_trip_supplier_rents' then
   if not public.has_transport_action_permission(new.company_id,
     case when tg_op='INSERT' or (tg_op='UPDATE' and old.state='pending') then 'rent_finalize' else 'rent_correct' end)
   then raise exception 'Supplier rent permission required'; end if;
   select company_id,name into v_company,v_name from public.suppliers where id=new.supplier_id;
   if v_company is distinct from new.company_id then raise exception 'Supplier company mismatch'; end if;
   if tg_op='INSERT' then
     if exists(select 1 from public.transport_trips where id=new.trip_id and rent_state='finalized') then raise exception 'Trip already complete'; end if;
     if exists(select 1 from public.transport_trips where id=new.trip_id and owner_rent<>0)
       then raise exception 'Legacy owner rent must be zero before structured supplier rents are added'; end if;
     new.supplier_name_snapshot:=v_name;
   end if;
   if tg_op='UPDATE' and (new.company_id,new.business_unit_id,new.trip_id) is distinct from
      (old.company_id,old.business_unit_id,old.trip_id) then raise exception 'Supplier rent Trip identity is immutable'; end if;
   if tg_op='INSERT' and new.state<>'pending' then raise exception 'New supplier rent must start pending'; end if;
   if tg_op='UPDATE' and (new.state,new.finalized_amount_snapshot,new.finalized_by,new.finalized_at) is distinct from
      (old.state,old.finalized_amount_snapshot,old.finalized_by,old.finalized_at)
      and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.trip_id and action='supplier_rent_finalize')
      then raise exception 'Supplier rent finalization requires controlled action'; end if;
   if tg_op='UPDATE' and old.state='finalized' and (new.amount,new.supplier_id) is distinct from (old.amount,old.supplier_id)
     and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.trip_id and action='supplier_rent_finalize')
     then raise exception 'Finalized supplier rent requires controlled correction'; end if;
 elsif tg_table_name='transport_trip_assignments' then
   if not exists(select 1 from public.transport_action_gate
       where transaction_id=txid_current() and trip_id=new.trip_id and action in ('assignment_replace','assignment_initial'))
      then raise exception 'Assignments are historical; use controlled replacement'; end if;
   if not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.trip_id and action='assignment_initial') then
     if not public.has_transport_action_permission(new.company_id,'assignment_replace') then raise exception 'Replacement permission required'; end if;
     if tg_op='INSERT' and nullif(btrim(new.reason),'') is null then raise exception 'Replacement reason required'; end if;
   end if;
 end if;
 return new;
end $$;
revoke all on function public.transport_batch1_guard() from public,anon,authenticated;

do $$ declare t text; begin
 foreach t in array array['transport_truck_types','transport_locations','transport_vehicle_expense_types','transport_customer_rates','transport_vehicle_ownership','transport_trip_supplier_rents','transport_trip_assignments'] loop
   execute format('create trigger %I before insert or update on public.%I for each row execute function public.transport_batch1_guard()',t||'_guard',t);
 end loop;
end $$;

create or replace function public.transport_trip_batch1_guard() returns trigger language plpgsql
security definer set search_path=public,pg_temp as $$
declare v_no text; v_seq bigint; v_prefix text; v_name text; v_owner public.transport_vehicle_ownership%rowtype;
begin
 if tg_op='INSERT' then
   if not public.has_transport_action_permission(new.company_id,'trip_create') then raise exception 'Trip create permission required'; end if;
   insert into public.transport_trip_number_settings(company_id) values(new.company_id) on conflict do nothing;
   select prefix,next_number into v_prefix,v_seq from public.transport_trip_number_settings where company_id=new.company_id for update;
   loop
     v_no:=v_prefix||lpad(v_seq::text,6,'0');
     exit when not exists(select 1 from public.transport_trip_number_registry where company_id=new.company_id and trip_no=v_no);
     v_seq:=v_seq+1;
   end loop;
   update public.transport_trip_number_settings set next_number=v_seq+1,updated_at=now() where company_id=new.company_id;
   new.trip_no:=v_no;
   new.status:='draft'; new.lifecycle_status:='not_complete'; new.rent_state:='pending'; new.customer_rate_state:='pending';
   if new.vehicle_id is not null then
     select * into v_owner from public.transport_vehicle_ownership
     where vehicle_id=new.vehicle_id and company_id=new.company_id and business_unit_id=new.business_unit_id
       and effective_from<=new.trip_date and (effective_to is null or effective_to>=new.trip_date)
     order by effective_from desc limit 1;
     if found then
       new.ownership_id:=v_owner.id; new.owner_supplier_id:=v_owner.supplier_id;
       new.owner_name_snapshot:=v_owner.owner_name_snapshot;
     end if;
   end if;
   insert into public.transport_trip_number_registry(company_id,business_unit_id,trip_no,sequence_no,trip_id,issued_by)
   values(new.company_id,new.business_unit_id,v_no,v_seq,new.id,auth.uid());
 else
   if (new.company_id,new.business_unit_id,new.trip_no) is distinct from (old.company_id,old.business_unit_id,old.trip_no)
      then raise exception 'Trip number and tenant scope are immutable'; end if;
   if new.status is distinct from old.status then raise exception 'Legacy status cannot be set manually'; end if;
   if new.trip_date is distinct from old.trip_date then raise exception 'Trip date correction requires controlled ownership review'; end if;
   if not public.has_transport_action_permission(new.company_id,'trip_edit')
      and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id
        and action in ('rent_finalize','rent_correct','customer_rate_finalize','assignment_replace'))
      then raise exception 'Trip edit permission required'; end if;
   if (new.lifecycle_status,new.rent_state,new.rent_finalized_at,new.rent_finalized_by) is distinct from
      (old.lifecycle_status,old.rent_state,old.rent_finalized_at,old.rent_finalized_by)
      and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='rent_finalize')
      then raise exception 'Rent lifecycle requires controlled finalization'; end if;
   if (new.customer_rate_state,new.customer_rate_snapshot,new.customer_rate_finalized_at,new.customer_rate_finalized_by) is distinct from
      (old.customer_rate_state,old.customer_rate_snapshot,old.customer_rate_finalized_at,old.customer_rate_finalized_by)
      and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='customer_rate_finalize')
      then raise exception 'Customer rate requires controlled finalization'; end if;
   if new.owner_rent is distinct from old.owner_rent and old.rent_state='finalized'
      and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='rent_correct')
      then raise exception 'Finalized owner rent requires controlled correction'; end if;
   if new.owner_rent<>0 and exists(select 1 from public.transport_trip_supplier_rents where trip_id=new.id)
      then raise exception 'Structured supplier rents require zero legacy owner rent'; end if;
   if (new.vehicle_id,new.driver_id) is distinct from (old.vehicle_id,old.driver_id)
      and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='assignment_replace')
      then raise exception 'Driver/vehicle replacement requires controlled action'; end if;
   if (new.ownership_id,new.owner_supplier_id,new.owner_name_snapshot) is distinct from
      (old.ownership_id,old.owner_supplier_id,old.owner_name_snapshot)
      and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='assignment_replace')
      then raise exception 'Ownership snapshot requires controlled replacement'; end if;
   if (new.customer_rate_source,new.customer_rate_reference_id) is distinct from
      (old.customer_rate_source,old.customer_rate_reference_id) and old.customer_rate_state='finalized'
      and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='customer_rate_finalize')
      then raise exception 'Finalized rate source is immutable without override'; end if;
 end if;
 if new.customer_id is not null and not exists(select 1 from public.customers where id=new.customer_id and company_id=new.company_id)
 then raise exception 'Customer company mismatch'; end if;
 if new.vehicle_id is not null and not exists(select 1 from public.transport_vehicles
   where id=new.vehicle_id and company_id=new.company_id and business_unit_id=new.business_unit_id and is_active)
 then raise exception 'Active vehicle not found in Trip workspace'; end if;
 if new.driver_id is not null and not exists(select 1 from public.transport_drivers
   where id=new.driver_id and company_id=new.company_id and business_unit_id=new.business_unit_id and is_active)
 then raise exception 'Active driver not found in Trip workspace'; end if;
 if new.truck_type_id is not null and not exists(select 1 from public.transport_truck_types where id=new.truck_type_id and is_active)
 then raise exception 'Inactive or missing Truck Type'; end if;
 if new.from_location_id is not null and not exists(select 1 from public.transport_locations where id=new.from_location_id and is_active)
 then raise exception 'Inactive or missing From Location'; end if;
 if new.to_location_id is not null and not exists(select 1 from public.transport_locations where id=new.to_location_id and is_active)
 then raise exception 'Inactive or missing To Location'; end if;
 if new.owner_supplier_id is not null and not exists(select 1 from public.suppliers where id=new.owner_supplier_id and company_id=new.company_id)
 then raise exception 'Owner supplier company mismatch'; end if;
 if new.ownership_id is not null and not exists(select 1 from public.transport_vehicle_ownership
   where id=new.ownership_id and vehicle_id=new.vehicle_id and company_id=new.company_id
     and business_unit_id=new.business_unit_id and effective_from<=new.trip_date
     and (effective_to is null or effective_to>=new.trip_date))
 then raise exception 'Vehicle ownership does not cover Trip date'; end if;
 if new.ppr_status='received' then
   if (tg_op='INSERT' or (new.ppr_status,new.ppr_received_by_employee_id,new.ppr_received_date,new.ppr_attachment_path) is distinct from
      (old.ppr_status,old.ppr_received_by_employee_id,old.ppr_received_date,old.ppr_attachment_path))
      and not public.has_transport_action_permission(new.company_id,'ppr_receive') then raise exception 'PPR receipt permission required'; end if;
   if tg_op='INSERT' or old.ppr_status is distinct from new.ppr_status
      or old.ppr_received_by_employee_id is distinct from new.ppr_received_by_employee_id
      or old.ppr_received_date is distinct from new.ppr_received_date then
     if new.ppr_received_by_employee_id is null or new.ppr_received_date is null then raise exception 'PPR received requires employee and date'; end if;
     select name into v_name from public.employees where id=new.ppr_received_by_employee_id and company_id=new.company_id and is_active;
     if v_name is null then raise exception 'PPR employee company mismatch or inactive'; end if;
     new.ppr_received_by_name:=v_name;
   end if;
 elsif new.ppr_received_by_employee_id is not null or new.ppr_received_date is not null then
   raise exception 'PPR receipt details require received status';
 end if;
 if tg_op='UPDATE' and new.po_do_job_no is distinct from old.po_do_job_no then
   insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,actor_id)
   values(new.company_id,new.business_unit_id,new.id,new.trip_no,'job_change',to_jsonb(old.po_do_job_no),to_jsonb(new.po_do_job_no),auth.uid());
 end if;
 if tg_op='UPDATE' and (new.ppr_status,new.ppr_received_by_employee_id,new.ppr_received_date) is distinct from
    (old.ppr_status,old.ppr_received_by_employee_id,old.ppr_received_date) then
   insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,actor_id)
   values(new.company_id,new.business_unit_id,new.id,new.trip_no,'ppr_change',
     jsonb_build_object('status',old.ppr_status,'employee_id',old.ppr_received_by_employee_id,'date',old.ppr_received_date),
     jsonb_build_object('status',new.ppr_status,'employee_id',new.ppr_received_by_employee_id,'date',new.ppr_received_date),auth.uid());
 end if;
 if tg_op='UPDATE' and new.customer_rate is distinct from old.customer_rate and old.customer_rate_state='finalized'
    and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='customer_rate_finalize')
    then raise exception 'Finalized customer rate requires controlled override'; end if;
 return new;
end $$;
revoke all on function public.transport_trip_batch1_guard() from public,anon,authenticated;
create trigger zz_transport_trip_batch1_guard before insert or update on public.transport_trips
for each row execute function public.transport_trip_batch1_guard();

create or replace function public.transport_trip_batch1_created() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.transport_vehicles%rowtype; d public.transport_drivers%rowtype;
begin
 if new.vehicle_id is not null or new.driver_id is not null then
   if new.vehicle_id is not null then select * into v from public.transport_vehicles where id=new.vehicle_id; end if;
   if new.driver_id is not null then select * into d from public.transport_drivers where id=new.driver_id; end if;
   insert into public.transport_action_gate values(txid_current(),new.id,'assignment_initial');
   insert into public.transport_trip_assignments(company_id,business_unit_id,trip_id,vehicle_id,driver_id,
     vehicle_no_snapshot,driver_name_snapshot,owner_name_snapshot,effective_at,actor_id)
   values(new.company_id,new.business_unit_id,new.id,new.vehicle_id,new.driver_id,
     v.vehicle_no,d.driver_name,new.owner_name_snapshot,new.created_at,auth.uid());
   delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='assignment_initial';
 end if;
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,new_value,actor_id)
 values(new.company_id,new.business_unit_id,new.id,new.trip_no,'created',
   jsonb_build_object('trip_date',new.trip_date,'vehicle_id',new.vehicle_id,'driver_id',new.driver_id),auth.uid());
 return new;
end $$;
revoke all on function public.transport_trip_batch1_created() from public,anon,authenticated;
create trigger zz_transport_trip_created after insert on public.transport_trips
for each row execute function public.transport_trip_batch1_created();

create or replace function public.transport_trip_delete_guard() returns trigger language plpgsql as $$
begin raise exception 'Transport Trip deletion requires a controlled audited operation'; end $$;
create trigger transport_trip_delete_protected before delete on public.transport_trips
for each row execute function public.transport_trip_delete_guard();

create or replace function public.transport_set_trip_prefix(p_prefix text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_company uuid:=public.current_company_id();
begin
 if not public.has_transport_action_permission(v_company,'number_config') then raise exception 'Transport number configuration permission required'; end if;
 if p_prefix is null or length(p_prefix) not between 1 and 24 or p_prefix ~ '[0-9]$' then raise exception 'Invalid Transport prefix'; end if;
 insert into public.transport_trip_number_settings(company_id,prefix) values(v_company,p_prefix)
 on conflict(company_id) do update set prefix=excluded.prefix,updated_at=now();
end $$;
revoke all on function public.transport_set_trip_prefix(text) from public,anon;
grant execute on function public.transport_set_trip_prefix(text) to authenticated;

create or replace function public.transport_finalize_trip_rent(p_trip_id uuid,p_reason text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype; v_action text; v_pending integer;
begin
 select * into t from public.transport_trips where id=p_trip_id for update;
 if not found or t.company_id is distinct from public.current_company_id() or t.business_unit_id is distinct from public.current_business_unit_id()
 then raise exception 'Transport Trip not found in active workspace'; end if;
 v_action:=case when t.rent_state='finalized' then 'rent_correct' else 'rent_finalize' end;
 if not public.has_transport_action_permission(t.company_id,v_action) then raise exception 'Rent action permission required'; end if;
 if v_action='rent_correct' and nullif(btrim(p_reason),'') is null then raise exception 'Correction reason required'; end if;
 select count(*) into v_pending from public.transport_trip_supplier_rents where trip_id=t.id and state<>'finalized';
 if v_pending>0 then raise exception 'All supplier rents must be finalized first'; end if;
 if (exists(select 1 from public.transport_vehicle_ownership o where o.id=t.ownership_id and o.owner_type='third_party')
     or (t.ownership_id is null and exists(select 1 from public.transport_vehicles v where v.id=t.vehicle_id and v.owner_type='supplier')))
   and not exists(select 1 from public.transport_trip_supplier_rents where trip_id=t.id)
 then raise exception 'Third-party Trip requires a supplier rent line'; end if;
 insert into public.transport_action_gate values(txid_current(),t.id,'rent_finalize');
 update public.transport_trips set rent_state='finalized',lifecycle_status='complete',rent_finalized_at=coalesce(rent_finalized_at,now()),
 rent_finalized_by=coalesce(rent_finalized_by,auth.uid()) where id=t.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='rent_finalize';
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,t.trip_no,v_action,to_jsonb(t.owner_rent),
   (select jsonb_build_object('owner_rent',owner_rent,'supplier_rents',
      (select coalesce(sum(amount),0) from public.transport_trip_supplier_rents where trip_id=t.id)) from public.transport_trips where id=t.id),
   p_reason,auth.uid());
end $$;
revoke all on function public.transport_finalize_trip_rent(uuid,text) from public,anon;
grant execute on function public.transport_finalize_trip_rent(uuid,text) to authenticated;

create or replace function public.transport_correct_trip_rent(p_trip_id uuid,p_owner_rent numeric,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;
begin
 select * into t from public.transport_trips where id=p_trip_id for update;
 if not found or t.company_id is distinct from public.current_company_id() or t.business_unit_id is distinct from public.current_business_unit_id()
   or t.rent_state<>'finalized' then raise exception 'Finalized Transport Trip not found'; end if;
 if not public.has_transport_action_permission(t.company_id,'rent_correct') or nullif(btrim(p_reason),'') is null
 then raise exception 'Authorized correction and reason required'; end if;
 if p_owner_rent is null or p_owner_rent<0 then raise exception 'Invalid rent'; end if;
 if exists(select 1 from public.transport_trip_supplier_rents where trip_id=t.id) then raise exception 'Correct structured supplier rent on its own line'; end if;
 -- Compatibility amount is retained; lifecycle remains complete. Existing register is unchanged.
 insert into public.transport_action_gate values(txid_current(),t.id,'rent_correct');
 update public.transport_trips set owner_rent=p_owner_rent where id=t.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='rent_correct';
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,t.trip_no,'rent_correct',to_jsonb(t.owner_rent),to_jsonb(p_owner_rent),p_reason,auth.uid());
end $$;
revoke all on function public.transport_correct_trip_rent(uuid,numeric,text) from public,anon;
grant execute on function public.transport_correct_trip_rent(uuid,numeric,text) to authenticated;

create or replace function public.transport_finalize_customer_rate(p_trip_id uuid,p_amount numeric,p_source text,p_reason text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype; v_action text;
begin
 select * into t from public.transport_trips where id=p_trip_id for update;
 if not found or t.company_id is distinct from public.current_company_id() or t.business_unit_id is distinct from public.current_business_unit_id()
 then raise exception 'Transport Trip not found'; end if;
 v_action:=case when t.customer_rate_state='finalized' then 'customer_rate_override' else 'customer_rate_finalize' end;
 if not public.has_transport_action_permission(t.company_id,v_action) then raise exception 'Customer rate permission required'; end if;
 if v_action='customer_rate_override' and nullif(btrim(p_reason),'') is null then raise exception 'Override reason required'; end if;
 if p_amount is null or p_amount<0 or p_source not in ('agreed','manual') then raise exception 'Invalid customer rate/source'; end if;
 insert into public.transport_action_gate values(txid_current(),t.id,'customer_rate_finalize');
 update public.transport_trips set customer_rate=p_amount,customer_rate_snapshot=p_amount,customer_rate_state='finalized',
  customer_rate_source=p_source,customer_rate_finalized_at=now(),customer_rate_finalized_by=auth.uid() where id=t.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='customer_rate_finalize';
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,t.trip_no,v_action,to_jsonb(t.customer_rate),to_jsonb(p_amount),p_reason,auth.uid());
end $$;
revoke all on function public.transport_finalize_customer_rate(uuid,numeric,text,text) from public,anon;
grant execute on function public.transport_finalize_customer_rate(uuid,numeric,text,text) to authenticated;

create or replace function public.transport_finalize_supplier_rent(p_rent_id uuid,p_amount numeric,p_reason text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.transport_trip_supplier_rents%rowtype; t public.transport_trips%rowtype; v_action text;
begin
 select * into r from public.transport_trip_supplier_rents where id=p_rent_id for update;
 if not found then raise exception 'Supplier rent not found'; end if;
 select * into t from public.transport_trips where id=r.trip_id for update;
 if r.company_id is distinct from public.current_company_id() or r.business_unit_id is distinct from public.current_business_unit_id()
 then raise exception 'Supplier rent outside active workspace'; end if;
 v_action:=case when r.state='finalized' then 'rent_correct' else 'rent_finalize' end;
 if not public.has_transport_action_permission(r.company_id,v_action) then raise exception 'Rent permission required'; end if;
 if v_action='rent_correct' and nullif(btrim(p_reason),'') is null then raise exception 'Correction reason required'; end if;
 if p_amount is null or p_amount<0 then raise exception 'Invalid rent amount'; end if;
 insert into public.transport_action_gate values(txid_current(),r.trip_id,'supplier_rent_finalize');
 update public.transport_trip_supplier_rents set amount=p_amount,state='finalized',finalized_amount_snapshot=p_amount,
 finalized_by=auth.uid(),finalized_at=now() where id=r.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=r.trip_id and action='supplier_rent_finalize';
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(r.company_id,r.business_unit_id,r.trip_id,t.trip_no,v_action,
  jsonb_build_object('supplier_id',r.supplier_id,'amount',r.amount),
  jsonb_build_object('supplier_id',r.supplier_id,'amount',p_amount),p_reason,auth.uid());
end $$;
revoke all on function public.transport_finalize_supplier_rent(uuid,numeric,text) from public,anon;
grant execute on function public.transport_finalize_supplier_rent(uuid,numeric,text) to authenticated;

create or replace function public.transport_replace_trip_assignment(p_trip_id uuid,p_vehicle_id uuid,p_driver_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype; v public.transport_vehicles%rowtype; d public.transport_drivers%rowtype;
 o public.transport_vehicle_ownership%rowtype;
 v_replaced_at timestamptz;
begin
 select * into t from public.transport_trips where id=p_trip_id for update;
 if not found or t.company_id is distinct from public.current_company_id() or t.business_unit_id is distinct from public.current_business_unit_id()
 then raise exception 'Transport Trip not found'; end if;
 if not public.has_transport_action_permission(t.company_id,'assignment_replace') or nullif(btrim(p_reason),'') is null
 then raise exception 'Replacement permission and reason required'; end if;
 if (p_vehicle_id,p_driver_id) is not distinct from (t.vehicle_id,t.driver_id) then raise exception 'Assignment did not change'; end if;
 if p_vehicle_id is not null then
  select * into v from public.transport_vehicles where id=p_vehicle_id and company_id=t.company_id and business_unit_id=t.business_unit_id and is_active;
  if not found then raise exception 'Active vehicle not found in workspace'; end if;
 end if;
 if p_driver_id is not null then
  select * into d from public.transport_drivers where id=p_driver_id and company_id=t.company_id and business_unit_id=t.business_unit_id and is_active;
  if not found then raise exception 'Active driver not found in workspace'; end if;
 end if;
 if p_vehicle_id is not null then
   select * into o from public.transport_vehicle_ownership where vehicle_id=p_vehicle_id
     and effective_from<=t.trip_date and (effective_to is null or effective_to>=t.trip_date)
     order by effective_from desc limit 1;
 end if;
 insert into public.transport_action_gate values(txid_current(),t.id,'assignment_replace');
 v_replaced_at := clock_timestamp();  update public.transport_trip_assignments  set ended_at=greatest(v_replaced_at,effective_at + interval '1 microsecond')  where trip_id=t.id and ended_at is null;  select ended_at into v_replaced_at  from public.transport_trip_assignments  where trip_id=t.id and ended_at is not null  order by ended_at desc  limit 1;
 insert into public.transport_trip_assignments(company_id,business_unit_id,trip_id,vehicle_id,driver_id,
 vehicle_no_snapshot,driver_name_snapshot,owner_name_snapshot,effective_at,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,p_vehicle_id,p_driver_id,v.vehicle_no,d.driver_name,
   coalesce(o.owner_name_snapshot,v.owner_name),v_replaced_at,p_reason,auth.uid());
 update public.transport_trips set vehicle_id=p_vehicle_id,driver_id=p_driver_id,
   ownership_id=o.id,owner_supplier_id=o.supplier_id,owner_name_snapshot=coalesce(o.owner_name_snapshot,v.owner_name)
 where id=t.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='assignment_replace';
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,t.trip_no,'assignment_replace',
 jsonb_build_object('vehicle_id',t.vehicle_id,'driver_id',t.driver_id),
 jsonb_build_object('vehicle_id',p_vehicle_id,'driver_id',p_driver_id),p_reason,auth.uid());
end $$;
revoke all on function public.transport_replace_trip_assignment(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.transport_replace_trip_assignment(uuid,uuid,uuid,text) to authenticated;

create or replace function public.transport_number_registry_guard() returns trigger language plpgsql as $$
begin raise exception 'Issued Transport Trip numbers cannot be changed or removed'; end $$;
create trigger transport_number_registry_immutable before update or delete on public.transport_trip_number_registry
for each row execute function public.transport_number_registry_guard();
create or replace function public.transport_audit_guard() returns trigger language plpgsql as $$
begin raise exception 'Transport audit is append only'; end $$;
create trigger transport_audit_immutable before update or delete on public.transport_trip_audit
for each row execute function public.transport_audit_guard();

do $$ declare t text; begin
 foreach t in array array['transport_truck_types','transport_locations','transport_vehicle_expense_types','transport_customer_rates','transport_vehicle_ownership','transport_trip_supplier_rents','transport_trip_assignments','transport_trip_audit','transport_trip_number_settings','transport_trip_number_registry','transport_action_gate'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public,anon,authenticated',t);
   if t='transport_action_gate' then continue; end if;
   execute format('create policy %I on public.%I for select to authenticated using (company_id=public.current_company_id() and %s and public.has_module_permission(company_id,''transport'',''view''))',t||'_read',t,
      case when t in ('transport_trip_number_settings','transport_trip_number_registry') then 'true' else 'business_unit_id=public.current_business_unit_id()' end);
 end loop;
 foreach t in array array['transport_truck_types','transport_locations','transport_vehicle_expense_types','transport_customer_rates','transport_vehicle_ownership','transport_trip_supplier_rents','transport_trip_assignments'] loop
   execute format('create policy %I on public.%I for insert to authenticated with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''transport'',''create''))',t||'_insert',t);
   execute format('create policy %I on public.%I for update to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''transport'',''edit'')) with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id())',t||'_update',t);
   execute format('grant select,insert,update on public.%I to authenticated',t);
 end loop;
end $$;
grant select on public.transport_trip_audit,public.transport_trip_number_settings,public.transport_trip_number_registry to authenticated;
