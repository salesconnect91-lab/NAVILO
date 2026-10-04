begin;

alter table public.transport_trips
  add column if not exists customer_base_rate numeric(18,2),
  add column if not exists customer_manual_adjustment numeric(18,2) not null default 0;

create table if not exists public.transport_charge_types (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  code text not null check (btrim(code)<>'' and length(btrim(code))<=12),
  name text not null check (btrim(name)<>'' and length(btrim(name))<=80), is_active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,business_unit_id,id)
);
create unique index if not exists transport_charge_types_code_uidx on public.transport_charge_types(company_id,business_unit_id,lower(btrim(code)));

create table if not exists public.transport_customer_charge_rates (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  charge_type_id uuid not null references public.transport_charge_types(id) on delete restrict,
  effective_from date not null, effective_to date, amount numeric(18,2),
  status text not null default 'agreed' check(status in ('agreed','pending')), is_active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(effective_to is null or effective_to>=effective_from),
  check((status='pending' and amount is null) or (status='agreed' and amount is not null and amount>=0)),
  foreign key(company_id,business_unit_id,charge_type_id) references public.transport_charge_types(company_id,business_unit_id,id),
  unique(company_id,business_unit_id,id)
);
create index if not exists transport_customer_charge_rates_lookup_idx on public.transport_customer_charge_rates(company_id,business_unit_id,customer_id,charge_type_id,effective_from desc);

create table if not exists public.transport_trip_customer_charges (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  trip_id uuid not null references public.transport_trips(id) on delete restrict,
  charge_type_id uuid not null references public.transport_charge_types(id) on delete restrict,
  code_snapshot text not null, name_snapshot text not null, amount numeric(18,2) not null check(amount>=0),
  source_rate_id uuid references public.transport_customer_charge_rates(id) on delete restrict,
  sort_order integer not null default 0, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(company_id,business_unit_id,trip_id) references public.transport_trips(company_id,business_unit_id,id),
  unique(company_id,business_unit_id,id)
);
create index if not exists transport_trip_customer_charges_trip_idx on public.transport_trip_customer_charges(company_id,business_unit_id,trip_id,sort_order,id);

alter table public.transport_charge_types enable row level security;
alter table public.transport_customer_charge_rates enable row level security;
alter table public.transport_trip_customer_charges enable row level security;
drop policy if exists transport_charge_types_select on public.transport_charge_types;
create policy transport_charge_types_select on public.transport_charge_types for select to authenticated
using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'transport','view'));
drop policy if exists transport_customer_charge_rates_select on public.transport_customer_charge_rates;
create policy transport_customer_charge_rates_select on public.transport_customer_charge_rates for select to authenticated
using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'transport','view'));
drop policy if exists transport_trip_customer_charges_select on public.transport_trip_customer_charges;
create policy transport_trip_customer_charges_select on public.transport_trip_customer_charges for select to authenticated
using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'transport','view'));
revoke all on public.transport_charge_types,public.transport_customer_charge_rates,public.transport_trip_customer_charges from public,anon;
grant select on public.transport_charge_types,public.transport_customer_charge_rates,public.transport_trip_customer_charges to authenticated,service_role;
grant all on public.transport_charge_types,public.transport_customer_charge_rates,public.transport_trip_customer_charges to service_role;

create or replace function public.transport_customer_side_posted(p_trip_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.transport_trips t where t.id=p_trip_id and (t.sales_order_id is not null or exists(select 1 from public.transport_customer_document_trips l where l.trip_id=t.id and not l.is_adjustment)))
$$;
revoke all on function public.transport_customer_side_posted(uuid) from public,anon;
grant execute on function public.transport_customer_side_posted(uuid) to authenticated,service_role;

create or replace function public.transport_customer_commercial_lock() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.transport_customer_side_posted(old.id) and
 (new.customer_id,new.truck_type_id,new.from_location_id,new.to_location_id,new.from_location,new.to_location,new.customer_base_rate,new.customer_manual_adjustment,new.customer_rate,new.customer_rate_snapshot)
 is distinct from
 (old.customer_id,old.truck_type_id,old.from_location_id,old.to_location_id,old.from_location,old.to_location,old.customer_base_rate,old.customer_manual_adjustment,old.customer_rate,old.customer_rate_snapshot)
 then raise exception 'Posted customer billing locks customer, route, truck type, base rate, charges and final customer rate. Use Credit/Debit Note for financial correction.'; end if;
 return new;
end$$;
drop trigger if exists transport_customer_commercial_lock on public.transport_trips;
create trigger transport_customer_commercial_lock before update on public.transport_trips for each row execute function public.transport_customer_commercial_lock();

create or replace function public.transport_save_charge_type(p_id uuid,p_code text,p_name text,p_active boolean default true)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();x uuid;
begin
 if auth.uid() is null or c is null or b is null or not public.has_transport_action_permission(c,'customer_rate_finalize') then raise exception 'Rate-card permission required'; end if;
 if nullif(btrim(p_code),'') is null or nullif(btrim(p_name),'') is null then raise exception 'Charge code and name required'; end if;
 if p_id is null then insert into public.transport_charge_types(company_id,business_unit_id,code,name,is_active,created_by) values(c,b,upper(btrim(p_code)),btrim(p_name),coalesce(p_active,true),auth.uid()) returning id into x;
 else update public.transport_charge_types set code=upper(btrim(p_code)),name=btrim(p_name),is_active=coalesce(p_active,true),updated_at=now() where id=p_id and company_id=c and business_unit_id=b returning id into x;
 if x is null then raise exception 'Charge type not found in active Transport workspace'; end if; end if; return x;
end$$;
revoke all on function public.transport_save_charge_type(uuid,text,text,boolean) from public,anon;
grant execute on function public.transport_save_charge_type(uuid,text,text,boolean) to authenticated,service_role;

create or replace function public.transport_save_customer_charge_rate(p_id uuid,p_customer_id uuid,p_charge_type_id uuid,p_effective_from date,p_effective_to date,p_amount numeric,p_status text,p_active boolean default true)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();x uuid;
begin
 if auth.uid() is null or c is null or b is null or not public.has_transport_action_permission(c,'customer_rate_finalize') then raise exception 'Rate-card permission required'; end if;
 if p_effective_from is null or (p_effective_to is not null and p_effective_to<p_effective_from) then raise exception 'Valid effective dates required'; end if;
 if p_status not in ('agreed','pending') or (p_status='agreed' and (p_amount is null or p_amount<0)) or (p_status='pending' and p_amount is not null) then raise exception 'Agreed charge requires a nonnegative amount; Pending charge must not have an amount'; end if;
 if not exists(select 1 from public.customers where id=p_customer_id and company_id=c) then raise exception 'Customer company mismatch'; end if;
 if not exists(select 1 from public.transport_charge_types where id=p_charge_type_id and company_id=c and business_unit_id=b) then raise exception 'Charge type outside active Transport workspace'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text||b::text||p_customer_id::text||p_charge_type_id::text,0));
 if exists(select 1 from public.transport_customer_charge_rates r where r.id is distinct from p_id and r.company_id=c and r.business_unit_id=b and r.customer_id=p_customer_id and r.charge_type_id=p_charge_type_id and r.is_active and coalesce(p_active,true)
 and daterange(r.effective_from,coalesce(r.effective_to+1,'infinity'::date),'[)') && daterange(p_effective_from,coalesce(p_effective_to+1,'infinity'::date),'[)')) then raise exception 'Customer charge-rate periods overlap'; end if;
 if p_id is null then insert into public.transport_customer_charge_rates(company_id,business_unit_id,customer_id,charge_type_id,effective_from,effective_to,amount,status,is_active,created_by)
 values(c,b,p_customer_id,p_charge_type_id,p_effective_from,p_effective_to,p_amount,p_status,coalesce(p_active,true),auth.uid()) returning id into x;
 else update public.transport_customer_charge_rates set customer_id=p_customer_id,charge_type_id=p_charge_type_id,effective_from=p_effective_from,effective_to=p_effective_to,amount=p_amount,status=p_status,is_active=coalesce(p_active,true),updated_at=now()
 where id=p_id and company_id=c and business_unit_id=b returning id into x; if x is null then raise exception 'Charge rate not found in active Transport workspace'; end if; end if; return x;
end$$;
revoke all on function public.transport_save_customer_charge_rate(uuid,uuid,uuid,date,date,numeric,text,boolean) from public,anon;
grant execute on function public.transport_save_customer_charge_rate(uuid,uuid,uuid,date,date,numeric,text,boolean) to authenticated,service_role;

create or replace function public.transport_replace_trip_customer_charges(p_trip_id uuid,p_lines jsonb,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;line jsonb;ct public.transport_charge_types%rowtype;cr public.transport_customer_charge_rates%rowtype;
 base numeric(18,2);total_charges numeric(18,2):=0;final_rate numeric(18,2);seq int:=0;amount numeric(18,2);src uuid;old_lines jsonb;new_lines jsonb;
begin
 select * into t from public.transport_trips where id=p_trip_id for update;
 if not found or t.company_id is distinct from public.current_company_id() or t.business_unit_id is distinct from public.current_business_unit_id() then raise exception 'Transport Trip not found in active workspace'; end if;
 if not public.has_transport_action_permission(t.company_id,case when t.customer_rate_state='finalized' then 'customer_rate_override' else 'customer_rate_finalize' end) then raise exception 'Customer rate permission required'; end if;
 if public.transport_customer_side_posted(t.id) then raise exception 'Customer invoice is posted. Customer-side Trip data and charges are locked; use Credit/Debit Note.'; end if;
 if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))>50 then raise exception 'Charges must be an array of at most 50 lines'; end if;
 if t.customer_rate_state='finalized' and nullif(btrim(p_reason),'') is null then raise exception 'Reason required when changing a finalized unposted customer rate'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('code',code_snapshot,'name',name_snapshot,'amount',amount) order by sort_order,id),'[]'::jsonb) into old_lines from public.transport_trip_customer_charges where trip_id=t.id;
 base:=t.customer_base_rate;
 if base is null then
  select r.amount into base from public.transport_customer_rates r where r.company_id=t.company_id and r.business_unit_id=t.business_unit_id and r.customer_id=t.customer_id and r.truck_type_id=t.truck_type_id and r.from_location_id=t.from_location_id and r.to_location_id=t.to_location_id and r.is_active and r.effective_from<=t.trip_date and (r.effective_to is null or r.effective_to>=t.trip_date) order by r.effective_from desc,r.id limit 1;
  base:=coalesce(base,t.customer_rate,0);
 end if;
 delete from public.transport_trip_customer_charges where trip_id=t.id;
 for line in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
  seq:=seq+1;src:=null;amount:=null;
  select * into ct from public.transport_charge_types where id=(line->>'charge_type_id')::uuid and company_id=t.company_id and business_unit_id=t.business_unit_id and is_active;
  if not found then raise exception 'Active charge type not found'; end if;
  if nullif(line->>'amount','') is not null then amount:=(line->>'amount')::numeric;if amount<0 then raise exception 'Charge amount cannot be negative';end if;
  else select * into cr from public.transport_customer_charge_rates r where r.company_id=t.company_id and r.business_unit_id=t.business_unit_id and r.customer_id=t.customer_id and r.charge_type_id=ct.id and r.is_active and r.effective_from<=t.trip_date and (r.effective_to is null or r.effective_to>=t.trip_date) order by r.effective_from desc,r.id limit 1;
   if not found or cr.status='pending' or cr.amount is null then raise exception '% charge is Pending / not agreed for this customer and Trip Date',ct.name;end if;amount:=cr.amount;src:=cr.id;
  end if;
  insert into public.transport_trip_customer_charges(company_id,business_unit_id,trip_id,charge_type_id,code_snapshot,name_snapshot,amount,source_rate_id,sort_order,created_by)
  values(t.company_id,t.business_unit_id,t.id,ct.id,ct.code,ct.name,amount,src,seq,auth.uid());total_charges:=total_charges+amount;
 end loop;
 final_rate:=round((base+total_charges+coalesce(t.customer_manual_adjustment,0))::numeric,2);
 insert into public.transport_action_gate values(txid_current(),t.id,'customer_rate_finalize') on conflict do nothing;
 update public.transport_trips set customer_base_rate=base,customer_rate=final_rate,customer_rate_snapshot=case when customer_rate_state='finalized' then final_rate else customer_rate_snapshot end,customer_rate_source=case when customer_rate_state='finalized' then 'manual' else customer_rate_source end,updated_at=now(),updated_by=auth.uid() where id=t.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='customer_rate_finalize';
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'charge_type_id',charge_type_id,'code',code_snapshot,'name',name_snapshot,'amount',amount,'source_rate_id',source_rate_id) order by sort_order,id),'[]'::jsonb) into new_lines from public.transport_trip_customer_charges where trip_id=t.id;
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,t.trip_no,'customer_charges_changed',jsonb_build_object('base_rate',coalesce(t.customer_base_rate,base),'charges',old_lines,'final_rate',t.customer_rate),jsonb_build_object('base_rate',base,'charges',new_lines,'final_rate',final_rate),p_reason,auth.uid());
 return jsonb_build_object('base_rate',base,'charges_total',total_charges,'manual_adjustment',coalesce(t.customer_manual_adjustment,0),'final_rate',final_rate,'lines',new_lines);
end$$;
revoke all on function public.transport_replace_trip_customer_charges(uuid,jsonb,text) from public,anon;
grant execute on function public.transport_replace_trip_customer_charges(uuid,jsonb,text) to authenticated,service_role;
commit;
