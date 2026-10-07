-- Prevent duplicate supplier-rent evidence for the same Trip + Supplier while preserving multi-supplier Trips.
-- Existing duplicate rows are reconciled only when they have never been posted, charged, or adjusted.
-- The latest duplicate is retained; immutable audit evidence is written before controlled maintenance cleanup.

do $$
declare
  v record;
begin
  if exists (
    with ranked as (
      select r.*,
             row_number() over (
               partition by r.company_id,r.business_unit_id,r.trip_id,r.supplier_id
               order by r.created_at desc,r.id desc
             ) as rn
      from public.transport_trip_supplier_rents r
    )
    select 1
    from ranked r
    where r.rn>1
      and (
        exists(select 1 from public.transport_supplier_document_rents l where l.rent_id=r.id)
        or exists(select 1 from public.transport_trip_supplier_charges c where c.rent_id=r.id)
        or exists(select 1 from public.transport_rate_adjustments a where a.rent_id=r.id)
      )
  ) then
    raise exception 'Duplicate supplier-rent cleanup blocked because linked financial evidence exists';
  end if;

  for v in
    with ranked as (
      select r.*,
             first_value(r.id) over (
               partition by r.company_id,r.business_unit_id,r.trip_id,r.supplier_id
               order by r.created_at desc,r.id desc
             ) as keeper_id,
             row_number() over (
               partition by r.company_id,r.business_unit_id,r.trip_id,r.supplier_id
               order by r.created_at desc,r.id desc
             ) as rn
      from public.transport_trip_supplier_rents r
    )
    select *
    from ranked
    where rn>1
    order by trip_id,supplier_id,created_at,id
  loop
    insert into public.transport_trip_audit(
      company_id,business_unit_id,trip_id,event_type,new_data
    )
    values(
      v.company_id,v.business_unit_id,v.trip_id,'supplier_rent_duplicate_reconciled',
      jsonb_build_object(
        'removed_rent_id',v.id,
        'canonical_rent_id',v.keeper_id,
        'supplier_id',v.supplier_id,
        'amount',v.amount,
        'state',v.state,
        'reason','Duplicate unposted supplier rent removed by forward-only idempotency repair'
      )
    );
  end loop;

  perform set_config('app.maintenance_reset','1',true);

  with ranked as (
    select r.id,
           row_number() over (
             partition by r.company_id,r.business_unit_id,r.trip_id,r.supplier_id
             order by r.created_at desc,r.id desc
           ) as rn
    from public.transport_trip_supplier_rents r
  )
  delete from public.transport_trip_supplier_rents r
  using ranked x
  where r.id=x.id
    and x.rn>1;

  perform set_config('app.maintenance_reset','0',true);
end
$$;

create unique index if not exists transport_trip_supplier_rents_trip_supplier_uidx
  on public.transport_trip_supplier_rents(company_id,business_unit_id,trip_id,supplier_id);

create or replace function public.transport_add_supplier_rent(
  p_trip_id uuid,
  p_supplier_id uuid,
  p_amount numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  t public.transport_trips%rowtype;
  r uuid;
  v_legacy_rent numeric;
begin
  t:=public.transport_financial_trip(p_trip_id);

  if not public.transport_finance_allowed('rent') then
    raise exception 'Transport rent permission required';
  end if;
  if not public.has_transport_action_permission(t.company_id,'rent_finalize') then
    raise exception 'Rent finalization permission required';
  end if;

  if not exists(
    select 1
    from public.suppliers
    where id=p_supplier_id
      and company_id=t.company_id
      and is_active
  ) then
    raise exception 'Active same-company supplier required';
  end if;

  -- Serialize retries for the same Trip + Supplier and reuse the canonical
  -- unposted rent instead of creating duplicate evidence.
  perform pg_advisory_xact_lock(hashtext(t.id::text),hashtext(p_supplier_id::text));

  select x.id
    into r
  from public.transport_trip_supplier_rents x
  where x.company_id=t.company_id
    and x.business_unit_id=t.business_unit_id
    and x.trip_id=t.id
    and x.supplier_id=p_supplier_id
  order by x.created_at desc,x.id desc
  limit 1;

  if r is not null then
    return r;
  end if;

  if coalesce(t.owner_rent,0)<>0 then
    if t.rent_state='finalized' then
      raise exception 'Finalized legacy owner rent requires controlled correction before structured supplier rents';
    end if;
    if exists(
      select 1
      from public.transport_trip_supplier_rents
      where trip_id=t.id
    ) then
      raise exception 'Legacy owner rent cannot coexist with structured supplier rents';
    end if;

    v_legacy_rent:=t.owner_rent;

    insert into public.transport_action_gate(transaction_id,trip_id,action)
    values(txid_current(),t.id,'rent_correct')
    on conflict do nothing;

    update public.transport_trips
       set owner_rent=0
     where id=t.id;

    delete from public.transport_action_gate
     where transaction_id=txid_current()
       and trip_id=t.id
       and action='rent_correct';

    perform public.transport_financial_audit(
      t.id,
      'legacy_owner_rent_retired',
      jsonb_build_object(
        'legacy_owner_rent',v_legacy_rent,
        'reason','Structured supplier rent became canonical'
      )
    );
  end if;

  insert into public.transport_trip_supplier_rents(
    company_id,business_unit_id,operating_location_id,trip_id,supplier_id,amount,reason,created_by
  )
  values(
    t.company_id,t.business_unit_id,public.current_operating_location_id(),t.id,p_supplier_id,
    round(p_amount,2),btrim(p_reason),auth.uid()
  )
  returning id into r;

  perform public.transport_financial_audit(
    t.id,
    'supplier_rent_added',
    jsonb_build_object(
      'rent_id',r,
      'supplier_id',p_supplier_id,
      'amount',p_amount,
      'reason',p_reason
    )
  );

  return r;
end
$function$;
