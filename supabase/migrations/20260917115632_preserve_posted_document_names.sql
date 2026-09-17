-- Preserve the business names that were printed when a commercial document
-- was posted. Master-data edits remain available for future documents without
-- silently rewriting historical invoices, reports, or item history.

alter table public.sales_orders
  add column if not exists customer_name_snapshot text,
  add column if not exists salesperson_name_snapshot text;

alter table public.sales_order_lines
  add column if not exists item_name_snapshot text,
  add column if not exists item_unit_snapshot text,
  add column if not exists godown_name_snapshot text;

alter table public.purchase_orders
  add column if not exists supplier_name_snapshot text,
  add column if not exists purchase_person_name_snapshot text;

alter table public.purchase_order_lines
  add column if not exists item_name_snapshot text,
  add column if not exists item_unit_snapshot text,
  add column if not exists godown_name_snapshot text;

alter table public.consolidated_sales_invoices
  add column if not exists customer_name_snapshot text;

alter table public.consolidated_sales_invoice_lines
  add column if not exists item_name_snapshot text,
  add column if not exists item_unit_snapshot text,
  add column if not exists godown_name_snapshot text;

alter table public.consolidated_purchase_invoices
  add column if not exists supplier_name_snapshot text;

alter table public.consolidated_purchase_invoice_lines
  add column if not exists item_name_snapshot text,
  add column if not exists item_unit_snapshot text,
  add column if not exists godown_name_snapshot text;

create or replace function public.capture_sales_order_name_snapshots()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status = 'posted' then
    if new.customer_name_snapshot is null and new.customer_id is not null then
      select c.name into new.customer_name_snapshot
      from public.customers c
      where c.id = new.customer_id and c.company_id = new.company_id;
    end if;
    if new.salesperson_name_snapshot is null then
      select coalesce(e.name, nullif(btrim(new.sales_person), ''))
      into new.salesperson_name_snapshot
      from (select 1) seed
      left join public.employees e
        on e.id = new.salesperson_id and e.company_id = new.company_id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.capture_sales_order_line_name_snapshots()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status = 'posted' then
    update public.sales_order_lines line
    set item_name_snapshot = coalesce(line.item_name_snapshot, (select item.name from public.items item where item.id=line.item_id and item.company_id=new.company_id)),
        item_unit_snapshot = coalesce(line.item_unit_snapshot, (select item.unit from public.items item where item.id=line.item_id and item.company_id=new.company_id)),
        godown_name_snapshot = coalesce(line.godown_name_snapshot, (select godown.name from public.godowns godown where godown.id=line.godown_id and godown.company_id=new.company_id))
    where line.order_id = new.id
      and line.company_id = new.company_id;
  end if;
  return new;
end;
$$;

create or replace function public.capture_purchase_order_name_snapshots()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status = 'posted' then
    if new.supplier_name_snapshot is null and new.supplier_id is not null then
      select s.name into new.supplier_name_snapshot
      from public.suppliers s
      where s.id = new.supplier_id and s.company_id = new.company_id;
    end if;
    if new.purchase_person_name_snapshot is null then
      select coalesce(e.name, nullif(btrim(new.purchase_person), ''))
      into new.purchase_person_name_snapshot
      from (select 1) seed
      left join public.employees e
        on e.id = new.purchase_person_employee_id and e.company_id = new.company_id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.capture_purchase_order_line_name_snapshots()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status = 'posted' then
    update public.purchase_order_lines line
    set item_name_snapshot = coalesce(line.item_name_snapshot, (select item.name from public.items item where item.id=line.item_id and item.company_id=new.company_id)),
        item_unit_snapshot = coalesce(line.item_unit_snapshot, (select item.unit from public.items item where item.id=line.item_id and item.company_id=new.company_id)),
        godown_name_snapshot = coalesce(line.godown_name_snapshot, (select godown.name from public.godowns godown where godown.id=line.godown_id and godown.company_id=new.company_id))
    where line.order_id = new.id
      and line.company_id = new.company_id;
  end if;
  return new;
end;
$$;

create or replace function public.capture_consolidated_sales_name_snapshots()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status = 'posted' then
    if new.customer_name_snapshot is null and new.customer_id is not null then
      select c.name into new.customer_name_snapshot
      from public.customers c
      where c.id = new.customer_id and c.company_id = new.company_id;
    end if;
    update public.consolidated_sales_invoice_lines line
    set item_name_snapshot = coalesce(line.item_name_snapshot, (select item.name from public.items item where item.id=line.item_id and item.company_id=new.company_id)),
        item_unit_snapshot = coalesce(line.item_unit_snapshot, (select item.unit from public.items item where item.id=line.item_id and item.company_id=new.company_id)),
        godown_name_snapshot = coalesce(line.godown_name_snapshot, (select godown.name from public.godowns godown where godown.id=line.godown_id and godown.company_id=new.company_id))
    where line.invoice_id = new.id
      and line.company_id = new.company_id;
  end if;
  return new;
end;
$$;

create or replace function public.capture_consolidated_purchase_name_snapshots()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status = 'posted' then
    if new.supplier_name_snapshot is null and new.supplier_id is not null then
      select s.name into new.supplier_name_snapshot
      from public.suppliers s
      where s.id = new.supplier_id and s.company_id = new.company_id;
    end if;
    update public.consolidated_purchase_invoice_lines line
    set item_name_snapshot = coalesce(line.item_name_snapshot, (select item.name from public.items item where item.id=line.item_id and item.company_id=new.company_id)),
        item_unit_snapshot = coalesce(line.item_unit_snapshot, (select item.unit from public.items item where item.id=line.item_id and item.company_id=new.company_id)),
        godown_name_snapshot = coalesce(line.godown_name_snapshot, (select godown.name from public.godowns godown where godown.id=line.godown_id and godown.company_id=new.company_id))
    where line.invoice_id = new.id
      and line.company_id = new.company_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_order_capture_name_snapshots on public.sales_orders;
create trigger sales_order_capture_name_snapshots
before insert or update of status on public.sales_orders
for each row execute function public.capture_sales_order_name_snapshots();

drop trigger if exists sales_order_line_capture_name_snapshots on public.sales_orders;
create trigger sales_order_line_capture_name_snapshots
after insert or update of status on public.sales_orders
for each row execute function public.capture_sales_order_line_name_snapshots();

drop trigger if exists purchase_order_capture_name_snapshots on public.purchase_orders;
create trigger purchase_order_capture_name_snapshots
before insert or update of status on public.purchase_orders
for each row execute function public.capture_purchase_order_name_snapshots();

drop trigger if exists purchase_order_line_capture_name_snapshots on public.purchase_orders;
create trigger purchase_order_line_capture_name_snapshots
after insert or update of status on public.purchase_orders
for each row execute function public.capture_purchase_order_line_name_snapshots();

drop trigger if exists consolidated_sales_capture_name_snapshots on public.consolidated_sales_invoices;
create trigger consolidated_sales_capture_name_snapshots
before insert or update of status on public.consolidated_sales_invoices
for each row execute function public.capture_consolidated_sales_name_snapshots();

drop trigger if exists consolidated_purchase_capture_name_snapshots on public.consolidated_purchase_invoices;
create trigger consolidated_purchase_capture_name_snapshots
before insert or update of status on public.consolidated_purchase_invoices
for each row execute function public.capture_consolidated_purchase_name_snapshots();

-- Existing posted documents receive a best-effort baseline from the names that
-- exist today. Future master edits cannot change these captured values.
-- The migration runner has no tenant session. Temporarily bypass row triggers
-- only for this controlled baseline, then restore normal trigger execution.
set local session_replication_role = replica;

update public.sales_orders so
set customer_name_snapshot = coalesce(so.customer_name_snapshot, (select c.name from public.customers c where c.id=so.customer_id and c.company_id=so.company_id)),
    salesperson_name_snapshot = coalesce(so.salesperson_name_snapshot, (select e.name from public.employees e where e.id=so.salesperson_id and e.company_id=so.company_id), nullif(btrim(so.sales_person), ''))
where so.status = 'posted';

update public.sales_order_lines line
set item_name_snapshot = coalesce(line.item_name_snapshot, (select item.name from public.items item where item.id=line.item_id and item.company_id=line.company_id)),
    item_unit_snapshot = coalesce(line.item_unit_snapshot, (select item.unit from public.items item where item.id=line.item_id and item.company_id=line.company_id)),
    godown_name_snapshot = coalesce(line.godown_name_snapshot, (select godown.name from public.godowns godown where godown.id=line.godown_id and godown.company_id=line.company_id))
where exists (select 1 from public.sales_orders so where so.id=line.order_id and so.company_id=line.company_id and so.status='posted');

update public.purchase_orders po
set supplier_name_snapshot = coalesce(po.supplier_name_snapshot, (select s.name from public.suppliers s where s.id=po.supplier_id and s.company_id=po.company_id)),
    purchase_person_name_snapshot = coalesce(po.purchase_person_name_snapshot, (select e.name from public.employees e where e.id=po.purchase_person_employee_id and e.company_id=po.company_id), nullif(btrim(po.purchase_person), ''))
where po.status = 'posted';

update public.purchase_order_lines line
set item_name_snapshot = coalesce(line.item_name_snapshot, (select item.name from public.items item where item.id=line.item_id and item.company_id=line.company_id)),
    item_unit_snapshot = coalesce(line.item_unit_snapshot, (select item.unit from public.items item where item.id=line.item_id and item.company_id=line.company_id)),
    godown_name_snapshot = coalesce(line.godown_name_snapshot, (select godown.name from public.godowns godown where godown.id=line.godown_id and godown.company_id=line.company_id))
where exists (select 1 from public.purchase_orders po where po.id=line.order_id and po.company_id=line.company_id and po.status='posted');

update public.consolidated_sales_invoices invoice
set customer_name_snapshot = coalesce(invoice.customer_name_snapshot, customer.name)
from public.customers customer
where invoice.status = 'posted'
  and customer.id = invoice.customer_id
  and customer.company_id = invoice.company_id;

update public.consolidated_sales_invoice_lines line
set item_name_snapshot = coalesce(line.item_name_snapshot, (select item.name from public.items item where item.id=line.item_id and item.company_id=line.company_id)),
    item_unit_snapshot = coalesce(line.item_unit_snapshot, (select item.unit from public.items item where item.id=line.item_id and item.company_id=line.company_id)),
    godown_name_snapshot = coalesce(line.godown_name_snapshot, (select godown.name from public.godowns godown where godown.id=line.godown_id and godown.company_id=line.company_id))
where exists (select 1 from public.consolidated_sales_invoices invoice where invoice.id=line.invoice_id and invoice.company_id=line.company_id and invoice.status='posted');

update public.consolidated_purchase_invoices invoice
set supplier_name_snapshot = coalesce(invoice.supplier_name_snapshot, supplier.name)
from public.suppliers supplier
where invoice.status = 'posted'
  and supplier.id = invoice.supplier_id
  and supplier.company_id = invoice.company_id;

update public.consolidated_purchase_invoice_lines line
set item_name_snapshot = coalesce(line.item_name_snapshot, (select item.name from public.items item where item.id=line.item_id and item.company_id=line.company_id)),
    item_unit_snapshot = coalesce(line.item_unit_snapshot, (select item.unit from public.items item where item.id=line.item_id and item.company_id=line.company_id)),
    godown_name_snapshot = coalesce(line.godown_name_snapshot, (select godown.name from public.godowns godown where godown.id=line.godown_id and godown.company_id=line.company_id))
where exists (select 1 from public.consolidated_purchase_invoices invoice where invoice.id=line.invoice_id and invoice.company_id=line.company_id and invoice.status='posted');

set local session_replication_role = origin;

-- Keep the existing view contracts while changing only their displayed names.
-- CREATE OR REPLACE preserves dependent objects and existing grants.
do $$
declare
  v_name text;
  v_definition text;
begin
  for v_name in
    select unnest(array[
      'customer_invoice_aging',
      'sales_register_report',
      'sales_margin_report',
      'salesperson_business_performance_report',
      'salesperson_party_performance_report',
      'salesperson_performance_report',
      'purchase_register_report',
      'purchaseperson_business_performance_report',
      'supplier_invoice_aging'
    ])
  loop
    select pg_get_viewdef(format('public.%I', v_name)::regclass, true)
      into v_definition;

    if v_name in ('customer_invoice_aging','sales_register_report','sales_margin_report','salesperson_business_performance_report','salesperson_party_performance_report','salesperson_performance_report') then
      v_definition := replace(v_definition, 'c.name AS customer_name', 'COALESCE(so.customer_name_snapshot, c.name) AS customer_name');
      v_definition := replace(v_definition, 'c.name;', 'COALESCE(so.customer_name_snapshot, c.name);');
    end if;

    if v_name = 'salesperson_business_performance_report' then
      v_definition := replace(v_definition, 'e.name AS sales_person', 'COALESCE(so.salesperson_name_snapshot, e.name, so.sales_person) AS sales_person');
    end if;

    if v_name in ('purchase_register_report','purchaseperson_business_performance_report','supplier_invoice_aging') then
      v_definition := replace(v_definition, 's.name AS supplier_name', 'COALESCE(po.supplier_name_snapshot, s.name) AS supplier_name');
    end if;

    if v_name = 'purchaseperson_business_performance_report' then
      v_definition := replace(v_definition, 'COALESCE(e.name, po.purchase_person) AS purchase_person', 'COALESCE(po.purchase_person_name_snapshot, e.name, po.purchase_person) AS purchase_person');
    end if;

    execute format(
      'create or replace view public.%I with (security_invoker=true) as %s',
      v_name,
      regexp_replace(v_definition, ';\\s*$', '')
    );
  end loop;
end;
$$;

create or replace view public.customer_item_history_report
with (security_invoker=true)
as
select so.user_id, so.company_id, so.business_unit_id, so.operating_location_id,
       so.customer_id, coalesce(so.customer_name_snapshot,c.name) as customer_name,
       so.id as sales_order_id, so.order_no, so.order_date, sol.item_id,
       coalesce(sol.item_name_snapshot,i.name) as item_name,
       i.sku, i.size, coalesce(sol.item_unit_snapshot,i.unit) as unit,
       coalesce(sol.qty,0) as qty, coalesce(sol.unit_price,0) as rate,
       coalesce(sol.line_total,0) as line_total,
       coalesce(sol.cogs_total,coalesce(sol.unit_cost_at_posting,0)*coalesce(sol.qty,0),0) as cost_total
from public.sales_orders so
join public.sales_order_lines sol on sol.order_id=so.id and sol.company_id=so.company_id
left join public.customers c on c.id=so.customer_id and c.company_id=so.company_id
left join public.items i on i.id=sol.item_id and i.company_id=so.company_id
where so.status='posted'
union all
select so.user_id, so.company_id, so.business_unit_id, so.operating_location_id,
       so.customer_id, coalesce(so.customer_name_snapshot,c.name) as customer_name,
       so.id as sales_order_id, so.order_no, so.order_date, hl.item_id,
       coalesce(hl.item_name_snapshot,i.name) as item_name,
       i.sku, i.size, coalesce(hl.item_unit_snapshot,i.unit) as unit,
       coalesce(hl.qty,0) as qty, coalesce(hl.unit_price,0) as rate,
       coalesce(hl.line_total,0) as line_total,
       coalesce(hl.cogs_total,coalesce(hl.unit_cost_at_posting,0)*coalesce(hl.qty,0),0) as cost_total
from public.sales_orders so
join public.sales_order_hawala_invoices link
  on link.sales_order_id=so.id and link.company_id=so.company_id
  and link.business_unit_id is not distinct from so.business_unit_id
join public.consolidated_sales_invoices invoice
  on invoice.id=link.hawala_invoice_id and invoice.company_id=so.company_id
join public.consolidated_sales_invoice_lines hl
  on hl.invoice_id=invoice.id and hl.company_id=invoice.company_id
left join public.customers c on c.id=so.customer_id and c.company_id=so.company_id
left join public.items i on i.id=hl.item_id and i.company_id=so.company_id
where so.status='posted';

create or replace view public.supplier_item_history_report
with (security_invoker=true)
as
select po.user_id, po.company_id, po.business_unit_id, po.operating_location_id,
       po.supplier_id, coalesce(po.supplier_name_snapshot,s.name) as supplier_name,
       po.id as purchase_order_id, po.order_no, po.order_date, pol.item_id,
       coalesce(pol.item_name_snapshot,i.name) as item_name,
       i.sku, i.size, coalesce(pol.item_unit_snapshot,i.unit) as unit,
       coalesce(pol.qty,0) as qty, coalesce(pol.unit_cost,0) as rate,
       coalesce(pol.line_total,0) as line_total
from public.purchase_orders po
join public.purchase_order_lines pol on pol.order_id=po.id and pol.company_id=po.company_id
left join public.suppliers s on s.id=po.supplier_id and s.company_id=po.company_id
left join public.items i on i.id=pol.item_id and i.company_id=po.company_id
where po.status='posted';

-- Company language choices must come from verified, owner-enabled packs.
-- English is the safe built-in pack and remains available without a row.
create or replace function public.save_company_language_settings(
  p_screen_mode text,
  p_screen_primary text,
  p_screen_secondary text,
  p_document_mode text,
  p_document_primary text,
  p_document_secondary text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_print_language text;
  v_supported constant text[] := array['en','ur','ar','hi','bn','fa','tr','fr','es','de','pt','ru','zh','id','ms'];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_company is null then raise exception 'No active company selected'; end if;
  if not public.has_module_permission(v_company,'settings','edit') then raise exception 'Permission denied'; end if;
  if p_screen_mode not in ('single','bilingual') or p_document_mode not in ('single','bilingual') then
    raise exception 'Invalid language mode';
  end if;
  if not (p_screen_primary = any(v_supported)) or not (p_document_primary = any(v_supported)) then
    raise exception 'Unsupported language';
  end if;
  if p_screen_mode='bilingual' and (p_screen_secondary is null or p_screen_secondary=p_screen_primary or not (p_screen_secondary=any(v_supported))) then
    raise exception 'Bilingual screen mode requires two different supported languages';
  end if;
  if p_document_mode='bilingual' and (p_document_secondary is null or p_document_secondary=p_document_primary or not (p_document_secondary=any(v_supported))) then
    raise exception 'Bilingual document mode requires two different supported languages';
  end if;

  if exists (
    select 1 from unnest(array[p_screen_primary, case when p_screen_mode='bilingual' then p_screen_secondary else null end,
                                     p_document_primary, case when p_document_mode='bilingual' then p_document_secondary else null end]) code
    where code is not null and code <> 'en'
      and not exists (
        select 1 from public.company_language_entitlements entitlement
        where entitlement.company_id=v_company and entitlement.language_code=code
          and entitlement.enabled and entitlement.is_verified
      )
  ) then
    raise exception 'A selected language pack is not verified and enabled for this company';
  end if;

  v_print_language := case
    when p_document_mode='bilingual' and array[p_document_primary,p_document_secondary] @> array['en','ur'] then 'both'
    when p_document_mode='single' and p_document_primary='ur' then 'urdu'
    else 'english'
  end;

  update public.company_settings
  set screen_language_mode=p_screen_mode,
      screen_primary_language=p_screen_primary,
      screen_secondary_language=case when p_screen_mode='bilingual' then p_screen_secondary else null end,
      document_language_mode=p_document_mode,
      document_primary_language=p_document_primary,
      document_secondary_language=case when p_document_mode='bilingual' then p_document_secondary else null end,
      print_language=v_print_language,
      updated_at=now()
  where company_id=v_company;
  if not found then raise exception 'Company settings not found'; end if;

  return jsonb_build_object(
    'company_id',v_company,'screen_mode',p_screen_mode,'screen_primary',p_screen_primary,
    'screen_secondary',case when p_screen_mode='bilingual' then p_screen_secondary else null end,
    'document_mode',p_document_mode,'document_primary',p_document_primary,
    'document_secondary',case when p_document_mode='bilingual' then p_document_secondary else null end
  );
end;
$$;

create or replace function public.validate_user_language_preference()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company uuid;
  v_code text;
begin
  if auth.uid() is null or new.use_company_default then return new; end if;
  if new.user_id <> auth.uid() then raise exception 'A user may only change their own language preference'; end if;
  v_company := public.current_company_id();
  if v_company is null then raise exception 'No active company selected'; end if;
  if new.screen_language_mode not in ('single','bilingual') then raise exception 'Invalid language mode'; end if;
  if new.screen_language_mode='bilingual' and (new.secondary_language is null or new.secondary_language=new.primary_language) then
    raise exception 'Bilingual mode requires two different languages';
  end if;
  foreach v_code in array array[new.primary_language, case when new.screen_language_mode='bilingual' then new.secondary_language else null end]
  loop
    if v_code is null then continue; end if;
    if v_code <> 'en' and not exists (
      select 1 from public.company_language_entitlements entitlement
      where entitlement.company_id=v_company and entitlement.language_code=v_code
        and entitlement.enabled and entitlement.is_verified
    ) then
      raise exception 'The selected language pack is not verified and enabled for this company';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists validate_user_language_preference on public.user_language_preferences;
create trigger validate_user_language_preference
before insert or update on public.user_language_preferences
for each row execute function public.validate_user_language_preference();

revoke all on function public.save_company_language_settings(text,text,text,text,text,text) from public, anon;
grant execute on function public.save_company_language_settings(text,text,text,text,text,text) to authenticated;
revoke all on function public.validate_user_language_preference() from public, anon, authenticated;

-- Trigger functions are internal implementation details, not RPC endpoints.
revoke all on function public.capture_sales_order_name_snapshots() from public, anon, authenticated;
revoke all on function public.capture_sales_order_line_name_snapshots() from public, anon, authenticated;
revoke all on function public.capture_purchase_order_name_snapshots() from public, anon, authenticated;
revoke all on function public.capture_purchase_order_line_name_snapshots() from public, anon, authenticated;
revoke all on function public.capture_consolidated_sales_name_snapshots() from public, anon, authenticated;
revoke all on function public.capture_consolidated_purchase_name_snapshots() from public, anon, authenticated;
