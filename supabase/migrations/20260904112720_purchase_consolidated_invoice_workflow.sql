create table if not exists public.consolidated_purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  company_id uuid not null default public.current_company_id(),
  invoice_no text not null,
  invoice_date date not null default current_date,
  supplier_id uuid references public.suppliers(id),
  reference_name text,
  reference_no text,
  reference_notes text,
  invoice_type text not null default 'Purchase Invoice' check (invoice_type in ('Purchase Invoice','Tax Invoice')),
  tax_percent numeric not null default 0 check (tax_percent between 0 and 100),
  item_tax numeric not null default 0,
  charges_total numeric not null default 0,
  charge_tax numeric not null default 0,
  subtotal numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'draft' check (status in ('draft','posted','cancelled')),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, invoice_no)
);

create table if not exists public.consolidated_purchase_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  company_id uuid not null default public.current_company_id(),
  invoice_id uuid not null references public.consolidated_purchase_invoices(id) on delete cascade,
  item_id uuid not null references public.items(id),
  godown_id uuid not null references public.godowns(id),
  qty numeric not null check (qty > 0),
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  tax_percent numeric not null default 0 check (tax_percent between 0 and 100),
  line_total numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.consolidated_purchase_invoice_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  company_id uuid not null default public.current_company_id(),
  invoice_id uuid not null references public.consolidated_purchase_invoices(id) on delete cascade,
  charge_key text not null,
  amount numeric not null default 0 check (amount >= 0),
  tax_percent numeric not null default 0 check (tax_percent between 0 and 100),
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_order_consolidated_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  company_id uuid not null default public.current_company_id(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  consolidated_invoice_id uuid not null references public.consolidated_purchase_invoices(id),
  created_at timestamptz not null default now(),
  unique (company_id, consolidated_invoice_id),
  unique (company_id, purchase_order_id, consolidated_invoice_id)
);

alter table public.purchase_order_lines
  add column if not exists source_consolidated_purchase_invoice_id uuid references public.consolidated_purchase_invoices(id);

alter table public.consolidated_purchase_invoices enable row level security;
alter table public.consolidated_purchase_invoice_lines enable row level security;
alter table public.consolidated_purchase_invoice_charges enable row level security;
alter table public.purchase_order_consolidated_invoices enable row level security;

drop policy if exists tenant_select_consolidated_purchase_invoices on public.consolidated_purchase_invoices;
create policy tenant_select_consolidated_purchase_invoices on public.consolidated_purchase_invoices for select to authenticated using (public.has_module_permission(company_id,'purchase','view'));
drop policy if exists tenant_insert_consolidated_purchase_invoices on public.consolidated_purchase_invoices;
create policy tenant_insert_consolidated_purchase_invoices on public.consolidated_purchase_invoices for insert to authenticated with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'purchase','create'));
drop policy if exists tenant_update_consolidated_purchase_invoices on public.consolidated_purchase_invoices;
create policy tenant_update_consolidated_purchase_invoices on public.consolidated_purchase_invoices for update to authenticated using (public.has_module_permission(company_id,'purchase','edit')) with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'purchase','edit'));
drop policy if exists tenant_delete_consolidated_purchase_invoices on public.consolidated_purchase_invoices;
create policy tenant_delete_consolidated_purchase_invoices on public.consolidated_purchase_invoices for delete to authenticated using (public.has_module_permission(company_id,'purchase','delete'));

drop policy if exists tenant_select_consolidated_purchase_invoice_lines on public.consolidated_purchase_invoice_lines;
create policy tenant_select_consolidated_purchase_invoice_lines on public.consolidated_purchase_invoice_lines for select to authenticated using (public.has_module_permission(company_id,'purchase','view'));
drop policy if exists tenant_insert_consolidated_purchase_invoice_lines on public.consolidated_purchase_invoice_lines;
create policy tenant_insert_consolidated_purchase_invoice_lines on public.consolidated_purchase_invoice_lines for insert to authenticated with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'purchase','create'));
drop policy if exists tenant_update_consolidated_purchase_invoice_lines on public.consolidated_purchase_invoice_lines;
create policy tenant_update_consolidated_purchase_invoice_lines on public.consolidated_purchase_invoice_lines for update to authenticated using (public.has_module_permission(company_id,'purchase','edit')) with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'purchase','edit'));
drop policy if exists tenant_delete_consolidated_purchase_invoice_lines on public.consolidated_purchase_invoice_lines;
create policy tenant_delete_consolidated_purchase_invoice_lines on public.consolidated_purchase_invoice_lines for delete to authenticated using (public.has_module_permission(company_id,'purchase','delete'));

drop policy if exists tenant_select_consolidated_purchase_invoice_charges on public.consolidated_purchase_invoice_charges;
create policy tenant_select_consolidated_purchase_invoice_charges on public.consolidated_purchase_invoice_charges for select to authenticated using (public.has_module_permission(company_id,'purchase','view'));
drop policy if exists tenant_insert_consolidated_purchase_invoice_charges on public.consolidated_purchase_invoice_charges;
create policy tenant_insert_consolidated_purchase_invoice_charges on public.consolidated_purchase_invoice_charges for insert to authenticated with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'purchase','create'));
drop policy if exists tenant_update_consolidated_purchase_invoice_charges on public.consolidated_purchase_invoice_charges;
create policy tenant_update_consolidated_purchase_invoice_charges on public.consolidated_purchase_invoice_charges for update to authenticated using (public.has_module_permission(company_id,'purchase','edit')) with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'purchase','edit'));
drop policy if exists tenant_delete_consolidated_purchase_invoice_charges on public.consolidated_purchase_invoice_charges;
create policy tenant_delete_consolidated_purchase_invoice_charges on public.consolidated_purchase_invoice_charges for delete to authenticated using (public.has_module_permission(company_id,'purchase','delete'));

drop policy if exists tenant_select_purchase_order_consolidated_invoices on public.purchase_order_consolidated_invoices;
create policy tenant_select_purchase_order_consolidated_invoices on public.purchase_order_consolidated_invoices for select to authenticated using (public.has_module_permission(company_id,'purchase','view'));
drop policy if exists tenant_insert_purchase_order_consolidated_invoices on public.purchase_order_consolidated_invoices;
create policy tenant_insert_purchase_order_consolidated_invoices on public.purchase_order_consolidated_invoices for insert to authenticated with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'purchase','edit'));
drop policy if exists tenant_delete_purchase_order_consolidated_invoices on public.purchase_order_consolidated_invoices;
create policy tenant_delete_purchase_order_consolidated_invoices on public.purchase_order_consolidated_invoices for delete to authenticated using (public.has_module_permission(company_id,'purchase','edit'));

grant select,insert,update,delete on public.consolidated_purchase_invoices to authenticated;
grant select,insert,update,delete on public.consolidated_purchase_invoice_lines to authenticated;
grant select,insert,update,delete on public.consolidated_purchase_invoice_charges to authenticated;
grant select,insert,delete on public.purchase_order_consolidated_invoices to authenticated;

create or replace function public.validate_consolidated_purchase_line()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_uid uuid:=public.legacy_data_user_id(); v_company uuid:=public.current_company_id(); v_status text;
begin
  if v_uid is null then raise exception 'Authentication required.'; end if;
  select status into v_status from public.consolidated_purchase_invoices where id=new.invoice_id and user_id=v_uid and company_id=v_company;
  if not found then raise exception 'Consolidated Purchase Invoice not found.'; end if;
  if v_status <> 'draft' then raise exception 'Posted Consolidated Purchase Invoice is locked.'; end if;
  new.user_id:=v_uid; new.company_id:=v_company;
  new.line_total:=round(coalesce(new.qty,0)*coalesce(new.unit_cost,0),2);
  return new;
end $$;

create or replace function public.guard_consolidated_purchase_parent()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
begin
  if tg_op='DELETE' then
    if old.status <> 'draft' then raise exception 'Posted Consolidated Purchase Invoice is locked.'; end if;
    return old;
  end if;
  if tg_op='UPDATE' and old.status <> 'draft' then raise exception 'Posted Consolidated Purchase Invoice is locked.'; end if;
  new.updated_at:=now(); return new;
end $$;

create or replace function public.guard_consolidated_purchase_child()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_id uuid; v_status text;
begin
  v_id:=case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
  select status into v_status from public.consolidated_purchase_invoices where id=v_id;
  if v_status is distinct from 'draft' then raise exception 'Posted Consolidated Purchase Invoice details are locked.'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;

drop trigger if exists trg_validate_consolidated_purchase_line on public.consolidated_purchase_invoice_lines;
create trigger trg_validate_consolidated_purchase_line before insert or update on public.consolidated_purchase_invoice_lines for each row execute function public.validate_consolidated_purchase_line();
drop trigger if exists trg_guard_consolidated_purchase_parent on public.consolidated_purchase_invoices;
create trigger trg_guard_consolidated_purchase_parent before update or delete on public.consolidated_purchase_invoices for each row execute function public.guard_consolidated_purchase_parent();
drop trigger if exists trg_guard_consolidated_purchase_line on public.consolidated_purchase_invoice_lines;
create trigger trg_guard_consolidated_purchase_line before update or delete on public.consolidated_purchase_invoice_lines for each row execute function public.guard_consolidated_purchase_child();
drop trigger if exists trg_guard_consolidated_purchase_charge on public.consolidated_purchase_invoice_charges;
create trigger trg_guard_consolidated_purchase_charge before update or delete on public.consolidated_purchase_invoice_charges for each row execute function public.guard_consolidated_purchase_child();

create or replace function public.post_consolidated_purchase_invoice(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare
  v_uid uuid:=public.legacy_data_user_id(); v_company uuid:=public.current_company_id(); v_inv public.consolidated_purchase_invoices%rowtype;
  v_subtotal numeric:=0; v_item_tax numeric:=0; v_charges numeric:=0; v_charge_tax numeric:=0; v_count int:=0; r record;
begin
  perform public.assert_module_permission('purchase','post');
  if v_uid is null then raise exception 'Authentication required.'; end if;
  select * into v_inv from public.consolidated_purchase_invoices where id=p_invoice_id and user_id=v_uid and company_id=v_company for update;
  if not found then raise exception 'Consolidated Purchase Invoice not found.'; end if;
  if v_inv.status <> 'draft' then raise exception 'Only draft Consolidated Purchase Invoices can be posted.'; end if;
  if v_inv.supplier_id is null then raise exception 'Supplier is required.'; end if;
  if exists(select 1 from public.purchase_order_consolidated_invoices where consolidated_invoice_id=p_invoice_id and company_id=v_company) then raise exception 'This Consolidated Purchase Invoice is already attached to a Main Purchase Invoice.'; end if;

  for r in select l.*,g.warehouse_id from public.consolidated_purchase_invoice_lines l join public.godowns g on g.id=l.godown_id where l.invoice_id=p_invoice_id and l.user_id=v_uid and l.company_id=v_company order by l.id loop
    v_count:=v_count+1;
    if r.warehouse_id is null then raise exception 'Selected Godown is not linked to a warehouse.'; end if;
    perform public.apply_stock_movement(r.item_id,r.warehouse_id,r.godown_id,'in',r.qty,v_inv.invoice_no);
    v_subtotal:=v_subtotal+round(r.qty*r.unit_cost,2);
    if v_inv.invoice_type='Tax Invoice' then v_item_tax:=v_item_tax+round(r.qty*r.unit_cost*coalesce(r.tax_percent,0)/100,2); end if;
  end loop;
  if v_count=0 then raise exception 'Add at least one item before posting.'; end if;
  select coalesce(sum(amount),0), coalesce(sum(case when v_inv.invoice_type='Tax Invoice' then amount*tax_percent/100 else 0 end),0) into v_charges,v_charge_tax from public.consolidated_purchase_invoice_charges where invoice_id=p_invoice_id and user_id=v_uid and company_id=v_company;
  update public.consolidated_purchase_invoices set subtotal=round(v_subtotal,2),item_tax=round(v_item_tax,2),charges_total=round(v_charges,2),charge_tax=round(v_charge_tax,2),total=round(v_subtotal+v_item_tax+v_charges+v_charge_tax,2),status='posted',posted_at=now(),updated_at=now() where id=p_invoice_id and user_id=v_uid and company_id=v_company;
  return jsonb_build_object('success',true,'invoice_id',p_invoice_id,'status','posted','stock_posted',true,'accounting_posted',false,'total',round(v_subtotal+v_item_tax+v_charges+v_charge_tax,2));
end $$;

create or replace function public.get_available_consolidated_purchase_invoices(p_supplier_id uuid,p_order_id uuid default null)
returns table(id uuid,invoice_no text,invoice_date date,reference_name text,reference_no text,reference_notes text,subtotal numeric,item_tax numeric,charges_total numeric,charge_tax numeric,total numeric,linked_purchase_order_id uuid)
language plpgsql stable security definer set search_path='public','pg_temp' as $$
declare v_uid uuid:=public.legacy_data_user_id(); v_company uuid:=public.current_company_id();
begin
  if not public.has_module_permission(v_company,'purchase','view') then raise exception 'Purchase view permission required.'; end if;
  return query select h.id,h.invoice_no,h.invoice_date,h.reference_name,h.reference_no,h.reference_notes,h.subtotal,h.item_tax,h.charges_total,h.charge_tax,h.total,l.purchase_order_id
  from public.consolidated_purchase_invoices h left join public.purchase_order_consolidated_invoices l on l.consolidated_invoice_id=h.id and l.user_id=v_uid and l.company_id=v_company
  where h.user_id=v_uid and h.company_id=v_company and h.supplier_id=p_supplier_id and h.status='posted' and (l.id is null or (p_order_id is not null and l.purchase_order_id=p_order_id))
  order by h.invoice_date desc,h.invoice_no desc;
end $$;

create or replace function public.replace_purchase_order_consolidated_invoices(p_order_id uuid,p_consolidated_invoice_ids uuid[] default array[]::uuid[])
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_uid uuid:=public.legacy_data_user_id(); v_company uuid:=public.current_company_id(); v_order public.purchase_orders%rowtype; v_ids uuid[]:=coalesce(p_consolidated_invoice_ids,array[]::uuid[]); v_count int:=0;
begin
  perform public.assert_module_permission('purchase','edit');
  if v_uid is null then raise exception 'Authentication required.'; end if;
  select * into v_order from public.purchase_orders where id=p_order_id and user_id=v_uid and company_id=v_company for update;
  if not found then raise exception 'Main Purchase Invoice not found.'; end if;
  if v_order.status <> 'draft' then raise exception 'Only draft Main Purchase Invoices can change Consolidated links.'; end if;
  if exists(select 1 from unnest(v_ids) x(id) left join public.consolidated_purchase_invoices h on h.id=x.id where h.id is null or h.user_id<>v_uid or h.company_id<>v_company or h.status<>'posted' or h.supplier_id is distinct from v_order.supplier_id) then raise exception 'Invalid Consolidated Purchase selection. It must be posted and belong to the same supplier.'; end if;
  if exists(select 1 from public.purchase_order_consolidated_invoices l join unnest(v_ids) x(id) on x.id=l.consolidated_invoice_id where l.company_id=v_company and l.purchase_order_id<>p_order_id) then raise exception 'One or more Consolidated Purchase Invoices are already used in another Main Purchase Invoice.'; end if;

  delete from public.purchase_order_lines where order_id=p_order_id and source_consolidated_purchase_invoice_id is not null;
  delete from public.purchase_order_consolidated_invoices where purchase_order_id=p_order_id and user_id=v_uid and company_id=v_company;
  insert into public.purchase_order_consolidated_invoices(user_id,company_id,purchase_order_id,consolidated_invoice_id)
  select v_uid,v_company,p_order_id,x.id from (select distinct id from unnest(v_ids) u(id)) x;
  get diagnostics v_count=row_count;
  insert into public.purchase_order_lines(user_id,company_id,order_id,item_id,qty,unit_cost,line_total,godown_id,tax_percent,source_consolidated_purchase_invoice_id)
  select v_uid,v_company,p_order_id,l.item_id,l.qty,l.unit_cost,l.line_total,l.godown_id,case when h.invoice_type='Tax Invoice' then l.tax_percent else 0 end,h.id
  from public.consolidated_purchase_invoice_lines l join public.consolidated_purchase_invoices h on h.id=l.invoice_id join unnest(v_ids) x(id) on x.id=h.id
  where l.user_id=v_uid and l.company_id=v_company;
  update public.purchase_orders set total=(
    select coalesce(sum(pol.line_total + case when po.invoice_type='Tax Invoice' then pol.line_total*pol.tax_percent/100 else 0 end),0)
    from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.order_id where pol.order_id=p_order_id
  ) + coalesce((select sum(h.charges_total + case when v_order.invoice_type='Tax Invoice' then h.charge_tax else 0 end) from public.consolidated_purchase_invoices h join public.purchase_order_consolidated_invoices l on l.consolidated_invoice_id=h.id where l.purchase_order_id=p_order_id),0)
  + coalesce(v_order.loading_charge,0)+coalesce(v_order.unloading_charge,0)+coalesce(v_order.cutting_charge,0)+coalesce(v_order.transport_charge,0)+coalesce(v_order.labour_charge,0)+coalesce(v_order.handling_charge,0)+coalesce(v_order.other_charge,0)
  + case when v_order.invoice_type='Tax Invoice' then (coalesce(v_order.loading_charge,0)+coalesce(v_order.unloading_charge,0)+coalesce(v_order.cutting_charge,0)+coalesce(v_order.transport_charge,0)+coalesce(v_order.labour_charge,0)+coalesce(v_order.handling_charge,0)+coalesce(v_order.other_charge,0))*coalesce(v_order.tax_percent,0)/100 else 0 end
  where id=p_order_id and user_id=v_uid and company_id=v_company;
  return jsonb_build_object('success',true,'purchase_order_id',p_order_id,'linked_count',v_count);
end $$;

revoke all on function public.validate_consolidated_purchase_line() from public;
revoke all on function public.guard_consolidated_purchase_parent() from public;
revoke all on function public.guard_consolidated_purchase_child() from public;
revoke all on function public.post_consolidated_purchase_invoice(uuid) from public;
revoke all on function public.get_available_consolidated_purchase_invoices(uuid,uuid) from public;
revoke all on function public.replace_purchase_order_consolidated_invoices(uuid,uuid[]) from public;
grant execute on function public.post_consolidated_purchase_invoice(uuid) to authenticated;
grant execute on function public.get_available_consolidated_purchase_invoices(uuid,uuid) to authenticated;
grant execute on function public.replace_purchase_order_consolidated_invoices(uuid,uuid[]) to authenticated;