-- Keep vehicle/driver replacement history while protecting supplier accounting identity.
create or replace function public.transport_financial_append_only()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if tg_table_name='transport_trip_supplier_rents' and tg_op='UPDATE' then
    -- Controlled finalize / re-finalize is allowed only before a canonical supplier document exists.
    if exists (
      select 1 from public.transport_action_gate g
      where g.transaction_id=txid_current() and g.trip_id=old.trip_id and g.action='supplier_rent_finalize'
    )
    and new.id=old.id
    and new.company_id is not distinct from old.company_id
    and new.business_unit_id is not distinct from old.business_unit_id
    and new.trip_id is not distinct from old.trip_id
    and new.supplier_id is not distinct from old.supplier_id
    and old.state in ('pending','finalized') and new.state='finalized'
    and not exists (
      select 1 from public.transport_supplier_document_rents l
      where l.rent_id=old.id and not l.is_adjustment
    ) then
      return new;
    end if;

    -- Assignment replacement may move an UNPOSTED rent to the new owner/supplier.
    if exists (
      select 1 from public.transport_action_gate g
      where g.transaction_id=txid_current() and g.trip_id=old.trip_id and g.action='assignment_replace'
    )
    and new.id=old.id
    and new.company_id is not distinct from old.company_id
    and new.business_unit_id is not distinct from old.business_unit_id
    and new.trip_id is not distinct from old.trip_id
    and new.amount is not distinct from old.amount
    and new.state is not distinct from old.state
    and new.finalized_amount_snapshot is not distinct from old.finalized_amount_snapshot
    and not exists (
      select 1 from public.transport_supplier_document_rents l
      where l.rent_id=old.id and not l.is_adjustment
    ) then
      return new;
    end if;
  end if;
  raise exception 'Transport financial evidence is immutable';
end
$function$;

create or replace function public.transport_assignment_supplier_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_supplier_name text;
begin
  if new.owner_supplier_id is not distinct from old.owner_supplier_id then
    return new;
  end if;

  if not exists (
    select 1 from public.transport_action_gate g
    where g.transaction_id=txid_current() and g.trip_id=old.id and g.action='assignment_replace'
  ) then
    raise exception 'Supplier change requires controlled vehicle/driver replacement';
  end if;

  -- Once a supplier rent has reached canonical AP, supplier identity is accounting evidence.
  if exists (
    select 1
    from public.transport_trip_supplier_rents r
    join public.transport_supplier_document_rents l on l.rent_id=r.id and not l.is_adjustment
    where r.trip_id=old.id
  ) then
    raise exception 'Supplier cannot be changed because this Trip has posted supplier financial documents. Use financial correction/reallocation.';
  end if;

  if new.owner_supplier_id is not null then
    select s.name into v_supplier_name
    from public.suppliers s
    where s.id=new.owner_supplier_id and s.company_id=new.company_id;
    if v_supplier_name is null then
      raise exception 'New owner supplier is missing or outside the Trip company';
    end if;
  end if;

  -- Before posting, keep the existing rent amount/state but move its supplier identity atomically.
  update public.transport_trip_supplier_rents r
  set supplier_id=new.owner_supplier_id,
      supplier_name_snapshot=coalesce(v_supplier_name,new.owner_name_snapshot)
  where r.trip_id=old.id
    and r.company_id=old.company_id
    and r.business_unit_id=old.business_unit_id;

  return new;
end
$function$;

drop trigger if exists transport_assignment_supplier_guard on public.transport_trips;
create trigger transport_assignment_supplier_guard
before update of owner_supplier_id on public.transport_trips
for each row execute function public.transport_assignment_supplier_guard();

comment on function public.transport_assignment_supplier_guard() is
'Allows supplier reassignment only through controlled assignment replacement before supplier AP posting; synchronizes unposted rent supplier identity and blocks posted/paid supplier reassignment.';
