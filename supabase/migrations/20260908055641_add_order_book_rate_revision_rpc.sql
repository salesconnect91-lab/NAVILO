create or replace function public.revise_order_book_rate(
  p_commitment_id uuid, p_new_rate numeric, p_effective_date date, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_company uuid := public.current_company_id(); v_bu uuid := public.current_business_unit_id();
  v_commit public.order_book_commitments%rowtype; v_order_type text; v_balance numeric; v_effective timestamptz;
begin
  if v_company is null or v_bu is null then raise exception 'Active company and business unit are required.'; end if;
  if p_new_rate is null or p_new_rate <= 0 then raise exception 'New rate must be greater than zero.'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'Reason is required for a rate revision.'; end if;
  select c.* into v_commit from public.order_book_commitments c where c.id=p_commitment_id and c.company_id=v_company and c.business_unit_id=v_bu for update;
  if not found then raise exception 'Order Book commitment not found in active workspace.'; end if;
  select h.order_type into v_order_type from public.order_book_headers h where h.id=v_commit.order_id and h.company_id=v_company and h.business_unit_id=v_bu;
  if v_order_type='sales' then perform public.assert_module_permission('sales','edit');
  elsif v_order_type='purchase' then perform public.assert_module_permission('purchase','edit');
  else raise exception 'Unsupported Order Book type.'; end if;
  v_balance:=greatest(0,coalesce(v_commit.ordered_qty,0)-coalesce(v_commit.fulfilled_qty,0)-coalesce(v_commit.cancelled_qty,0));
  if v_balance<=0 then raise exception 'Completed/cancelled commitment has no open quantity to revise.'; end if;
  if v_commit.rate_status='agreed' and round(coalesce(v_commit.agreed_rate,0),4)=round(p_new_rate,4) then raise exception 'New rate is the same as the current agreed rate.'; end if;
  v_effective:=(coalesce(p_effective_date,current_date)::timestamp at time zone 'UTC');
  insert into public.order_book_rate_history(commitment_id,company_id,business_unit_id,old_rate,new_rate,old_rate_status,new_rate_status,effective_at,reason,changed_by)
  values(v_commit.id,v_company,v_bu,v_commit.agreed_rate,p_new_rate,v_commit.rate_status,'agreed',v_effective,trim(p_reason),auth.uid());
  update public.order_book_commitments set rate_status='agreed',agreed_rate=p_new_rate,effective_at=v_effective,source='rate_revision',updated_at=now() where id=v_commit.id;
  return jsonb_build_object('success',true,'commitment_id',v_commit.id,'old_rate',v_commit.agreed_rate,'new_rate',p_new_rate,'open_qty',v_balance,'effective_date',coalesce(p_effective_date,current_date));
end;
$$;
grant execute on function public.revise_order_book_rate(uuid,numeric,date,text) to authenticated;