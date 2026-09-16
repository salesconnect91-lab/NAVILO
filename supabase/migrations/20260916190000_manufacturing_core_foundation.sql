-- Manufacturing Core foundation. Additive: existing work orders and production history remain intact.

create table if not exists public.work_centers (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete restrict, operating_location_id uuid references public.operating_locations(id) on delete restrict,
  code text not null, name text not null, center_type text not null default 'production', capacity_per_hour numeric(18,4) not null default 0 check(capacity_per_hour>=0),
  hourly_rate numeric(18,4) not null default 0 check(hourly_rate>=0), is_active boolean not null default true,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,business_unit_id,code)
);

create table if not exists public.bom_versions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete restrict, finished_item_id uuid not null references public.items(id) on delete restrict,
  version_no integer not null check(version_no>0), status text not null default 'draft' check(status in('draft','approved','obsolete')),
  output_qty numeric(18,4) not null default 1 check(output_qty>0), effective_from date, effective_to date,
  notes text, created_by uuid default auth.uid(), approved_by uuid, approved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,business_unit_id,finished_item_id,version_no), check(effective_to is null or effective_from is null or effective_to>=effective_from)
);

create unique index if not exists uq_bom_one_approved on public.bom_versions(company_id,business_unit_id,finished_item_id) where status='approved';

create table if not exists public.bom_lines (
  id uuid primary key default gen_random_uuid(), bom_version_id uuid not null references public.bom_versions(id) on delete cascade,
  line_no integer not null check(line_no>0), item_id uuid not null references public.items(id) on delete restrict,
  line_type text not null default 'component' check(line_type in('component','byproduct','scrap')),
  quantity numeric(18,4) not null check(quantity>0), scrap_pct numeric(8,4) not null default 0 check(scrap_pct between 0 and 100),
  is_critical boolean not null default false, notes text, unique(bom_version_id,line_no)
);

create table if not exists public.routing_operations (
  id uuid primary key default gen_random_uuid(), bom_version_id uuid not null references public.bom_versions(id) on delete cascade,
  sequence_no integer not null check(sequence_no>0), work_center_id uuid not null references public.work_centers(id) on delete restrict,
  operation_name text not null, setup_minutes numeric(18,4) not null default 0 check(setup_minutes>=0), run_minutes_per_unit numeric(18,4) not null default 0 check(run_minutes_per_unit>=0),
  yield_pct numeric(8,4) not null default 100 check(yield_pct>0 and yield_pct<=100), qc_required boolean not null default false, instructions text,
  unique(bom_version_id,sequence_no)
);

alter table public.work_orders add column if not exists bom_version_id uuid references public.bom_versions(id) on delete restrict;
alter table public.work_orders add column if not exists planned_start_at timestamptz;
alter table public.work_orders add column if not exists planned_end_at timestamptz;

create table if not exists public.production_material_requirements (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete restrict, work_order_id uuid not null references public.work_orders(id) on delete cascade,
  bom_line_id uuid references public.bom_lines(id) on delete restrict, item_id uuid not null references public.items(id) on delete restrict,
  required_qty numeric(18,4) not null check(required_qty>=0), reserved_qty numeric(18,4) not null default 0 check(reserved_qty>=0), issued_qty numeric(18,4) not null default 0 check(issued_qty>=0),
  warehouse_id uuid references public.warehouses(id) on delete restrict, required_at timestamptz, status text not null default 'planned' check(status in('planned','reserved','part_issued','issued','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(reserved_qty<=required_qty), check(issued_qty<=required_qty)
);

create table if not exists public.production_operations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete restrict, work_order_id uuid not null references public.work_orders(id) on delete cascade,
  routing_operation_id uuid references public.routing_operations(id) on delete restrict, sequence_no integer not null check(sequence_no>0), work_center_id uuid not null references public.work_centers(id) on delete restrict,
  status text not null default 'pending' check(status in('pending','ready','running','paused','completed','cancelled')),
  planned_minutes numeric(18,4) not null default 0 check(planned_minutes>=0), actual_minutes numeric(18,4) not null default 0 check(actual_minutes>=0),
  started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(work_order_id,sequence_no)
);

create table if not exists public.production_outputs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete restrict, work_order_id uuid not null references public.work_orders(id) on delete cascade,
  production_operation_id uuid references public.production_operations(id) on delete restrict, item_id uuid not null references public.items(id) on delete restrict,
  output_type text not null default 'finished_good' check(output_type in('finished_good','byproduct','scrap','rework')),
  quantity numeric(18,4) not null check(quantity>0), accepted_qty numeric(18,4) not null default 0 check(accepted_qty>=0), rejected_qty numeric(18,4) not null default 0 check(rejected_qty>=0),
  produced_at timestamptz not null default now(), recorded_by uuid default auth.uid(), check(accepted_qty+rejected_qty<=quantity)
);

create table if not exists public.quality_inspections (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete restrict, work_order_id uuid references public.work_orders(id) on delete cascade,
  production_output_id uuid references public.production_outputs(id) on delete cascade, item_id uuid not null references public.items(id) on delete restrict,
  inspection_no text not null, status text not null default 'pending' check(status in('pending','hold','passed','failed','released')),
  inspected_qty numeric(18,4) not null default 0 check(inspected_qty>=0), accepted_qty numeric(18,4) not null default 0 check(accepted_qty>=0), rejected_qty numeric(18,4) not null default 0 check(rejected_qty>=0),
  results jsonb not null default '{}'::jsonb, remarks text, inspected_by uuid, inspected_at timestamptz, released_by uuid, released_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,business_unit_id,inspection_no), check(accepted_qty+rejected_qty<=inspected_qty)
);

create table if not exists public.maintenance_assets (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete restrict, operating_location_id uuid references public.operating_locations(id) on delete restrict,
  work_center_id uuid references public.work_centers(id) on delete set null, asset_code text not null, asset_name text not null,
  status text not null default 'active' check(status in('active','maintenance','breakdown','retired')), commissioned_on date, next_service_on date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,business_unit_id,asset_code)
);

create table if not exists public.maintenance_work_orders (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete restrict, asset_id uuid not null references public.maintenance_assets(id) on delete restrict,
  maintenance_no text not null, maintenance_type text not null check(maintenance_type in('preventive','corrective','breakdown','inspection')),
  priority text not null default 'normal' check(priority in('low','normal','high','critical')), status text not null default 'open' check(status in('open','planned','in_progress','completed','cancelled')),
  planned_at timestamptz, started_at timestamptz, completed_at timestamptz, description text, resolution text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,business_unit_id,maintenance_no)
);

create table if not exists public.downtime_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete restrict, asset_id uuid references public.maintenance_assets(id) on delete restrict,
  work_center_id uuid references public.work_centers(id) on delete restrict, work_order_id uuid references public.work_orders(id) on delete set null,
  reason_code text not null, started_at timestamptz not null, ended_at timestamptz, notes text, created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  check(ended_at is null or ended_at>=started_at)
);

create table if not exists public.production_cost_snapshots (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete restrict, work_order_id uuid not null references public.work_orders(id) on delete cascade,
  snapshot_type text not null check(snapshot_type in('standard','actual','close')),
  material_cost numeric(18,4) not null default 0, labor_cost numeric(18,4) not null default 0, overhead_cost numeric(18,4) not null default 0,
  total_cost numeric(18,4) generated always as (material_cost+labor_cost+overhead_cost) stored,
  captured_at timestamptz not null default now(), captured_by uuid default auth.uid(), unique(work_order_id,snapshot_type)
);

do $$ declare t text; begin foreach t in array array['work_centers','bom_versions','production_material_requirements','production_operations','production_outputs','quality_inspections','maintenance_assets','maintenance_work_orders','downtime_events','production_cost_snapshots'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('drop policy if exists %I on public.%I','manufacturing_read_'||t,t);
  execute format('create policy %I on public.%I for select to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''production'',''view''))','manufacturing_read_'||t,t);
  execute format('drop policy if exists %I on public.%I','manufacturing_create_'||t,t);
  execute format('create policy %I on public.%I for insert to authenticated with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''production'',''create''))','manufacturing_create_'||t,t);
  execute format('drop policy if exists %I on public.%I','manufacturing_edit_'||t,t);
  execute format('create policy %I on public.%I for update to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''production'',''edit'')) with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''production'',''edit''))','manufacturing_edit_'||t,t);
  execute format('drop policy if exists %I on public.%I','manufacturing_delete_'||t,t);
  execute format('create policy %I on public.%I for delete to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''production'',''delete''))','manufacturing_delete_'||t,t);
  execute format('revoke all on public.%I from anon',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
end loop; end $$;

alter table public.bom_lines enable row level security;
alter table public.routing_operations enable row level security;
create policy manufacturing_read_bom_lines on public.bom_lines for select to authenticated using(exists(select 1 from public.bom_versions b where b.id=bom_version_id and b.company_id=public.current_company_id() and b.business_unit_id=public.current_business_unit_id() and public.has_module_permission(b.company_id,'production','view')));
create policy manufacturing_write_bom_lines on public.bom_lines for all to authenticated using(exists(select 1 from public.bom_versions b where b.id=bom_version_id and b.company_id=public.current_company_id() and b.business_unit_id=public.current_business_unit_id() and b.status='draft' and public.has_module_permission(b.company_id,'production','edit'))) with check(exists(select 1 from public.bom_versions b where b.id=bom_version_id and b.company_id=public.current_company_id() and b.business_unit_id=public.current_business_unit_id() and b.status='draft' and (public.has_module_permission(b.company_id,'production','create') or public.has_module_permission(b.company_id,'production','edit'))));
create policy manufacturing_read_routing_operations on public.routing_operations for select to authenticated using(exists(select 1 from public.bom_versions b where b.id=bom_version_id and b.company_id=public.current_company_id() and b.business_unit_id=public.current_business_unit_id() and public.has_module_permission(b.company_id,'production','view')));
create policy manufacturing_write_routing_operations on public.routing_operations for all to authenticated using(exists(select 1 from public.bom_versions b where b.id=bom_version_id and b.company_id=public.current_company_id() and b.business_unit_id=public.current_business_unit_id() and b.status='draft' and public.has_module_permission(b.company_id,'production','edit'))) with check(exists(select 1 from public.bom_versions b where b.id=bom_version_id and b.company_id=public.current_company_id() and b.business_unit_id=public.current_business_unit_id() and b.status='draft' and (public.has_module_permission(b.company_id,'production','create') or public.has_module_permission(b.company_id,'production','edit'))));
revoke all on public.bom_lines,public.routing_operations from anon;
grant select,insert,update,delete on public.bom_lines,public.routing_operations to authenticated;

create index if not exists idx_bom_versions_scope on public.bom_versions(company_id,business_unit_id,finished_item_id,status);
create index if not exists idx_material_requirements_work_order on public.production_material_requirements(work_order_id,item_id);
create index if not exists idx_production_operations_work_order on public.production_operations(work_order_id,status);
create index if not exists idx_quality_inspections_work_order on public.quality_inspections(work_order_id,status);
create index if not exists idx_maintenance_work_orders_asset on public.maintenance_work_orders(asset_id,status);
create index if not exists idx_downtime_scope on public.downtime_events(company_id,business_unit_id,started_at desc);

create or replace view public.manufacturing_work_order_summary with (security_invoker=true) as
select w.id,w.company_id,w.business_unit_id,w.order_no,w.status,w.qty,w.item_id,i.name item_name,b.version_no,
 coalesce((select sum(r.required_qty) from public.production_material_requirements r where r.work_order_id=w.id),0) required_qty,
 coalesce((select sum(r.reserved_qty) from public.production_material_requirements r where r.work_order_id=w.id),0) reserved_qty,
 coalesce((select sum(o.quantity) from public.production_outputs o where o.work_order_id=w.id and o.output_type='finished_good'),0) output_qty,
 coalesce((select sum(o.rejected_qty) from public.production_outputs o where o.work_order_id=w.id),0) rejected_qty
from public.work_orders w left join public.items i on i.id=w.item_id left join public.bom_versions b on b.id=w.bom_version_id;
revoke all on public.manufacturing_work_order_summary from anon;
grant select on public.manufacturing_work_order_summary to authenticated;
