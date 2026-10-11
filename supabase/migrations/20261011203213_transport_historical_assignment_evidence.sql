-- Historical identity evidence only. No rates, payments, ownership or postings.
create table public.transport_historical_trip_identity (
 trip_id uuid primary key,
 company_id uuid not null,
 business_unit_id uuid not null,
 operating_location_id uuid not null references public.operating_locations(id),
 source_company text not null check (btrim(source_company)<>''),
 source_trip_id text not null check (source_trip_id ~ '^[0-9]+$'),
 source_file_hash text not null check (source_file_hash ~ '^[a-f0-9]{64}$'),
 source_row integer not null check (source_row>=2),
 source_trip_date date not null,
 driver_name_snapshot text not null,
 vehicle_no_snapshot text,
 owner_name_snapshot text,
 truck_type_snapshot text,
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(company_id,business_unit_id,trip_id) references public.transport_trips(company_id,business_unit_id,id),
 unique(company_id,business_unit_id,source_company,source_trip_id)
);
alter table public.transport_historical_trip_identity enable row level security;
revoke all on public.transport_historical_trip_identity from public,anon,authenticated;
grant select,insert on public.transport_historical_trip_identity to authenticated;
create policy transport_historical_identity_read on public.transport_historical_trip_identity
for select to authenticated using (
 auth.uid() is not null and company_id=(select public.current_company_id())
 and business_unit_id=(select public.current_business_unit_id())
 and operating_location_id=(select public.current_operating_location_id())
 and public.has_module_permission(company_id,'transport','view')
 and public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')
);
create policy transport_historical_identity_insert on public.transport_historical_trip_identity
for insert to authenticated with check (
 created_by=auth.uid() and company_id=(select public.current_company_id())
 and business_unit_id=(select public.current_business_unit_id())
 and operating_location_id=(select public.current_operating_location_id())
 and public.has_module_permission(company_id,'transport','edit')
 and public.has_transport_action_permission(company_id,'assignment_replace')
 and public.has_transport_action_permission(company_id,'master_manage')
);
create function public.transport_historical_identity_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare t public.transport_trips;
begin
 if tg_op<>'INSERT' then raise exception 'Historical identity evidence is immutable';end if;
 if auth.uid() is null or new.created_by is distinct from auth.uid()
 or new.company_id is distinct from public.current_company_id()
 or new.business_unit_id is distinct from public.current_business_unit_id()
 or new.operating_location_id is distinct from public.current_operating_location_id()
 or not public.has_module_permission(new.company_id,'transport','edit')
 or not public.has_transport_action_permission(new.company_id,'assignment_replace')
 or not public.has_transport_action_permission(new.company_id,'master_manage')
 then raise exception 'Historical identity import permission and active workspace required';end if;
 select * into t from public.transport_trips where id=new.trip_id
 and company_id=new.company_id and business_unit_id=new.business_unit_id
 and operating_location_id=new.operating_location_id for share;
 if not found then raise exception 'Historical Trip outside active workspace/branch';end if;
 if t.trip_date is distinct from new.source_trip_date
 or not (
   (t.transport_source_company=new.source_company and t.transport_source_trip_id=new.source_trip_id)
   or substring(t.notes from '^Legacy CSV Trip ([0-9]+);')=new.source_trip_id
 ) is true then raise exception 'Original Trip reference/date does not match existing Trip';end if;
 if nullif(btrim(new.driver_name_snapshot),'') is null then raise exception 'Original Driver Name required';end if;
 return new;
end $$;
revoke all on function public.transport_historical_identity_guard() from public,anon,authenticated;
create trigger transport_historical_identity_immutable before insert or update or delete
on public.transport_historical_trip_identity for each row execute function public.transport_historical_identity_guard();

create function public.transport_attach_historical_trip_identity(p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 r jsonb;saved public.transport_historical_trip_identity;tid uuid;added integer:=0;skipped integer:=0;
begin
 if auth.uid() is null or c is null or b is null or loc is null
 or not public.has_module_permission(c,'transport','edit')
 or not public.has_transport_action_permission(c,'assignment_replace')
 or not public.has_transport_action_permission(c,'master_manage')
 or not public.transport_financial_read_allowed('customer') or not public.transport_financial_read_allowed('supplier')
 then raise exception 'Historical identity import permission and active workspace required';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100
 or octet_length(p_rows::text)>250000 then raise exception '1–100 original identity rows required';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x group by x->>'trip_id' having count(*)>1)
 then raise exception 'Duplicate Trip in identity batch';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r) is distinct from 'object' or exists(select 1 from jsonb_object_keys(r) k where k not in
   ('trip_id','source_company','source_trip_id','source_file_hash','source_row','source_trip_date',
    'driver_name_snapshot','vehicle_no_snapshot','owner_name_snapshot','truck_type_snapshot'))
  then raise exception 'Unsupported historical identity fields';end if;
  tid:=(r->>'trip_id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('historical-trip-identity:'||tid::text,0));
  select * into saved from public.transport_historical_trip_identity where trip_id=tid;
  if found then
   if (saved.company_id,saved.business_unit_id,saved.operating_location_id,saved.source_company,saved.source_trip_id,
       saved.source_file_hash,saved.source_row,saved.source_trip_date,saved.driver_name_snapshot,saved.vehicle_no_snapshot,
       saved.owner_name_snapshot,saved.truck_type_snapshot) is distinct from
      (c,b,loc,r->>'source_company',r->>'source_trip_id',r->>'source_file_hash',(r->>'source_row')::integer,
       (r->>'source_trip_date')::date,r->>'driver_name_snapshot',r->>'vehicle_no_snapshot',
       r->>'owner_name_snapshot',r->>'truck_type_snapshot')
   then raise exception 'Historical identity already exists with different source evidence';end if;
   skipped:=skipped+1;continue;
  end if;
  insert into public.transport_historical_trip_identity(trip_id,company_id,business_unit_id,operating_location_id,
   source_company,source_trip_id,source_file_hash,source_row,source_trip_date,driver_name_snapshot,vehicle_no_snapshot,
   owner_name_snapshot,truck_type_snapshot)
  values(tid,c,b,loc,r->>'source_company',r->>'source_trip_id',r->>'source_file_hash',(r->>'source_row')::integer,
   (r->>'source_trip_date')::date,r->>'driver_name_snapshot',r->>'vehicle_no_snapshot',r->>'owner_name_snapshot',r->>'truck_type_snapshot');
  added:=added+1;
 end loop;
 return jsonb_build_object('attached',added,'skipped',skipped);
end $$;
revoke all on function public.transport_attach_historical_trip_identity(jsonb) from public,anon;
grant execute on function public.transport_attach_historical_trip_identity(jsonb) to authenticated;

-- Preserve each installed view's column order, grants and security options.
-- Fail closed if an unexpected view definition no longer uses the known aliases.
do $$
declare name text;definition text;
begin
 for name in select unnest(array['transport_financial_register','transport_trip_register']) loop
  definition:=pg_get_viewdef(('public.'||name)::regclass,true);
  if position('v.vehicle_no,' in definition)=0 or position('d.driver_name,' in definition)=0
   or position('transport_historical_trip_identity' in definition)>0 then
   raise exception 'Unexpected % definition; review before migration',name;
  end if;
  definition:=replace(definition,'v.vehicle_no,','coalesce(v.vehicle_no, hi.vehicle_no_snapshot) AS vehicle_no,');
  definition:=replace(definition,'d.driver_name,','coalesce(d.driver_name, hi.driver_name_snapshot) AS driver_name,');
  definition:=rtrim(rtrim(definition),';')||' LEFT JOIN public.transport_historical_trip_identity hi ON hi.trip_id=t.id AND hi.company_id=t.company_id AND hi.business_unit_id=t.business_unit_id AND hi.operating_location_id=t.operating_location_id';
  execute format('create or replace view public.%I as %s',name,definition);
 end loop;
end $$;
