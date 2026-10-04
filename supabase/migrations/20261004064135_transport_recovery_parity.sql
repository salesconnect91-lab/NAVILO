begin;
-- Approved parity target; preserve all existing migration IDs and historical rows.

create table if not exists public.transport_driver_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  trip_id uuid references public.transport_trips(id) on delete restrict,
  driver_id uuid not null references public.transport_drivers(id) on delete restrict,
  expense_date date not null default current_date,
  expense_type text not null,
  amount numeric(18,2) not null check(amount>=0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);



create table if not exists public.transport_trip_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  trip_id uuid not null references public.transport_trips(id) on delete restrict,
  location_id uuid references public.transport_locations(id) on delete restrict,
  location_name_snapshot text not null,
  sequence_no integer not null check (sequence_no > 0),
  event_name text,
  waiting_count integer check (waiting_count is null or waiting_count >= 0),
  is_cancelled boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(trip_id,sequence_no)
);

create index if not exists transport_trip_locations_trip_idx
  on public.transport_trip_locations(company_id,business_unit_id,trip_id,sequence_no);

alter table public.transport_trip_locations enable row level security;

drop policy if exists transport_trip_locations_read
  on public.transport_trip_locations;
create policy transport_trip_locations_read
  on public.transport_trip_locations
  for select to authenticated
  using (
    company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
    and public.has_module_permission(company_id,'transport','view')
  );

drop policy if exists transport_trip_locations_insert
  on public.transport_trip_locations;
create policy transport_trip_locations_insert
  on public.transport_trip_locations
  for insert to authenticated
  with check (
    company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
    and public.has_module_permission(company_id,'transport','create')
  );

drop policy if exists transport_trip_locations_update
  on public.transport_trip_locations;
create policy transport_trip_locations_update
  on public.transport_trip_locations
  for update to authenticated
  using (
    company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
    and public.has_module_permission(company_id,'transport','edit')
  )
  with check (
    company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
  );

grant select,insert,update on public.transport_trip_locations to authenticated;

-- Scope/stamp route changes and guarantee they belong to the same Trip scope.
create or replace function public.transport_trip_location_stamp()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_trip public.transport_trips%rowtype;
begin
  select *
    into v_trip
    from public.transport_trips
   where id=new.trip_id;

  if not found then
    raise exception 'Transport Trip not found.';
  end if;

  new.company_id:=v_trip.company_id;
  new.business_unit_id:=v_trip.business_unit_id;

  if new.company_id is distinct from public.current_company_id()
     or new.business_unit_id is distinct from public.current_business_unit_id() then
    raise exception 'Trip location must belong to the active company and business unit.';
  end if;

  if tg_op='INSERT' then
    new.created_by:=coalesce(new.created_by,auth.uid());
  end if;

  new.updated_by:=auth.uid();
  new.updated_at:=now();

  return new;
end
$$;

revoke all on function public.transport_trip_location_stamp()
  from public,anon,authenticated;

drop trigger if exists trg_transport_trip_locations_scope
  on public.transport_trip_locations;
create trigger trg_transport_trip_locations_scope
before insert or update on public.transport_trip_locations
for each row execute function public.transport_trip_location_stamp();

-- Route changes become part of the same immutable Trip audit stream.
create or replace function public.transport_trip_location_audit_capture()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  insert into public.transport_trip_audit(
    company_id,business_unit_id,trip_id,event_type,
    old_data,new_data,changed_by
  )
  values(
    coalesce(new.company_id,old.company_id),
    coalesce(new.business_unit_id,old.business_unit_id),
    coalesce(new.trip_id,old.trip_id),
    'location_'||lower(tg_op),
    case when tg_op='INSERT' then null else to_jsonb(old) end,
    case when tg_op='DELETE' then null else to_jsonb(new) end,
    auth.uid()
  );

  return coalesce(new,old);
end
$$;

revoke all on function public.transport_trip_location_audit_capture()
  from public,anon,authenticated;

drop trigger if exists trg_transport_trip_location_audit
  on public.transport_trip_locations;
create trigger trg_transport_trip_location_audit
after insert or update or delete on public.transport_trip_locations
for each row execute function public.transport_trip_location_audit_capture();



CREATE OR REPLACE FUNCTION public.transport_trip_audit_capture()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if tg_op='UPDATE' and new is not distinct from old then return new;end if;
  insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,event_type,old_data,new_data,changed_by)
  values(coalesce(new.company_id,old.company_id),coalesce(new.business_unit_id,old.business_unit_id),
         coalesce(new.id,old.id),lower(tg_op),case when tg_op='INSERT' then null else to_jsonb(old) end,
         case when tg_op='DELETE' then null else to_jsonb(new) end,auth.uid());
  return coalesce(new,old);
end$function$
;

revoke all on function public.transport_trip_audit_capture() from public,anon,authenticated;
drop trigger if exists trg_transport_trip_audit on public.transport_trips;
create trigger trg_transport_trip_audit after insert or update or delete on public.transport_trips for each row execute function public.transport_trip_audit_capture();
-- Lifecycle is explicit. Presence of rates is not operational completion.
drop trigger if exists trg_transport_trip_auto_classify on public.transport_trips;


CREATE OR REPLACE FUNCTION public.transport_trip_ppr_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.ppr_status='received' then
    if old.ppr_status is distinct from 'received'
       or new.ppr_received_by is null then
      new.ppr_received_by:=auth.uid();
    end if;

    if new.ppr_received_date is null then
      new.ppr_received_date:=current_date;
    end if;
  elsif new.ppr_status='pending' then
    new.ppr_received_by:=null;
    new.ppr_received_date:=null;
    new.ppr_attachment_path:=null;
  end if;

  return new;
end
$function$
;

revoke all on function public.transport_trip_ppr_guard() from public,anon,authenticated;
drop trigger if exists trg_transport_trip_ppr_guard on public.transport_trips;
create trigger trg_transport_trip_ppr_guard before insert or update of ppr_status,ppr_received_by,ppr_received_date,ppr_attachment_path on public.transport_trips for each row execute function public.transport_trip_ppr_guard();


CREATE OR REPLACE FUNCTION public.sync_transport_vehicle_ownership_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.ownership_type = 'supplier' or new.owner_type = 'supplier' then
      new.ownership_type := 'supplier';
      new.owner_type := 'supplier';
    elsif new.owner_type is null then
      new.owner_type := 'company';
    end if;
  else
    if new.ownership_type is distinct from old.ownership_type then
      new.owner_type := new.ownership_type;
    elsif new.owner_type is distinct from old.owner_type then
      new.ownership_type := case when new.owner_type = 'supplier' then 'supplier' else 'company' end;
    end if;
  end if;
  return new;
end;
$function$
;

revoke all on function public.sync_transport_vehicle_ownership_columns() from public,anon,authenticated;
drop trigger if exists sync_transport_vehicle_ownership_columns_trg on public.transport_vehicles;
create trigger sync_transport_vehicle_ownership_columns_trg before insert or update of ownership_type,owner_type on public.transport_vehicles for each row execute function public.sync_transport_vehicle_ownership_columns();




-- A physical plate is one Vehicle Master inside a Company + Business Unit.
-- Legacy duplicate rows are intentionally NOT merged here because they may already
-- be referenced by Trips / assignments / ownership history.
create or replace function public.transport_vehicle_plate_identity_guard()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  normalized_plate text;
begin
  normalized_plate:=public.transport_master_normalized_key(new.vehicle_no);
  if normalized_plate is null or normalized_plate='' then
    raise exception 'Vehicle number / plate is required';
  end if;

  if tg_op='INSERT'
     or public.transport_master_normalized_key(new.vehicle_no)
        is distinct from public.transport_master_normalized_key(old.vehicle_no) then
    perform pg_advisory_xact_lock(
      hashtextextended(
        'transport-vehicle-plate:'||new.company_id::text||':'||new.business_unit_id::text||':'||normalized_plate,
        0
      )
    );

    if exists(
      select 1
      from public.transport_vehicles v
      where v.company_id=new.company_id
        and v.business_unit_id=new.business_unit_id
        and v.id<>new.id
        and public.transport_master_normalized_key(v.vehicle_no)=normalized_plate
    ) then
      raise exception 'Vehicle % already exists in this company/business unit. Change ownership through Vehicle Ownership History instead of creating another Vehicle.',btrim(new.vehicle_no);
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.transport_vehicle_plate_identity_guard() from public,anon,authenticated;

drop trigger if exists zzzz_transport_vehicle_plate_identity_guard on public.transport_vehicles;
create trigger zzzz_transport_vehicle_plate_identity_guard
before insert or update of vehicle_no on public.transport_vehicles
for each row execute function public.transport_vehicle_plate_identity_guard();

-- Fresh databases get a physical unique index too. A live database containing
-- historical duplicates is left untouched until those references are reconciled.
do $$
begin
  if not exists(
    select 1
    from public.transport_vehicles
    group by company_id,business_unit_id,public.transport_master_normalized_key(vehicle_no)
    having count(*)>1
  ) then
    create unique index if not exists transport_vehicles_plate_identity_uidx
      on public.transport_vehicles(company_id,business_unit_id,(public.transport_master_normalized_key(vehicle_no)));
  end if;
end
$$;



CREATE OR REPLACE FUNCTION public.transport_v1_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
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
 if new.trip_no is null or btrim(new.trip_no)='' then new.trip_no:=public.next_transport_trip_no();end if;
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
end $function$
;

revoke all on function public.transport_v1_stamp() from public,anon,authenticated;
do $$ declare t text;begin
 foreach t in array array['transport_truck_types','transport_locations','transport_vehicles','transport_drivers','transport_trips','transport_driver_expenses'] loop
 execute format('drop trigger if exists %I on public.%I','trg_'||t||'_scope',t);
 execute format('create trigger %I before insert or update on public.%I for each row execute function public.transport_v1_stamp()','trg_'||t||'_scope',t);
 end loop;
end $$;
alter table public.transport_driver_expenses enable row level security;
drop policy if exists transport_driver_expenses_read on public.transport_driver_expenses;
create policy transport_driver_expenses_read on public.transport_driver_expenses for select to authenticated using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.transport_financial_read_allowed('supplier'));
drop policy if exists transport_driver_expenses_insert on public.transport_driver_expenses;
create policy transport_driver_expenses_insert on public.transport_driver_expenses for insert to authenticated with check(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_transport_action_permission(company_id,'trip_edit'));
revoke all on public.transport_driver_expenses from public,anon;
grant select,insert on public.transport_driver_expenses to authenticated;


create or replace view public.transport_trip_register with(security_invoker=true) as
select t.id,t.company_id,t.business_unit_id,t.trip_no,t.trip_date,t.trip_status,t.job_status,t.ppr_status,t.po_do_job_no,
       coalesce(c.name,t.customer_name_snapshot) customer_name,
       v.vehicle_no,d.driver_name,t.from_location,t.to_location,
       t.customer_rate,t.customer_rate_status,t.supplier_rent,t.supplier_rent_status,
       case when t.customer_rate is null or t.supplier_rent is null then null else t.customer_rate-t.supplier_rent end trip_margin,
       t.created_at,t.updated_at
from public.transport_trips t
left join public.customers c on c.id=t.customer_id
left join public.transport_vehicles v on v.id=t.vehicle_id
left join public.transport_drivers d on d.id=t.driver_id;
revoke all on public.transport_trip_register from public,anon;
grant select on public.transport_trip_register to authenticated;


alter table public.transport_customer_document_trips add column if not exists created_at timestamptz not null default now();
alter table public.transport_supplier_document_rents add column if not exists created_at timestamptz not null default now();
alter table public.transport_customer_documents add column if not exists paid_amount numeric(18,2) not null default 0;


CREATE OR REPLACE FUNCTION public.transport_financial_trip(p_trip_id uuid)
 RETURNS transport_trips
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.transport_trips%rowtype;
begin
 select * into t from public.transport_trips where id=p_trip_id and company_id=public.current_company_id()
 and business_unit_id=public.current_business_unit_id() for update;
 if not found or t.lifecycle_status='cancelled' or t.status='cancelled' then raise exception 'Active Transport Trip in current workspace required'; end if;
 return t;
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_correct_settlement(p_journal_entry_id uuid, p_new_amount numeric, p_date date, p_account_id uuid, p_method text, p_reason text, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id();
 v public.journal_entries%rowtype; v_side text; v_party uuid; v_old numeric; v_alloc jsonb; v_rev jsonb; v_new jsonb;
begin
 perform public.transport_finance_assert('settlement');
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Correction reason is required'; end if;
 if p_new_amount is null or p_new_amount<=0 then raise exception 'Corrected amount must be greater than zero'; end if;
 select * into v from public.journal_entries where id=p_journal_entry_id and company_id=c and business_unit_id=b and operating_location_id=loc and status='posted' for update;
 if not found or v.trans_type not in ('Customer Receipt','Supplier Payment') then raise exception 'Posted customer receipt or supplier payment not found in active workspace'; end if;
 if exists(select 1 from public.journal_entries where reversal_of_entry_id=v.id and status='posted') then raise exception 'This settlement has already been reversed'; end if;
 if p_date<v.entry_date then raise exception 'Correction date cannot be earlier than original payment/receipt date'; end if;
 if v.trans_type='Customer Receipt' then
   v_side:='customer';
   select customer_id,round(sum(amount),2),jsonb_agg(jsonb_build_object('document_id',sales_order_id,'amount',round(amount*p_new_amount/nullif((select sum(x.amount) from public.invoice_payment_allocations x where x.journal_entry_id=v.id),0),2)) order by sales_order_id)
   into v_party,v_old,v_alloc from public.invoice_payment_allocations where journal_entry_id=v.id group by customer_id;
   if v_party is null then raise exception 'Transport customer receipt allocations not found'; end if;
   if not exists(select 1 from public.invoice_payment_allocations a join public.transport_customer_documents d on d.sales_order_id=a.sales_order_id where a.journal_entry_id=v.id) then raise exception 'Receipt is not attributed to Transport'; end if;
 else
   v_side:='supplier';
   select supplier_id,round(sum(amount),2),jsonb_agg(jsonb_build_object('document_id',purchase_order_id,'amount',round(amount*p_new_amount/nullif((select sum(x.amount) from public.purchase_payment_allocations x where x.journal_entry_id=v.id),0),2)) order by purchase_order_id)
   into v_party,v_old,v_alloc from public.purchase_payment_allocations where journal_entry_id=v.id group by supplier_id;
   if v_party is null then raise exception 'Transport supplier payment allocations not found'; end if;
   if not exists(select 1 from public.purchase_payment_allocations a where a.journal_entry_id=v.id and (exists(select 1 from public.transport_supplier_documents d where d.purchase_order_id=a.purchase_order_id) or exists(select 1 from public.transport_service_cost_links l where l.purchase_order_id=a.purchase_order_id))) then raise exception 'Payment is not attributed to Transport'; end if;
 end if;
 if abs(p_new_amount-v_old)<0.005 then raise exception 'Corrected amount is unchanged'; end if;
 v_rev:=public.reverse_payment_voucher(v.id,p_date,btrim(p_reason));
 v_new:=public.transport_settle_documents(v_side,v_party,p_date,p_account_id,p_method,v_alloc,null,coalesce(nullif(btrim(p_reference),''),'Correction of '||v.entry_no));
 insert into public.audit_logs(user_id,module,action,table_name,record_id,record_name,performed_by,performed_email,old_data,new_data,metadata)
 values(public.legacy_data_user_id(),'transport','CORRECT_SETTLEMENT','journal_entries',v.id,v.entry_no,auth.uid()::text,auth.jwt()->>'email',
 jsonb_build_object('amount',v_old,'date',v.entry_date,'reference',v.description),
 jsonb_build_object('amount',p_new_amount,'date',p_date,'reference',p_reference),
 jsonb_build_object('side',v_side,'reason',btrim(p_reason),'reversal',v_rev,'replacement',v_new));
 return jsonb_build_object('success',true,'side',v_side,'old_amount',v_old,'new_amount',p_new_amount,'reversal',v_rev,'replacement',v_new);
end $function$
;

-- Existing live rows passed the null-scope preflight; refuse to infer missing history.
alter table public.transport_customer_documents alter column operating_location_id set not null, alter column created_by set not null;
alter table public.transport_supplier_documents alter column operating_location_id set not null, alter column created_by set not null;
alter table public.transport_vehicles alter column ownership_type set default 'company', alter column ownership_type set not null;
notify pgrst,'reload schema';
commit;