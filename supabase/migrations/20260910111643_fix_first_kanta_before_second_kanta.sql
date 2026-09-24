create or replace function public.enforce_gate_pass_workflow()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_reopen text := current_setting('app.gate_pass_reopen', true);
begin
  if coalesce(new.tare_weight,0) < 0 or coalesce(new.gross_weight,0) < 0 then
    raise exception 'Weights cannot be negative';
  end if;

  -- 1st Kanta (tare) is an independent step. If tare is corrected after an
  -- earlier/invalid 2nd Kanta and the old gross no longer exceeds tare,
  -- invalidate that gross reading instead of blocking the tare correction.
  if tg_op='UPDATE'
     and new.tare_weight is distinct from old.tare_weight
     and coalesce(new.gross_weight,0) > 0
     and new.gross_weight <= coalesce(new.tare_weight,0) then
    new.gross_weight := 0;
    new.gross_weighbridge_reference := null;
    new.weighbridge_reference := null;
    new.gross_weighed_at := null;
    new.weighed_at := null;
    if old.status='weighed' then
      new.status := case when old.loading_completed_at is not null then 'loading' else 'tare_weighed' end;
    end if;
  end if;

  -- Gross validation belongs to the 2nd Kanta only.
  if coalesce(new.gross_weight,0) > 0 and new.gross_weight <= coalesce(new.tare_weight,0) then
    raise exception '2nd Kanta gross weight must be greater than 1st Kanta tare weight';
  end if;

  new.net_weight := greatest(coalesce(new.gross_weight,0)-coalesce(new.tare_weight,0),0);
  new.order_book_header_id := null;
  new.sales_order_id := null;

  if tg_op='UPDATE' and old.status='finalized' then
    if coalesce(v_reopen,'') <> 'on' then
      if new.status <> 'finalized'
         or new.customer_id is distinct from old.customer_id
         or new.customer_name is distinct from old.customer_name
         or new.vehicle_no is distinct from old.vehicle_no
         or new.driver_name is distinct from old.driver_name
         or new.token_notes is distinct from old.token_notes
         or new.pass_date is distinct from old.pass_date
         or new.tare_weight is distinct from old.tare_weight
         or new.gross_weight is distinct from old.gross_weight
         or new.loaded_by_loader_id is distinct from old.loaded_by_loader_id
         or new.loaded_by_name is distinct from old.loaded_by_name then
        raise exception 'Final Gate Pass is locked. Use Reopen for Correction.';
      end if;
    else
      if new.status <> 'weighed' then
        raise exception 'Reopened Final Gate Pass must return to 2nd Kanta Done stage';
      end if;
      if coalesce(trim(new.correction_reason),'')='' then
        raise exception 'Correction reason is required';
      end if;
    end if;
  end if;

  if new.status='finalized' then
    if coalesce(new.customer_name,'')='' then raise exception 'Customer is required'; end if;
    if coalesce(new.vehicle_no,'')='' then raise exception 'Vehicle number is required'; end if;
    if coalesce(new.tare_weight,0)<=0 or coalesce(new.gross_weight,0)<=0 or new.net_weight<=0 then
      raise exception 'Final Gate Pass requires valid tare, gross and net weight';
    end if;
    if tg_op='INSERT' or old.status is distinct from 'finalized' then
      new.finalized_at:=now();
      new.finalized_by:=auth.uid();
    end if;
  end if;

  return new;
end
$function$;
