create table if not exists public.order_book_qty_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id(),
  business_unit_id uuid not null default public.current_business_unit_id(),
  commitment_id uuid not null references public.order_book_commitments(id) on delete cascade,
  adjustment_type text not null check (adjustment_type in ('add','reduce')),
  adjustment_qty numeric not null check (adjustment_qty > 0),
  old_ordered_qty numeric not null,
  new_ordered_qty numeric not null,
  old_cancelled_qty numeric not null,
  new_cancelled_qty numeric not null,
  reason text not null,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);

alter table public.order_book_qty_history enable row level security;

drop policy if exists order_book_qty_history_select on public.order_book_qty_history;
create policy order_book_qty_history_select on public.order_book_qty_history
for select to authenticated using (
  company_id = public.current_company_id()
  and business_unit_id = public.current_business_unit_id()
);

create or replace function public.adjust_order_book_quantity(
  p_commitment_id uuid,
  p_adjustment_type text,
  p_qty numeric,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  c public.order_book_commitments%rowtype;
  h public.order_book_headers%rowtype;
  v_available numeric;
  v_old_ordered numeric;
  v_new_ordered numeric;
  v_old_cancelled numeric;
  v_new_cancelled numeric;
  v_new_status text;
  v_header_status text;
  v_remaining_count int;
  v_pending_count int;
  v_fulfilled_total numeric;
begin
  if p_adjustment_type not in ('add','reduce') then raise exception 'Adjustment type must be add or reduce.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Adjustment quantity must be greater than zero.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Adjustment reason is required.'; end if;

  select * into c from public.order_book_commitments where id=p_commitment_id for update;
  if not found then raise exception 'Order commitment not found.'; end if;
  select * into h from public.order_book_headers where id=c.order_id for update;
  if not found then raise exception 'Order header not found.'; end if;
  if h.company_id <> public.current_company_id() or h.business_unit_id <> public.current_business_unit_id() then
    raise exception 'Order commitment is outside active company/business unit.';
  end if;
  perform public.assert_module_permission(case when h.order_type='sales' then 'sales' else 'purchase' end,'edit');
  if h.status in ('cancelled','completed') then raise exception 'Completed or cancelled orders cannot be adjusted.'; end if;
  if c.status in ('cancelled','completed') then raise exception 'Completed or cancelled commitment cannot be adjusted.'; end if;

  v_old_ordered:=c.ordered_qty;
  v_old_cancelled:=c.cancelled_qty;
  v_new_ordered:=c.ordered_qty;
  v_new_cancelled:=c.cancelled_qty;

  if p_adjustment_type='add' then
    v_new_ordered:=c.ordered_qty+p_qty;
  else
    v_available:=public.order_commitment_available_qty(c.id);
    if p_qty > v_available + 0.0001 then
      raise exception 'Reduce quantity exceeds unreserved available balance %. Remove linked Draft invoice quantity first if needed.',v_available;
    end if;
    v_new_cancelled:=c.cancelled_qty+p_qty;
  end if;

  if c.fulfilled_qty + v_new_cancelled >= v_new_ordered - 0.0001 then
    v_new_status:=case when c.fulfilled_qty>0 then 'completed' else 'cancelled' end;
  elsif c.fulfilled_qty>0 then
    v_new_status:='partially_fulfilled';
  else
    v_new_status:='open';
  end if;

  update public.order_book_commitments
     set ordered_qty=v_new_ordered,
         cancelled_qty=v_new_cancelled,
         status=v_new_status,
         updated_by=auth.uid(),
         updated_at=now()
   where id=c.id;

  insert into public.order_book_qty_history(
    company_id,business_unit_id,commitment_id,adjustment_type,adjustment_qty,
    old_ordered_qty,new_ordered_qty,old_cancelled_qty,new_cancelled_qty,reason,changed_by
  ) values(
    h.company_id,h.business_unit_id,c.id,p_adjustment_type,p_qty,
    v_old_ordered,v_new_ordered,v_old_cancelled,v_new_cancelled,trim(p_reason),auth.uid()
  );

  select count(*) filter (where greatest(ordered_qty-fulfilled_qty-cancelled_qty,0)>0),
         count(*) filter (where rate_status='pending' and greatest(ordered_qty-fulfilled_qty-cancelled_qty,0)>0),
         coalesce(sum(fulfilled_qty),0)
    into v_remaining_count,v_pending_count,v_fulfilled_total
  from public.order_book_commitments where order_id=h.id;

  if v_remaining_count=0 then
    v_header_status:=case when v_fulfilled_total>0 then 'completed' else 'cancelled' end;
  elsif v_fulfilled_total>0 then
    v_header_status:='partially_fulfilled';
  elsif v_pending_count>0 then
    v_header_status:='rate_pending';
  else
    v_header_status:='confirmed';
  end if;

  update public.order_book_headers set status=v_header_status,updated_by=auth.uid(),updated_at=now() where id=h.id;

  return jsonb_build_object(
    'success',true,
    'order_id',h.id,
    'order_no',h.order_no,
    'commitment_id',c.id,
    'adjustment_type',p_adjustment_type,
    'adjustment_qty',p_qty,
    'old_ordered_qty',v_old_ordered,
    'new_ordered_qty',v_new_ordered,
    'old_cancelled_qty',v_old_cancelled,
    'new_cancelled_qty',v_new_cancelled,
    'commitment_status',v_new_status,
    'order_status',v_header_status
  );
end
$$;

grant execute on function public.adjust_order_book_quantity(uuid,text,numeric,text) to authenticated;