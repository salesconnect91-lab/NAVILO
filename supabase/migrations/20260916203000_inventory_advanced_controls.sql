-- Advanced inventory controls. Additive: existing warehouse_stock and stock_movements remain the posting ledger.

create table if not exists public.warehouse_bins (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete restrict, warehouse_id uuid not null references public.warehouses(id) on delete restrict,
 godown_id uuid not null references public.godowns(id) on delete restrict, bin_code text not null, bin_name text not null,
 zone text, capacity_qty numeric(18,4) check(capacity_qty is null or capacity_qty>=0), is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,business_unit_id,godown_id,bin_code)
);

create table if not exists public.inventory_lots (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete restrict, item_id uuid not null references public.items(id) on delete restrict,
 lot_no text not null, heat_no text, batch_no text, supplier_lot_no text, manufactured_on date, expires_on date,
 qc_status text not null default 'pending' check(qc_status in('pending','hold','released','rejected')),
 source_type text, source_id uuid, created_at timestamptz not null default now(), unique(company_id,business_unit_id,item_id,lot_no),
 check(expires_on is null or manufactured_on is null or expires_on>=manufactured_on)
);

create table if not exists public.inventory_lot_balances (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete restrict, item_id uuid not null references public.items(id) on delete restrict,
 lot_id uuid not null references public.inventory_lots(id) on delete restrict, warehouse_id uuid not null references public.warehouses(id) on delete restrict,
 godown_id uuid not null references public.godowns(id) on delete restrict, bin_id uuid references public.warehouse_bins(id) on delete restrict,
 on_hand_qty numeric(18,4) not null default 0 check(on_hand_qty>=0), reserved_qty numeric(18,4) not null default 0 check(reserved_qty>=0),
 updated_at timestamptz not null default now(), check(reserved_qty<=on_hand_qty)
);
create unique index if not exists uq_inventory_lot_balance_location on public.inventory_lot_balances(company_id,business_unit_id,item_id,lot_id,warehouse_id,godown_id,coalesce(bin_id,'00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.stock_reservations (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete restrict, item_id uuid not null references public.items(id) on delete restrict,
 warehouse_id uuid not null references public.warehouses(id) on delete restrict, godown_id uuid not null references public.godowns(id) on delete restrict,
 bin_id uuid references public.warehouse_bins(id) on delete restrict, lot_id uuid references public.inventory_lots(id) on delete restrict,
 source_type text not null, source_id uuid not null, reserved_qty numeric(18,4) not null check(reserved_qty>0),
 consumed_qty numeric(18,4) not null default 0 check(consumed_qty>=0), status text not null default 'active' check(status in('active','part_consumed','consumed','released','cancelled')),
 required_at timestamptz, created_by uuid default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(consumed_qty<=reserved_qty)
);

create table if not exists public.goods_receipt_inspections (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete restrict, inspection_no text not null,
 purchase_order_id uuid references public.purchase_orders(id) on delete restrict, purchase_order_line_id uuid references public.purchase_order_lines(id) on delete restrict,
 item_id uuid not null references public.items(id) on delete restrict, received_qty numeric(18,4) not null check(received_qty>0),
 accepted_qty numeric(18,4) not null default 0 check(accepted_qty>=0), rejected_qty numeric(18,4) not null default 0 check(rejected_qty>=0),
 hold_qty numeric(18,4) not null default 0 check(hold_qty>=0), status text not null default 'pending' check(status in('pending','inspecting','accepted','part_accepted','rejected','closed')),
 lot_id uuid references public.inventory_lots(id) on delete restrict, results jsonb not null default '{}'::jsonb, remarks text,
 inspected_by uuid, inspected_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,business_unit_id,inspection_no), check(accepted_qty+rejected_qty+hold_qty<=received_qty)
);

create table if not exists public.inventory_control_documents (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete restrict, document_no text not null,
 document_type text not null check(document_type in('material_issue','material_return','finished_goods_receipt','transfer')),
 document_date date not null default current_date, status text not null default 'draft' check(status in('draft','submitted','approved','in_transit','received','posted','cancelled')),
 work_order_id uuid references public.work_orders(id) on delete restrict, from_warehouse_id uuid references public.warehouses(id) on delete restrict,
 from_godown_id uuid references public.godowns(id) on delete restrict, to_warehouse_id uuid references public.warehouses(id) on delete restrict,
 to_godown_id uuid references public.godowns(id) on delete restrict, dispatched_at timestamptz, received_at timestamptz,
 reference text, remarks text, created_by uuid default auth.uid(), approved_by uuid, posted_by uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,business_unit_id,document_no)
);

create table if not exists public.inventory_control_document_lines (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete restrict, document_id uuid not null references public.inventory_control_documents(id) on delete cascade,
 line_no integer not null check(line_no>0), item_id uuid not null references public.items(id) on delete restrict,
 lot_id uuid references public.inventory_lots(id) on delete restrict, from_bin_id uuid references public.warehouse_bins(id) on delete restrict,
 to_bin_id uuid references public.warehouse_bins(id) on delete restrict, quantity numeric(18,4) not null check(quantity>0),
 unit_cost numeric(18,4) check(unit_cost is null or unit_cost>=0), production_material_requirement_id uuid references public.production_material_requirements(id) on delete restrict,
 production_output_id uuid references public.production_outputs(id) on delete restrict, unique(document_id,line_no)
);

create table if not exists public.inventory_reorder_rules (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete restrict, item_id uuid not null references public.items(id) on delete cascade,
 warehouse_id uuid not null references public.warehouses(id) on delete cascade, godown_id uuid references public.godowns(id) on delete cascade,
 minimum_qty numeric(18,4) not null default 0 check(minimum_qty>=0), reorder_qty numeric(18,4) not null default 0 check(reorder_qty>=0),
 maximum_qty numeric(18,4) check(maximum_qty is null or maximum_qty>=minimum_qty), lead_time_days integer not null default 0 check(lead_time_days>=0),
 is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists uq_inventory_reorder_scope on public.inventory_reorder_rules(company_id,business_unit_id,item_id,warehouse_id,coalesce(godown_id,'00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.stock_counts (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete restrict, count_no text not null,
 warehouse_id uuid not null references public.warehouses(id) on delete restrict, godown_id uuid references public.godowns(id) on delete restrict,
 count_date date not null default current_date, status text not null default 'draft' check(status in('draft','counting','submitted','approved','posted','cancelled')),
 freeze_movements boolean not null default false, notes text, created_by uuid default auth.uid(), approved_by uuid, approved_at timestamptz,
 posted_by uuid, posted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,business_unit_id,count_no)
);

create table if not exists public.stock_count_lines (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete restrict, stock_count_id uuid not null references public.stock_counts(id) on delete cascade,
 item_id uuid not null references public.items(id) on delete restrict, lot_id uuid references public.inventory_lots(id) on delete restrict,
 bin_id uuid references public.warehouse_bins(id) on delete restrict, system_qty numeric(18,4) not null default 0,
 counted_qty numeric(18,4), variance_qty numeric(18,4) generated always as (coalesce(counted_qty,system_qty)-system_qty) stored,
 variance_reason text, unique(stock_count_id,item_id,lot_id,bin_id)
);

create table if not exists public.inventory_valuation_layers (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete restrict, item_id uuid not null references public.items(id) on delete restrict,
 warehouse_id uuid not null references public.warehouses(id) on delete restrict, godown_id uuid not null references public.godowns(id) on delete restrict,
 lot_id uuid references public.inventory_lots(id) on delete restrict, valuation_method text not null check(valuation_method in('fifo','weighted_average')),
 source_type text not null, source_id uuid not null, received_at timestamptz not null default now(),
 original_qty numeric(18,4) not null check(original_qty>0), remaining_qty numeric(18,4) not null check(remaining_qty>=0),
 unit_cost numeric(18,4) not null check(unit_cost>=0), check(remaining_qty<=original_qty)
);

alter table public.stock_movements add column if not exists lot_id uuid references public.inventory_lots(id) on delete restrict;
alter table public.stock_movements add column if not exists bin_id uuid references public.warehouse_bins(id) on delete restrict;
alter table public.stock_movements add column if not exists inventory_document_id uuid references public.inventory_control_documents(id) on delete restrict;

do $$ declare t text; begin foreach t in array array[
 'warehouse_bins','inventory_lots','inventory_lot_balances','stock_reservations','goods_receipt_inspections',
 'inventory_control_documents','inventory_control_document_lines','inventory_reorder_rules','stock_counts','stock_count_lines','inventory_valuation_layers'
] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy %I on public.%I for select to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''inventory'',''view''))','inventory_read_'||t,t);
 execute format('create policy %I on public.%I for insert to authenticated with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''inventory'',''create''))','inventory_create_'||t,t);
 execute format('create policy %I on public.%I for update to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''inventory'',''edit'')) with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''inventory'',''edit''))','inventory_edit_'||t,t);
 execute format('create policy %I on public.%I for delete to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''inventory'',''delete''))','inventory_delete_'||t,t);
 execute format('revoke all on public.%I from anon',t);
 execute format('grant select,insert,update,delete on public.%I to authenticated',t);
end loop; end $$;

create index if not exists idx_inventory_lots_trace on public.inventory_lots(company_id,business_unit_id,item_id,heat_no,batch_no);
create index if not exists idx_lot_balances_lookup on public.inventory_lot_balances(company_id,business_unit_id,item_id,warehouse_id,godown_id);
create index if not exists idx_stock_reservations_source on public.stock_reservations(company_id,business_unit_id,source_type,source_id,status);
create index if not exists idx_grn_inspections_status on public.goods_receipt_inspections(company_id,business_unit_id,status);
create index if not exists idx_inventory_documents_status on public.inventory_control_documents(company_id,business_unit_id,document_type,status);
create index if not exists idx_stock_counts_status on public.stock_counts(company_id,business_unit_id,status);
create index if not exists idx_valuation_layers_fifo on public.inventory_valuation_layers(company_id,business_unit_id,item_id,warehouse_id,received_at) where remaining_qty>0;

create or replace view public.inventory_control_summary with (security_invoker=true) as
select ws.company_id,ws.business_unit_id,ws.item_id,i.name item_name,ws.warehouse_id,ws.godown_id,
 sum(ws.quantity) on_hand_qty,
 coalesce((select sum(r.reserved_qty-r.consumed_qty) from public.stock_reservations r where r.company_id=ws.company_id and r.business_unit_id=ws.business_unit_id and r.item_id=ws.item_id and r.warehouse_id=ws.warehouse_id and r.godown_id=ws.godown_id and r.status in('active','part_consumed')),0) reserved_qty,
 sum(ws.quantity)-coalesce((select sum(r.reserved_qty-r.consumed_qty) from public.stock_reservations r where r.company_id=ws.company_id and r.business_unit_id=ws.business_unit_id and r.item_id=ws.item_id and r.warehouse_id=ws.warehouse_id and r.godown_id=ws.godown_id and r.status in('active','part_consumed')),0) available_qty,
 rr.minimum_qty,rr.reorder_qty,
 case when rr.is_active and sum(ws.quantity)-coalesce((select sum(r.reserved_qty-r.consumed_qty) from public.stock_reservations r where r.company_id=ws.company_id and r.business_unit_id=ws.business_unit_id and r.item_id=ws.item_id and r.warehouse_id=ws.warehouse_id and r.godown_id=ws.godown_id and r.status in('active','part_consumed')),0)<=rr.minimum_qty then true else false end needs_reorder
from public.warehouse_stock ws join public.items i on i.id=ws.item_id
left join public.inventory_reorder_rules rr on rr.company_id=ws.company_id and rr.business_unit_id=ws.business_unit_id and rr.item_id=ws.item_id and rr.warehouse_id=ws.warehouse_id and (rr.godown_id is null or rr.godown_id=ws.godown_id)
group by ws.company_id,ws.business_unit_id,ws.item_id,i.name,ws.warehouse_id,ws.godown_id,rr.minimum_qty,rr.reorder_qty,rr.is_active;
revoke all on public.inventory_control_summary from anon;
grant select on public.inventory_control_summary to authenticated;
