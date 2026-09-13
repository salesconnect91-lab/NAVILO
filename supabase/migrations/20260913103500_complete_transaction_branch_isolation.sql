select set_config('app.maintenance_reset','1',true);

create or replace function public.propagate_operating_location_from_parent()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_parent_id uuid; v_location uuid;
begin
  if current_setting('app.maintenance_reset',true)='1' then return new; end if;
  v_parent_id:=nullif(to_jsonb(new)->>tg_argv[1],'')::uuid;
  if v_parent_id is null then raise exception 'Parent record is required for branch-scoped child row.'; end if;
  execute format('select operating_location_id from public.%I where id=$1',tg_argv[0]) into v_location using v_parent_id;
  if not found then raise exception 'Parent record not found for branch-scoped child row.'; end if;
  if v_location is null then raise exception 'Parent transaction has no active branch/location.'; end if;
  new.operating_location_id:=v_location;
  return new;
end $$;
revoke all on function public.propagate_operating_location_from_parent() from public,anon,authenticated;
grant execute on function public.propagate_operating_location_from_parent() to service_role;

create or replace function public.stamp_return_note_operating_location()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_location uuid;
begin
  if current_setting('app.maintenance_reset',true)='1' then return new; end if;
  if new.sales_order_id is not null then select operating_location_id into v_location from public.sales_orders where id=new.sales_order_id and company_id=new.company_id and business_unit_id=new.business_unit_id;
  elsif new.purchase_order_id is not null then select operating_location_id into v_location from public.purchase_orders where id=new.purchase_order_id and company_id=new.company_id and business_unit_id=new.business_unit_id;
  else v_location:=coalesce(new.operating_location_id,public.current_operating_location_id()); end if;
  if v_location is null then raise exception 'Active branch/location is required for return note.'; end if;
  new.operating_location_id:=v_location; return new;
end $$;
revoke all on function public.stamp_return_note_operating_location() from public,anon,authenticated;
grant execute on function public.stamp_return_note_operating_location() to service_role;

alter table public.sales_order_lines add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.purchase_order_lines add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.consolidated_sales_invoices add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.consolidated_sales_invoice_lines add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.consolidated_sales_invoice_charges add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.consolidated_purchase_invoices add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.consolidated_purchase_invoice_lines add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.consolidated_purchase_invoice_charges add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.return_notes add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.return_note_lines add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.gate_pass_lines add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.purchase_order_consolidated_invoices add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.sales_order_hawala_invoices add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.sales_consolidations add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.sales_consolidation_invoices add column if not exists operating_location_id uuid references public.operating_locations(id);

update public.sales_order_lines l set operating_location_id=o.operating_location_id from public.sales_orders o where l.order_id=o.id and l.operating_location_id is distinct from o.operating_location_id;
update public.purchase_order_lines l set operating_location_id=o.operating_location_id from public.purchase_orders o where l.order_id=o.id and l.operating_location_id is distinct from o.operating_location_id;
update public.gate_pass_lines l set operating_location_id=p.operating_location_id from public.gate_passes p where l.gate_pass_id=p.id and l.operating_location_id is distinct from p.operating_location_id;
update public.return_notes r set operating_location_id=s.operating_location_id from public.sales_orders s where r.sales_order_id=s.id and r.operating_location_id is distinct from s.operating_location_id;
update public.return_notes r set operating_location_id=p.operating_location_id from public.purchase_orders p where r.purchase_order_id=p.id and r.operating_location_id is null;
update public.return_note_lines l set operating_location_id=r.operating_location_id from public.return_notes r where l.note_id=r.id and l.operating_location_id is distinct from r.operating_location_id;
update public.consolidated_sales_invoices c set operating_location_id=s.operating_location_id from public.sales_orders s where c.main_sales_order_id=s.id and c.operating_location_id is null;
update public.consolidated_sales_invoice_lines l set operating_location_id=c.operating_location_id from public.consolidated_sales_invoices c where l.invoice_id=c.id and l.operating_location_id is distinct from c.operating_location_id;
update public.consolidated_sales_invoice_charges l set operating_location_id=c.operating_location_id from public.consolidated_sales_invoices c where l.invoice_id=c.id and l.operating_location_id is distinct from c.operating_location_id;
update public.consolidated_purchase_invoices c set operating_location_id=p.operating_location_id from public.purchase_order_consolidated_invoices x join public.purchase_orders p on p.id=x.purchase_order_id where x.consolidated_invoice_id=c.id and c.operating_location_id is null;
update public.consolidated_purchase_invoice_lines l set operating_location_id=c.operating_location_id from public.consolidated_purchase_invoices c where l.invoice_id=c.id and l.operating_location_id is distinct from c.operating_location_id;
update public.consolidated_purchase_invoice_charges l set operating_location_id=c.operating_location_id from public.consolidated_purchase_invoices c where l.invoice_id=c.id and l.operating_location_id is distinct from c.operating_location_id;
update public.purchase_order_consolidated_invoices x set operating_location_id=p.operating_location_id from public.purchase_orders p where x.purchase_order_id=p.id and x.operating_location_id is distinct from p.operating_location_id;
update public.sales_order_hawala_invoices x set operating_location_id=s.operating_location_id from public.sales_orders s where x.sales_order_id=s.id and x.operating_location_id is distinct from s.operating_location_id;
update public.sales_consolidation_invoices x set operating_location_id=s.operating_location_id from public.sales_orders s where x.sales_order_id=s.id and x.operating_location_id is distinct from s.operating_location_id;
update public.sales_consolidations c set operating_location_id=x.operating_location_id from public.sales_consolidation_invoices x where x.consolidation_id=c.id and c.operating_location_id is null;

select set_config('app.maintenance_reset','0',true);

drop trigger if exists zz_operating_location_scope on public.consolidated_sales_invoices;
create trigger zz_operating_location_scope before insert or update on public.consolidated_sales_invoices for each row execute function public.stamp_operating_location_context();
drop trigger if exists zz_operating_location_scope on public.consolidated_purchase_invoices;
create trigger zz_operating_location_scope before insert or update on public.consolidated_purchase_invoices for each row execute function public.stamp_operating_location_context();
drop trigger if exists zz_operating_location_scope on public.sales_consolidations;
create trigger zz_operating_location_scope before insert or update on public.sales_consolidations for each row execute function public.stamp_operating_location_context();
drop trigger if exists zz_operating_location_scope on public.return_notes;
create trigger zz_operating_location_scope before insert or update on public.return_notes for each row execute function public.stamp_return_note_operating_location();

drop trigger if exists aaa_location_from_parent on public.sales_order_lines;
create trigger aaa_location_from_parent before insert or update on public.sales_order_lines for each row execute function public.propagate_operating_location_from_parent('sales_orders','order_id');
drop trigger if exists aaa_location_from_parent on public.purchase_order_lines;
create trigger aaa_location_from_parent before insert or update on public.purchase_order_lines for each row execute function public.propagate_operating_location_from_parent('purchase_orders','order_id');
drop trigger if exists aaa_location_from_parent on public.consolidated_sales_invoice_lines;
create trigger aaa_location_from_parent before insert or update on public.consolidated_sales_invoice_lines for each row execute function public.propagate_operating_location_from_parent('consolidated_sales_invoices','invoice_id');
drop trigger if exists aaa_location_from_parent on public.consolidated_sales_invoice_charges;
create trigger aaa_location_from_parent before insert or update on public.consolidated_sales_invoice_charges for each row execute function public.propagate_operating_location_from_parent('consolidated_sales_invoices','invoice_id');
drop trigger if exists aaa_location_from_parent on public.consolidated_purchase_invoice_lines;
create trigger aaa_location_from_parent before insert or update on public.consolidated_purchase_invoice_lines for each row execute function public.propagate_operating_location_from_parent('consolidated_purchase_invoices','invoice_id');
drop trigger if exists aaa_location_from_parent on public.consolidated_purchase_invoice_charges;
create trigger aaa_location_from_parent before insert or update on public.consolidated_purchase_invoice_charges for each row execute function public.propagate_operating_location_from_parent('consolidated_purchase_invoices','invoice_id');
drop trigger if exists aaa_location_from_parent on public.return_note_lines;
create trigger aaa_location_from_parent before insert or update on public.return_note_lines for each row execute function public.propagate_operating_location_from_parent('return_notes','note_id');
drop trigger if exists aaa_location_from_parent on public.gate_pass_lines;
create trigger aaa_location_from_parent before insert or update on public.gate_pass_lines for each row execute function public.propagate_operating_location_from_parent('gate_passes','gate_pass_id');
drop trigger if exists aaa_location_from_parent on public.purchase_order_consolidated_invoices;
create trigger aaa_location_from_parent before insert or update on public.purchase_order_consolidated_invoices for each row execute function public.propagate_operating_location_from_parent('purchase_orders','purchase_order_id');
drop trigger if exists aaa_location_from_parent on public.sales_order_hawala_invoices;
create trigger aaa_location_from_parent before insert or update on public.sales_order_hawala_invoices for each row execute function public.propagate_operating_location_from_parent('sales_orders','sales_order_id');
drop trigger if exists aaa_location_from_parent on public.sales_consolidation_invoices;
create trigger aaa_location_from_parent before insert or update on public.sales_consolidation_invoices for each row execute function public.propagate_operating_location_from_parent('sales_orders','sales_order_id');

do $$ declare t text; begin
foreach t in array array['sales_order_lines','purchase_order_lines','consolidated_sales_invoices','consolidated_sales_invoice_lines','consolidated_sales_invoice_charges','consolidated_purchase_invoices','consolidated_purchase_invoice_lines','consolidated_purchase_invoice_charges','return_notes','return_note_lines','gate_pass_lines','purchase_order_consolidated_invoices','sales_order_hawala_invoices','sales_consolidations','sales_consolidation_invoices'] loop
 execute format('drop policy if exists operating_location_scope on public.%I',t);
 execute format('create policy operating_location_scope on public.%I as restrictive for all to authenticated using (((public.current_operating_location_id() is null) and (operating_location_id is null)) or operating_location_id=public.current_operating_location_id()) with check (((public.current_operating_location_id() is null) and (operating_location_id is null)) or operating_location_id=public.current_operating_location_id())',t);
 execute format('create index if not exists %I on public.%I(company_id,business_unit_id,operating_location_id)','idx_'||t||'_tenant_location',t);
end loop; end $$;
