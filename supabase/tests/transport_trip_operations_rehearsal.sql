begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_company uuid := gen_random_uuid();
  v_bu uuid := gen_random_uuid();
  v_trip uuid;
  v_trip_no text;
  v_loc1 uuid;
  v_loc2 uuid;
  v_loc3 uuid;
  v_receiver uuid;
  v_employee uuid;
  v_ppr_employee uuid;
  v_received_date date;
  v_status text;
  v_count integer;
begin

  ---------------------------------------------------------------------------
  -- AUTH USER
  ---------------------------------------------------------------------------
  insert into auth.users(
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values(
    v_user,
    'authenticated',
    'authenticated',
    'transport-v1-rehearsal@navilo.local',
    '',
    now(),
    '{}'::jsonb,
    '{"name":"Transport V1 Rehearsal User"}'::jsonb,
    now(),
    now()
  );

  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);

  ---------------------------------------------------------------------------
  -- COMPANY
  ---------------------------------------------------------------------------
  insert into public.companies(
    id,
    name,
    code,
    status,
    created_by
  )
  values(
    v_company,
    'Transport V1 Rehearsal Company',
    'TRV1TEST',
    'active',
    v_user
  );

  ---------------------------------------------------------------------------
  -- DEDICATED TRANSPORT BUSINESS UNIT
  --
  -- Company creation may already create its normal default BU.
  -- Transport foundation intentionally requires unit_type='transport'.
  ---------------------------------------------------------------------------
  insert into public.business_units(
    id,
    company_id,
    code,
    name,
    unit_type,
    is_active,
    is_default
  )
  values(
    v_bu,
    v_company,
    'TRANSPORT',
    'Transport',
    'transport',
    true,
    false
  );

  ---------------------------------------------------------------------------
  -- USER PROFILE / ACTIVE CONTEXT
  ---------------------------------------------------------------------------
  insert into public.user_profiles(
    id,
    user_id,
    platform_role,
    is_active,
    last_company_id,
    last_business_unit_id
  )
  values(
    v_user,
    v_user,
    'super_admin',
    true,
    v_company,
    v_bu
  )
  on conflict (id) do update
     set user_id=excluded.user_id,
         platform_role=excluded.platform_role,
         is_active=true,
         last_company_id=excluded.last_company_id,
         last_business_unit_id=excluded.last_business_unit_id;

  insert into public.employees(user_id,company_id,name)
  values(v_user,v_company,'Transport V1 PPR Employee')
  returning id into v_employee;

  ---------------------------------------------------------------------------
  -- VERIFY NAVILO CONTEXT
  ---------------------------------------------------------------------------
  if public.current_company_id() is distinct from v_company then
    raise exception
      'FAIL: current_company_id expected %, got %',
      v_company,
      public.current_company_id();
  end if;

  if public.current_business_unit_id() is distinct from v_bu then
    raise exception
      'FAIL: current_business_unit_id expected Transport BU %, got %',
      v_bu,
      public.current_business_unit_id();
  end if;

  if not exists(
    select 1
    from public.business_units
    where id=v_bu
      and company_id=v_company
      and unit_type='transport'
      and is_active=true
  ) then
    raise exception 'FAIL: active Transport Business Unit missing';
  end if;

  ---------------------------------------------------------------------------
  -- CREATE DRAFT TRIP / AUTO TRIP NUMBER
  ---------------------------------------------------------------------------
  insert into public.transport_trips(
    company_id,
    business_unit_id,
    trip_date,
    from_location,
    to_location,
    trip_status,
    ppr_status,
    notes
  )
  values(
    v_company,
    v_bu,
    current_date,
    'Dammam',
    'Jeddah',
    'draft',
    'pending',
    'Transport V1 rehearsal'
  )
  returning id,trip_no
  into v_trip,v_trip_no;

  if v_trip_no is null
     or btrim(v_trip_no)=''
     or v_trip_no <> 'OIC-000001' then
    raise exception 'FAIL: automatic Trip No generation: %',v_trip_no;
  end if;

  if (
    select count(*)
    from public.transport_trips
    where company_id=v_company
      and trip_no=v_trip_no
  ) <> 1 then
    raise exception 'FAIL: company-wide Trip No uniqueness';
  end if;

  ---------------------------------------------------------------------------
  -- TRIP CREATION AUDIT
  ---------------------------------------------------------------------------
  if not exists(
    select 1
    from public.transport_trip_audit
    where trip_id=v_trip
      and event_type='insert'
  ) then
    raise exception 'FAIL: Trip creation audit missing';
  end if;

  ---------------------------------------------------------------------------
  -- ORDERED ROUTE
  ---------------------------------------------------------------------------
  insert into public.transport_trip_locations(
    company_id,
    business_unit_id,
    trip_id,
    location_name_snapshot,
    sequence_no
  )
  values(
    v_company,
    v_bu,
    v_trip,
    'Dammam',
    1
  )
  returning id into v_loc1;

  insert into public.transport_trip_locations(
    company_id,
    business_unit_id,
    trip_id,
    location_name_snapshot,
    sequence_no,
    event_name,
    waiting_count
  )
  values(
    v_company,
    v_bu,
    v_trip,
    'Riyadh',
    2,
    'Waiting',
    2
  )
  returning id into v_loc2;

  insert into public.transport_trip_locations(
    company_id,
    business_unit_id,
    trip_id,
    location_name_snapshot,
    sequence_no,
    event_name,
    is_cancelled
  )
  values(
    v_company,
    v_bu,
    v_trip,
    'Jeddah',
    3,
    'Custom Event',
    false
  )
  returning id into v_loc3;

  select count(*)
  into v_count
  from public.transport_trip_locations
  where trip_id=v_trip;

  if v_count <> 3 then
    raise exception 'FAIL: expected 3 route locations, got %',v_count;
  end if;

  ---------------------------------------------------------------------------
  -- WAITING EVENT
  ---------------------------------------------------------------------------
  if not exists(
    select 1
    from public.transport_trip_locations
    where id=v_loc2
      and sequence_no=2
      and location_name_snapshot='Riyadh'
      and event_name='Waiting'
      and waiting_count=2
  ) then
    raise exception 'FAIL: Waiting event / waiting count';
  end if;

  ---------------------------------------------------------------------------
  -- CUSTOM EVENT -> CANCELLED
  ---------------------------------------------------------------------------
  update public.transport_trip_locations
     set event_name='Cancelled',
         waiting_count=null,
         is_cancelled=true
   where id=v_loc3;

  if not exists(
    select 1
    from public.transport_trip_locations
    where id=v_loc3
      and event_name='Cancelled'
      and is_cancelled=true
  ) then
    raise exception 'FAIL: location cancellation';
  end if;

  ---------------------------------------------------------------------------
  -- REORDER ROUTE
  ---------------------------------------------------------------------------
  update public.transport_trip_locations
     set sequence_no=99
   where id=v_loc2;

  update public.transport_trip_locations
     set sequence_no=2
   where id=v_loc3;

  update public.transport_trip_locations
     set sequence_no=3
   where id=v_loc2;

  if not exists(
    select 1
    from public.transport_trip_locations
    where id=v_loc3 and sequence_no=2
  ) then
    raise exception 'FAIL: route reorder location 2';
  end if;

  if not exists(
    select 1
    from public.transport_trip_locations
    where id=v_loc2 and sequence_no=3
  ) then
    raise exception 'FAIL: route reorder location 3';
  end if;

  ---------------------------------------------------------------------------
  -- LOCATION AUDIT
  ---------------------------------------------------------------------------
  select count(*)
  into v_count
  from public.transport_trip_audit
  where trip_id=v_trip
    and event_type='location_insert';

  if v_count <> 3 then
    raise exception
      'FAIL: expected 3 location_insert audit rows, got %',
      v_count;
  end if;

  if not exists(
    select 1
    from public.transport_trip_audit
    where trip_id=v_trip
      and event_type='location_update'
      and old_data->>'event_name'='Custom Event'
      and new_data->>'event_name'='Cancelled'
  ) then
    raise exception 'FAIL: location old -> new audit';
  end if;

  ---------------------------------------------------------------------------
  -- PPR RECEIVED
  ---------------------------------------------------------------------------
  update public.transport_trips
     set ppr_status='received',
         ppr_received_by_employee_id=v_employee,
         ppr_received_date=current_date
   where id=v_trip;

  select
    ppr_received_by,
    ppr_received_by_employee_id,
    ppr_received_date
  into
    v_receiver,
    v_ppr_employee,
    v_received_date
  from public.transport_trips
  where id=v_trip;

  if v_receiver is distinct from v_user then
    raise exception
      'FAIL: PPR Received By expected %, got %',
      v_user,
      v_receiver;
  end if;

  if v_ppr_employee is distinct from v_employee then
    raise exception
      'FAIL: PPR employee expected %, got %',
      v_employee,
      v_ppr_employee;
  end if;

  if v_received_date is distinct from current_date then
    raise exception
      'FAIL: PPR date expected %, got %',
      current_date,
      v_received_date;
  end if;

  ---------------------------------------------------------------------------
  -- AUTHORIZED PPR DATE EDIT
  ---------------------------------------------------------------------------
  update public.transport_trips
     set ppr_received_date=current_date-1
   where id=v_trip;

  if (
    select ppr_received_date
    from public.transport_trips
    where id=v_trip
  ) is distinct from current_date-1 then
    raise exception 'FAIL: PPR date edit';
  end if;

  ---------------------------------------------------------------------------
  -- RECEIVED -> PENDING REVERSAL
  ---------------------------------------------------------------------------
  update public.transport_trips
     set ppr_status='pending',
         ppr_received_by_employee_id=null,
         ppr_received_by_name=null
   where id=v_trip;

  if exists(
    select 1
    from public.transport_trips
    where id=v_trip
      and (
        ppr_received_by is not null
        or ppr_received_by_employee_id is not null
        or ppr_received_by_name is not null
        or ppr_received_date is not null
        or ppr_attachment_path is not null
      )
  ) then
    raise exception 'FAIL: PPR reversal did not clear receipt fields';
  end if;

  if not exists(
    select 1
    from public.transport_trip_audit
    where trip_id=v_trip
      and old_data->>'ppr_status'='pending'
      and new_data->>'ppr_status'='received'
  ) then
    raise exception 'FAIL: PPR Received audit';
  end if;

  if not exists(
    select 1
    from public.transport_trip_audit
    where trip_id=v_trip
      and old_data->>'ppr_status'='received'
      and new_data->>'ppr_status'='pending'
  ) then
    raise exception 'FAIL: PPR reversal audit';
  end if;

  ---------------------------------------------------------------------------
  -- DRAFT + RATES MUST REMAIN DRAFT
  ---------------------------------------------------------------------------
  update public.transport_trips
     set customer_rate=1000,
         supplier_rent=700
   where id=v_trip;

  select trip_status
  into v_status
  from public.transport_trips
  where id=v_trip;

  if v_status <> 'draft' then
    raise exception
      'FAIL: Draft lifecycle overwritten: %',
      v_status;
  end if;

  ---------------------------------------------------------------------------
  -- OPERATIONAL + BOTH RATES => COMPLETE
  ---------------------------------------------------------------------------
  update public.transport_trips
     set trip_status='running'
   where id=v_trip;

  select trip_status
  into v_status
  from public.transport_trips
  where id=v_trip;

  if v_status <> 'completed' then
    raise exception
      'FAIL: both rates should produce Complete, got %',
      v_status;
  end if;

  ---------------------------------------------------------------------------
  -- MISSING SUPPLIER RENT => NOT COMPLETE
  ---------------------------------------------------------------------------
  update public.transport_trips
     set supplier_rent=null
   where id=v_trip;

  select trip_status
  into v_status
  from public.transport_trips
  where id=v_trip;

  if v_status <> 'running' then
    raise exception
      'FAIL: missing Supplier Rent should be Not Complete/running, got %',
      v_status;
  end if;

  ---------------------------------------------------------------------------
  -- SUPPLIER RENT RESTORED => COMPLETE
  -- customer_rate is NOT NULL in the reconciled main operational schema.
  -- Pending/finalized customer-rate evidence is covered by the Batch-1 and
  -- canonical financial rehearsals; this legacy test must not write NULL.
  ---------------------------------------------------------------------------
  update public.transport_trips
     set supplier_rent=700
   where id=v_trip;

  select trip_status
  into v_status
  from public.transport_trips
  where id=v_trip;

  if v_status <> 'completed' then
    raise exception
      'FAIL: restored Supplier Rent should produce Complete, got %',
      v_status;
  end if;

  ---------------------------------------------------------------------------
  -- RATE AUDIT
  ---------------------------------------------------------------------------
  if not exists(
    select 1
    from public.transport_trip_audit
    where trip_id=v_trip
      and (
        old_data->>'customer_rate'
          is distinct from
        new_data->>'customer_rate'
        or
        old_data->>'supplier_rent'
          is distinct from
        new_data->>'supplier_rent'
      )
  ) then
    raise exception 'FAIL: rate audit missing';
  end if;

  ---------------------------------------------------------------------------
  -- SINGLE TRIP COMMENTS AUDIT
  ---------------------------------------------------------------------------
  update public.transport_trips
     set notes='Updated single Trip-level Comments'
   where id=v_trip;

  if not exists(
    select 1
    from public.transport_trip_audit
    where trip_id=v_trip
      and old_data->>'notes'
          is distinct from
          new_data->>'notes'
      and new_data->>'notes'='Updated single Trip-level Comments'
  ) then
    raise exception 'FAIL: Trip Comments audit missing';
  end if;

  ---------------------------------------------------------------------------
  -- AUDIT ACTOR
  ---------------------------------------------------------------------------
  if exists(
    select 1
    from public.transport_trip_audit
    where trip_id=v_trip
      and changed_by is distinct from v_user
  ) then
    raise exception 'FAIL: audit actor mismatch';
  end if;

  ---------------------------------------------------------------------------
  -- TENANT / TRANSPORT BU SCOPE
  ---------------------------------------------------------------------------
  if exists(
    select 1
    from public.transport_trip_locations
    where trip_id=v_trip
      and (
        company_id is distinct from v_company
        or business_unit_id is distinct from v_bu
      )
  ) then
    raise exception 'FAIL: route tenant/BU mismatch';
  end if;

  ---------------------------------------------------------------------------
  -- COMPLETE HISTORY EXISTS
  ---------------------------------------------------------------------------
  select count(*)
  into v_count
  from public.transport_trip_audit
  where trip_id=v_trip;

  if v_count < 10 then
    raise exception
      'FAIL: complete Trip history too small: % rows',
      v_count;
  end if;

  raise notice
    'PASS: Transport V1 operations - Transport BU context, Trip No, route/events/reorder, audit, PPR User ID/date/reversal, Draft preservation, Complete/Not Complete classification and tenant scope';
end
$$;

rollback;
