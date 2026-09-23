alter table public.gate_passes add column if not exists reopened_at timestamptz;
alter table public.gate_passes add column if not exists reopened_by uuid;

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

  if coalesce(new.gross_weight,0) > 0 and new.gross_weight < coalesce(new.tare_weight,0) then
    raise exception 'Gross weight cannot be less than tare weight';
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

create or replace function public.reopen_final_gate_pass_for_correction(p_gate_pass_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  perform public.assert_module_permission('inventory','edit');

  select company_id, status into v_company, v_status
  from public.gate_passes
  where id=p_gate_pass_id
  for update;

  if v_company is null then raise exception 'Gate Pass not found.'; end if;
  if v_company is distinct from public.current_company_id() then raise exception 'Cross-company Gate Pass access denied.'; end if;
  if v_status <> 'finalized' then raise exception 'Only Final Gate Pass can be reopened.'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'Correction reason is required.'; end if;

  perform set_config('app.gate_pass_reopen','on',true);
  update public.gate_passes
  set status='weighed',
      correction_reason=trim(p_reason),
      reopened_at=now(),
      reopened_by=auth.uid(),
      finalized_at=null,
      finalized_by=null
  where id=p_gate_pass_id;
end
$function$;

revoke all on function public.reopen_final_gate_pass_for_correction(uuid,text) from public, anon;
grant execute on function public.reopen_final_gate_pass_for_correction(uuid,text) to authenticated, service_role;
