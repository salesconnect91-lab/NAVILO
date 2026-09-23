alter table public.order_book_fulfillments add column if not exists business_unit_id uuid null;
update public.order_book_fulfillments f set business_unit_id=c.business_unit_id from public.order_book_commitments c where c.id=f.commitment_id and f.business_unit_id is null;
alter table public.order_book_fulfillments alter column business_unit_id set not null;
create index if not exists idx_order_book_fulfillments_bu on public.order_book_fulfillments(company_id,business_unit_id,commitment_id);
create unique index if not exists uq_order_book_fulfillment_document_commitment on public.order_book_fulfillments(document_type,document_id,commitment_id) where document_id is not null;

drop trigger if exists order_book_context_stamp on public.order_book_fulfillments;
create trigger order_book_context_stamp before insert or update on public.order_book_fulfillments for each row execute function public.order_book_stamp_context();

create or replace function public.refresh_order_book_commitment(p_commitment_id uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_fulfilled numeric; v_order uuid;
begin
 select coalesce(sum(qty),0) into v_fulfilled from public.order_book_fulfillments where commitment_id=p_commitment_id;
 update public.order_book_commitments set fulfilled_qty=v_fulfilled,
   status=case when cancelled_qty>=ordered_qty then 'cancelled' when v_fulfilled>=ordered_qty-cancelled_qty then 'completed' when v_fulfilled>0 then 'partially_fulfilled' else 'open' end,
   updated_at=now(),updated_by=auth.uid()
 where id=p_commitment_id returning order_id into v_order;
 if v_order is not null then
   update public.order_book_headers h set status=case
     when not exists(select 1 from public.order_book_commitments c where c.order_id=h.id and c.status not in ('completed','cancelled')) then 'completed'
     when exists(select 1 from public.order_book_commitments c where c.order_id=h.id and c.fulfilled_qty>0) then 'partially_fulfilled'
     when exists(select 1 from public.order_book_commitments c where c.order_id=h.id and c.rate_status='pending' and c.status<>'cancelled') then 'rate_pending'
     else 'confirmed' end,updated_at=now(),updated_by=auth.uid()
   where h.id=v_order;
 end if;
end $$;

create or replace function public.capture_main_invoice_order_fulfillment()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare r record; v_type text; v_no text; v_date date;
begin
 if new.status<>'posted' or old.status='posted' then return new; end if;
 if tg_table_name='sales_orders' then v_type:='sales_invoice';v_no:=new.order_no;v_date:=new.order_date;
   for r in select order_book_commitment_id commitment_id,sum(qty) qty,max(unit_price) rate from public.sales_order_lines where order_id=new.id and order_book_commitment_id is not null group by order_book_commitment_id loop
     insert into public.order_book_fulfillments(company_id,business_unit_id,user_id,commitment_id,document_type,document_id,document_no,document_date,qty,rate)
     values(new.company_id,new.business_unit_id,new.user_id,r.commitment_id,v_type,new.id,v_no,v_date,r.qty,r.rate)
     on conflict(document_type,document_id,commitment_id) where document_id is not null do update set qty=excluded.qty,rate=excluded.rate;
     perform public.refresh_order_book_commitment(r.commitment_id);
   end loop;
 else v_type:='purchase_invoice';v_no:=new.order_no;v_date:=new.order_date;
   for r in select order_book_commitment_id commitment_id,sum(qty) qty,max(unit_cost) rate from public.purchase_order_lines where order_id=new.id and order_book_commitment_id is not null group by order_book_commitment_id loop
     insert into public.order_book_fulfillments(company_id,business_unit_id,user_id,commitment_id,document_type,document_id,document_no,document_date,qty,rate)
     values(new.company_id,new.business_unit_id,new.user_id,r.commitment_id,v_type,new.id,v_no,v_date,r.qty,r.rate)
     on conflict(document_type,document_id,commitment_id) where document_id is not null do update set qty=excluded.qty,rate=excluded.rate;
     perform public.refresh_order_book_commitment(r.commitment_id);
   end loop;
 end if;
 return new;
end $$;
drop trigger if exists trg_sales_order_book_fulfillment on public.sales_orders;
create trigger trg_sales_order_book_fulfillment after update of status on public.sales_orders for each row execute function public.capture_main_invoice_order_fulfillment();
drop trigger if exists trg_purchase_order_book_fulfillment on public.purchase_orders;
create trigger trg_purchase_order_book_fulfillment after update of status on public.purchase_orders for each row execute function public.capture_main_invoice_order_fulfillment();
