-- Synced from verified production migration 20261006210316 (allow_unposted_supplier_rate_without_operating_location).
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

  -- Adding/finalizing an unposted supplier rate is an operational Transport
  -- action, not an accounting posting. Operating Location is required later
  -- when the supplier bill/AP document is actually posted.
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
    company_id,business_unit_id,trip_id,supplier_id,amount,reason,created_by
  )
  values(
    t.company_id,t.business_unit_id,t.id,p_supplier_id,
    round(p_amount,2),btrim(p_reason),auth.uid()
  )
  returning id into r;

  perform public.transport_financial_audit(
    t.id,
    'rent_finalized',
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
