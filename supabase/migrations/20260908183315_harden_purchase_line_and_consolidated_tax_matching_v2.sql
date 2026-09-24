create or replace function public.add_purchase_invoice_line(
  p_order_id uuid,
  p_item_id uuid,
  p_godown_id uuid,
  p_qty numeric,
  p_unit_cost numeric,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_company uuid:=public.current_company_id();
  v_bu uuid:=public.current_business_unit_id();
  v_order public.purchase_orders%rowtype;
  v_line_id uuid;
  v_tax numeric:=0;
begin
  perform public.assert_module_permission('purchase','edit');
  if auth.uid() is null or v_company is null or v_bu is null then raise exception 'Authentication, active company and business unit are required.'; end if;
  select * into v_order from public.purchase_orders where id=p_order_id and company_id=v_company and business_unit_id=v_bu for update;
  if not found then raise exception 'Purchase invoice not found in active business unit.'; end if;
  if v_order.status='posted' then raise exception 'Posted Purchase Invoice cannot be edited.'; end if;
  if coalesce(p_qty,0)<=0 then raise exception 'Quantity must be greater than zero.'; end if;
  if coalesce(p_unit_cost,0)<0 then raise exception 'Unit cost cannot be negative.'; end if;
  if not exists(select 1 from public.items i where i.id=p_item_id and i.company_id=v_company) then raise exception 'Selected item is not available in active company.'; end if;
  if not exists(select 1 from public.godowns g where g.id=p_godown_id and g.company_id=v_company and g.business_unit_id=v_bu) then raise exception 'Selected godown is not available in active business unit.'; end if;
  if v_order.invoice_type='Tax Invoice' then v_tax:=coalesce(v_order.tax_percent,0); end if;
  insert into public.purchase_order_lines(user_id,company_id,business_unit_id,order_id,item_id,godown_id,qty,unit_cost,tax_percent,line_total,description)
  values(v_order.user_id,v_company,v_bu,p_order_id,p_item_id,p_godown_id,round(p_qty,4),round(p_unit_cost,4),v_tax,round(p_qty*p_unit_cost,2),nullif(trim(coalesce(p_description,'')),''))
  returning id into v_line_id;
  return v_line_id;
end
$function$;
grant execute on function public.add_purchase_invoice_line(uuid,uuid,uuid,numeric,numeric,text) to authenticated;

create or replace function public.delete_purchase_invoice_line(p_line_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_company uuid:=public.current_company_id(); v_bu uuid:=public.current_business_unit_id(); v_status text;
begin
  perform public.assert_module_permission('purchase','edit');
  select po.status into v_status from public.purchase_order_lines l join public.purchase_orders po on po.id=l.order_id
  where l.id=p_line_id and l.company_id=v_company and l.business_unit_id=v_bu and po.company_id=v_company and po.business_unit_id=v_bu;
  if not found then raise exception 'Purchase invoice line not found in active business unit.'; end if;
  if v_status='posted' then raise exception 'Posted Purchase Invoice lines cannot be deleted.'; end if;
  delete from public.purchase_order_lines where id=p_line_id and company_id=v_company and business_unit_id=v_bu;
  return found;
end
$function$;
grant execute on function public.delete_purchase_invoice_line(uuid) to authenticated;

create or replace function public.guard_purchase_consolidated_link_match()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_order public.purchase_orders%rowtype; v_doc public.consolidated_purchase_invoices%rowtype;
begin
  select * into v_order from public.purchase_orders where id=new.purchase_order_id;
  select * into v_doc from public.consolidated_purchase_invoices where id=new.consolidated_invoice_id;
  if v_order.id is null or v_doc.id is null then raise exception 'Purchase or Consolidated Purchase document not found.'; end if;
  if v_order.company_id is distinct from v_doc.company_id or v_order.business_unit_id is distinct from v_doc.business_unit_id then raise exception 'Main and Consolidated Purchase must belong to the same company and business unit.'; end if;
  if v_order.supplier_id is distinct from v_doc.supplier_id then raise exception 'Main and Consolidated Purchase supplier must match.'; end if;
  if coalesce(v_order.invoice_type,'Purchase Invoice') is distinct from coalesce(v_doc.invoice_type,'Purchase Invoice') then raise exception 'Main and Consolidated Purchase tax type must match.'; end if;
  if v_doc.status<>'posted' then raise exception 'Only posted Consolidated Purchase invoices can be attached.'; end if;
  new.company_id:=v_order.company_id; new.business_unit_id:=v_order.business_unit_id; new.user_id:=v_order.user_id; return new;
end
$function$;
drop trigger if exists trg_guard_purchase_consolidated_link_match on public.purchase_order_consolidated_invoices;
create trigger trg_guard_purchase_consolidated_link_match before insert or update on public.purchase_order_consolidated_invoices for each row execute function public.guard_purchase_consolidated_link_match();

drop function if exists public.get_available_consolidated_purchase_invoices(uuid,uuid);
create function public.get_available_consolidated_purchase_invoices(p_supplier_id uuid, p_order_id uuid default null)
returns table(id uuid, invoice_no text, invoice_date date, reference_name text, reference_no text, total numeric, linked_purchase_order_id uuid, invoice_type text)
language sql security definer set search_path to 'public','pg_temp'
as $function$
  select h.id,h.invoice_no,h.invoice_date,h.reference_name,h.reference_no,h.total,l.purchase_order_id,h.invoice_type
  from public.consolidated_purchase_invoices h
  left join public.purchase_order_consolidated_invoices l on l.consolidated_invoice_id=h.id and l.company_id=public.current_company_id() and l.business_unit_id=public.current_business_unit_id()
  left join public.purchase_orders po on po.id=p_order_id
  where h.company_id=public.current_company_id() and h.business_unit_id=public.current_business_unit_id() and h.status='posted'
    and h.supplier_id=p_supplier_id
    and (p_order_id is null or po.id is not null)
    and (p_order_id is null or coalesce(h.invoice_type,'Purchase Invoice')=coalesce(po.invoice_type,'Purchase Invoice'))
    and (l.purchase_order_id is null or l.purchase_order_id=p_order_id)
  order by h.invoice_date,h.invoice_no;
$function$;
grant execute on function public.get_available_consolidated_purchase_invoices(uuid,uuid) to authenticated;

create or replace function public.guard_sales_consolidated_link_match()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_order public.sales_orders%rowtype; v_doc public.consolidated_sales_invoices%rowtype;
begin
  select * into v_order from public.sales_orders where id=new.sales_order_id;
  select * into v_doc from public.consolidated_sales_invoices where id=new.hawala_invoice_id;
  if v_order.id is null or v_doc.id is null then raise exception 'Sales or Consolidated Sales document not found.'; end if;
  if v_order.company_id is distinct from v_doc.company_id or v_order.business_unit_id is distinct from v_doc.business_unit_id then raise exception 'Main and Consolidated Sales must belong to the same company and business unit.'; end if;
  if v_order.customer_id is distinct from v_doc.customer_id then raise exception 'Main and Consolidated Sales customer must match.'; end if;
  if coalesce(v_order.invoice_type,'Cash Bill') is distinct from coalesce(v_doc.invoice_type,'Cash Bill') then raise exception 'Main and Consolidated Sales tax type must match.'; end if;
  if v_doc.status<>'posted' then raise exception 'Only posted Consolidated Sales invoices can be attached.'; end if;
  new.company_id:=v_order.company_id; new.business_unit_id:=v_order.business_unit_id; new.user_id:=v_order.user_id; return new;
end
$function$;
do $do$ begin
  if to_regclass('public.sales_order_hawala_invoices') is not null then
    execute 'drop trigger if exists trg_guard_sales_consolidated_link_match on public.sales_order_hawala_invoices';
    execute 'create trigger trg_guard_sales_consolidated_link_match before insert or update on public.sales_order_hawala_invoices for each row execute function public.guard_sales_consolidated_link_match()';
  end if;
end $do$;