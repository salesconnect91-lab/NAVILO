alter table public.order_book_headers
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid;

create table if not exists public.order_book_cancellation_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.order_book_headers(id) on delete cascade,
  company_id uuid not null,
  business_unit_id uuid not null,
  order_type text not null check (order_type in ('sales','purchase')),
  order_no text not null,
  reason text not null,
  cancelled_by uuid,
  cancelled_at timestamptz not null default now(),
  snapshot jsonb not null default '{}'::jsonb
);

alter table public.order_book_cancellation_history enable row level security;

drop policy if exists order_book_cancellation_history_select on public.order_book_cancellation_history;
create policy order_book_cancellation_history_select on public.order_book_cancellation_history
for select to authenticated
using (company_id = public.current_company_id() and business_unit_id = public.current_business_unit_id());

create or replace function public.cancel_order_book_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  h public.order_book_headers%rowtype;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_cancelled_qty numeric:=0;
  v_fulfilled_qty numeric:=0;
  v_draft_links integer:=0;
  v_snapshot jsonb;
begin
  if v_reason='' then raise exception 'Cancellation reason is required.'; end if;

  select * into h from public.order_book_headers where id=p_order_id for update;
  if not found then raise exception 'Order Book order not found.'; end if;
  if h.company_id is distinct from public.current_company_id() or h.business_unit_id is distinct from public.current_business_unit_id() then
    raise exception 'Order is outside the active company/business unit.';
  end if;
  if h.status='cancelled' then raise exception 'Order is already cancelled.'; end if;
  if h.status='completed' then raise exception 'Completed order cannot be cancelled.'; end if;

  perform public.assert_module_permission(case when h.order_type='sales' then 'sales' else 'purchase' end,'edit');

  select
    (select count(*) from public.sales_order_lines l join public.sales_orders s on s.id=l.order_id join public.order_book_commitments c on c.id=l.order_book_commitment_id where c.order_id=p_order_id and lower(s.status)='draft')
    + (select count(*) from public.purchase_order_lines l join public.purchase_orders p on p.id=l.order_id join public.order_book_commitments c on c.id=l.order_book_commitment_id where c.order_id=p_order_id and lower(p.status)='draft')
    + (select count(*) from public.consolidated_sales_invoice_lines l join public.consolidated_sales_invoices s on s.id=l.invoice_id join public.order_book_commitments c on c.id=l.order_book_commitment_id where c.order_id=p_order_id and lower(s.status)='draft')
    + (select count(*) from public.consolidated_purchase_invoice_lines l join public.consolidated_purchase_invoices p on p.id=l.invoice_id join public.order_book_commitments c on c.id=l.order_book_commitment_id where c.order_id=p_order_id and lower(p.status)='draft')
  into v_draft_links;

  if v_draft_links>0 then
    raise exception 'This order has % linked draft invoice line(s). Remove those draft lines before cancelling the order.', v_draft_links;
  end if;

  select coalesce(sum(fulfilled_qty),0), coalesce(sum(greatest(ordered_qty-fulfilled_qty-cancelled_qty,0)),0),
         jsonb_agg(jsonb_build_object('commitment_id',id,'item_id',item_id,'item_name',item_name,'ordered_qty',ordered_qty,'fulfilled_qty',fulfilled_qty,'cancelled_qty_before',cancelled_qty,'uom',uom,'rate_status',rate_status,'agreed_rate',agreed_rate,'status_before',status))
  into v_fulfilled_qty,v_cancelled_qty,v_snapshot
  from public.order_book_commitments
  where order_id=p_order_id;

  update public.order_book_commitments
  set cancelled_qty = cancelled_qty + greatest(ordered_qty-fulfilled_qty-cancelled_qty,0),
      status = case when ordered_qty-fulfilled_qty-cancelled_qty>0 then 'cancelled' else status end,
      updated_by=auth.uid(),
      updated_at=now()
  where order_id=p_order_id;

  update public.order_book_headers
  set status='cancelled', cancellation_reason=v_reason, cancelled_at=now(), cancelled_by=auth.uid(), updated_by=auth.uid(), updated_at=now()
  where id=p_order_id;

  insert into public.order_book_cancellation_history(order_id,company_id,business_unit_id,order_type,order_no,reason,cancelled_by,snapshot)
  values(p_order_id,h.company_id,h.business_unit_id,h.order_type,h.order_no,v_reason,auth.uid(),coalesce(v_snapshot,'[]'::jsonb));

  return jsonb_build_object('success',true,'order_id',p_order_id,'order_no',h.order_no,'status','cancelled','fulfilled_qty',v_fulfilled_qty,'cancelled_qty',v_cancelled_qty,'reason',v_reason);
end
$$;

grant execute on function public.cancel_order_book_order(uuid,text) to authenticated;