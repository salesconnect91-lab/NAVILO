-- NAVILO year-wise numbering. Existing posted document numbers are intentionally preserved.

create or replace function public.assign_purchase_order_number_yearwise()
returns trigger language plpgsql security invoker set search_path=public as $$
declare v_year text; v_prefix text; v_next bigint;
begin
 if new.order_date is null then new.order_date:=current_date; end if;
 v_year:=extract(year from new.order_date)::int::text;
 v_prefix:=case when new.invoice_type='Tax Invoice' then 'PTAX' else 'PINV' end;
 if new.order_no is null or btrim(new.order_no)='' or new.order_no like '%-AUTO' then
  perform pg_advisory_xact_lock(hashtext(coalesce(new.company_id::text,'')||':purchase:'||v_prefix||':'||v_year));
  select coalesce(max((substring(order_no from ('^'||v_prefix||'-'||v_year||'-([0-9]+)$')))::bigint),0)+1 into v_next from public.purchase_orders where company_id is not distinct from new.company_id and order_no ~ ('^'||v_prefix||'-'||v_year||'-[0-9]+$');
  new.order_no:=v_prefix||'-'||v_year||'-'||lpad(v_next::text,4,'0');
 end if; return new;
end $$;
drop trigger if exists trg_assign_purchase_order_number_yearwise on public.purchase_orders;
create trigger trg_assign_purchase_order_number_yearwise before insert on public.purchase_orders for each row execute function public.assign_purchase_order_number_yearwise();

create or replace function public.assign_consolidated_purchase_invoice_number_yearwise()
returns trigger language plpgsql security invoker set search_path=public as $$
declare v_year text; v_next bigint;
begin
 if new.invoice_date is null then new.invoice_date:=current_date; end if; v_year:=extract(year from new.invoice_date)::int::text;
 if new.invoice_no is null or btrim(new.invoice_no)='' or new.invoice_no ~ '^CPI-[0-9]{8}-[0-9]{6}$' then
  perform pg_advisory_xact_lock(hashtext(coalesce(new.company_id::text,'')||':consolidated-purchase:'||v_year));
  select coalesce(max((substring(invoice_no from ('^CPI-'||v_year||'-([0-9]+)$')))::bigint),0)+1 into v_next from public.consolidated_purchase_invoices where company_id is not distinct from new.company_id and invoice_no ~ ('^CPI-'||v_year||'-[0-9]+$');
  new.invoice_no:='CPI-'||v_year||'-'||lpad(v_next::text,4,'0');
 end if; return new;
end $$;
drop trigger if exists trg_assign_consolidated_purchase_invoice_number_yearwise on public.consolidated_purchase_invoices;
create trigger trg_assign_consolidated_purchase_invoice_number_yearwise before insert on public.consolidated_purchase_invoices for each row execute function public.assign_consolidated_purchase_invoice_number_yearwise();

create or replace function public.assign_return_note_number_yearwise()
returns trigger language plpgsql security invoker set search_path=public as $$
declare v_year text; v_prefix text; v_next bigint;
begin
 if new.note_date is null then new.note_date:=current_date; end if; v_year:=extract(year from new.note_date)::int::text;
 v_prefix:=case when lower(coalesce(new.note_type,'')) like '%credit%' then 'CN' else 'DN' end;
 if new.note_no is null or btrim(new.note_no)='' or new.note_no ~ '^(CN|DN)-[0-9]{4}-[0-9]+$' then
  perform pg_advisory_xact_lock(hashtext(coalesce(new.company_id::text,'')||':return-note:'||v_prefix||':'||v_year));
  select coalesce(max((substring(note_no from ('^'||v_prefix||'-'||v_year||'-([0-9]+)$')))::bigint),0)+1 into v_next from public.return_notes where company_id is not distinct from new.company_id and note_no ~ ('^'||v_prefix||'-'||v_year||'-[0-9]+$');
  new.note_no:=v_prefix||'-'||v_year||'-'||lpad(v_next::text,4,'0');
 end if; return new;
end $$;
drop trigger if exists trg_assign_return_note_number_yearwise on public.return_notes;
create trigger trg_assign_return_note_number_yearwise before insert on public.return_notes for each row execute function public.assign_return_note_number_yearwise();

create or replace function public.preview_next_sales_invoice_number(p_invoice_type text default 'Sale Invoice'::text)
returns text language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_company_id uuid:=public.current_company_id(); v_prefix text; v_year text:=extract(year from current_date)::int::text; v_next bigint;
begin
 if auth.uid() is null or v_company_id is null then raise exception 'Authentication and active company are required.'; end if;
 perform public.assert_module_permission('sales','view');
 v_prefix:=case when p_invoice_type='Tax Invoice' then 'TAX' else 'INV' end;
 select coalesce(max((regexp_match(order_no,'^'||v_prefix||'-'||v_year||'-([0-9]+)$'))[1]::bigint),0)+1 into v_next from public.sales_orders where company_id=v_company_id and order_no ~ ('^'||v_prefix||'-'||v_year||'-[0-9]+$');
 return v_prefix||'-'||v_year||'-'||lpad(v_next::text,4,'0');
end $$;
