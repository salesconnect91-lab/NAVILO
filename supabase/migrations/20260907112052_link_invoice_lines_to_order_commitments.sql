alter table public.sales_order_lines add column if not exists order_book_commitment_id uuid null references public.order_book_commitments(id);
alter table public.purchase_order_lines add column if not exists order_book_commitment_id uuid null references public.order_book_commitments(id);
alter table public.consolidated_sales_invoice_lines add column if not exists order_book_commitment_id uuid null references public.order_book_commitments(id);
alter table public.consolidated_purchase_invoice_lines add column if not exists order_book_commitment_id uuid null references public.order_book_commitments(id);
create index if not exists idx_sales_order_lines_commitment on public.sales_order_lines(order_book_commitment_id) where order_book_commitment_id is not null;
create index if not exists idx_purchase_order_lines_commitment on public.purchase_order_lines(order_book_commitment_id) where order_book_commitment_id is not null;
create index if not exists idx_consolidated_sales_lines_commitment on public.consolidated_sales_invoice_lines(order_book_commitment_id) where order_book_commitment_id is not null;
create index if not exists idx_consolidated_purchase_lines_commitment on public.consolidated_purchase_invoice_lines(order_book_commitment_id) where order_book_commitment_id is not null;

create or replace function public.validate_order_commitment_line()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.order_book_commitments%rowtype; h public.order_book_headers%rowtype; v_qty numeric; v_rate numeric; v_expected text; v_used numeric;
begin
 if new.order_book_commitment_id is null then return new; end if;
 select * into c from public.order_book_commitments where id=new.order_book_commitment_id;
 if not found then raise exception 'Order commitment not found.'; end if;
 select * into h from public.order_book_headers where id=c.order_id;
 if not found then raise exception 'Order header not found.'; end if;
 if c.company_id<>public.current_company_id() or c.business_unit_id<>public.current_business_unit_id() then raise exception 'Cross-company/business-unit order commitment denied.'; end if;
 if c.rate_status<>'agreed' or c.agreed_rate is null then raise exception 'Order commitment rate is not agreed.'; end if;
 v_qty:=coalesce(new.qty,0);
 if v_qty<=0 then raise exception 'Invoice quantity must be greater than zero.'; end if;
 if tg_table_name in ('sales_order_lines','consolidated_sales_invoice_lines') then v_expected:='sales'; v_rate:=coalesce(new.unit_price,0); else v_expected:='purchase'; v_rate:=coalesce(new.unit_cost,0); end if;
 if h.order_type<>v_expected then raise exception 'Order commitment type does not match invoice type.'; end if;
 if new.item_id<>c.item_id then raise exception 'Invoice item does not match order commitment item.'; end if;
 if abs(v_rate-c.agreed_rate)>0.0001 then raise exception 'Invoice rate must match agreed order rate %.',c.agreed_rate; end if;
 select coalesce(sum(qty),0) into v_used from public.order_book_fulfillments where commitment_id=c.id;
 if v_used+v_qty > c.ordered_qty-c.cancelled_qty+0.0001 then raise exception 'Invoice quantity exceeds remaining order quantity.'; end if;
 return new;
end $$;

drop trigger if exists trg_validate_sales_order_commitment on public.sales_order_lines;
create trigger trg_validate_sales_order_commitment before insert or update of order_book_commitment_id,item_id,qty,unit_price on public.sales_order_lines for each row execute function public.validate_order_commitment_line();
drop trigger if exists trg_validate_purchase_order_commitment on public.purchase_order_lines;
create trigger trg_validate_purchase_order_commitment before insert or update of order_book_commitment_id,item_id,qty,unit_cost on public.purchase_order_lines for each row execute function public.validate_order_commitment_line();
drop trigger if exists trg_validate_consolidated_sales_commitment on public.consolidated_sales_invoice_lines;
create trigger trg_validate_consolidated_sales_commitment before insert or update of order_book_commitment_id,item_id,qty,unit_price on public.consolidated_sales_invoice_lines for each row execute function public.validate_order_commitment_line();
drop trigger if exists trg_validate_consolidated_purchase_commitment on public.consolidated_purchase_invoice_lines;
create trigger trg_validate_consolidated_purchase_commitment before insert or update of order_book_commitment_id,item_id,qty,unit_cost on public.consolidated_purchase_invoice_lines for each row execute function public.validate_order_commitment_line();