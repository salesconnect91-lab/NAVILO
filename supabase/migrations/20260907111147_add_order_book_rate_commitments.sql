alter table public.company_settings add column if not exists order_book_enabled boolean not null default false;

create table if not exists public.order_book_headers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id(),
  business_unit_id uuid not null default public.current_business_unit_id(),
  operating_location_id uuid default public.current_operating_location_id(),
  user_id uuid not null default auth.uid(),
  order_type text not null check (order_type in ('sales','purchase')),
  order_no text not null,
  order_date date not null default current_date,
  party_id uuid not null,
  party_name text not null,
  salesperson_name text,
  status text not null default 'draft' check (status in ('draft','confirmed','partially_fulfilled','completed','cancelled','rate_pending')),
  remarks text,
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,business_unit_id,order_type,order_no)
);

create table if not exists public.order_book_commitments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.order_book_headers(id) on delete cascade,
  company_id uuid not null default public.current_company_id(),
  business_unit_id uuid not null default public.current_business_unit_id(),
  operating_location_id uuid default public.current_operating_location_id(),
  item_id uuid not null references public.items(id),
  item_name text not null,
  ordered_qty numeric(18,4) not null check (ordered_qty > 0),
  fulfilled_qty numeric(18,4) not null default 0 check (fulfilled_qty >= 0),
  cancelled_qty numeric(18,4) not null default 0 check (cancelled_qty >= 0),
  uom text,
  rate_status text not null default 'pending' check (rate_status in ('agreed','pending')),
  agreed_rate numeric(18,4) check (agreed_rate is null or agreed_rate >= 0),
  effective_at timestamptz,
  source text not null default 'order' check (source in ('order','spot','rate_revision')),
  parent_commitment_id uuid references public.order_book_commitments(id),
  status text not null default 'open' check (status in ('open','partially_fulfilled','completed','cancelled')),
  remarks text,
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fulfilled_qty + cancelled_qty <= ordered_qty),
  check ((rate_status='pending' and agreed_rate is null) or (rate_status='agreed' and agreed_rate is not null))
);

create table if not exists public.order_book_rate_history (
  id uuid primary key default gen_random_uuid(),
  commitment_id uuid not null references public.order_book_commitments(id) on delete cascade,
  company_id uuid not null default public.current_company_id(),
  business_unit_id uuid not null default public.current_business_unit_id(),
  old_rate numeric(18,4),
  new_rate numeric(18,4),
  old_rate_status text,
  new_rate_status text not null,
  effective_at timestamptz not null default now(),
  reason text not null,
  changed_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.order_book_allocations (
  id uuid primary key default gen_random_uuid(),
  commitment_id uuid not null references public.order_book_commitments(id) on delete restrict,
  company_id uuid not null default public.current_company_id(),
  business_unit_id uuid not null default public.current_business_unit_id(),
  document_type text not null check (document_type in ('sales_main','sales_consolidated','purchase_main','purchase_consolidated')),
  document_id uuid not null,
  document_line_id uuid,
  qty numeric(18,4) not null check (qty > 0),
  rate numeric(18,4) not null check (rate >= 0),
  allocated_by uuid default auth.uid(),
  allocated_at timestamptz not null default now(),
  unique(commitment_id,document_type,document_id,document_line_id)
);

create index if not exists idx_order_book_headers_scope on public.order_book_headers(company_id,business_unit_id,order_type,status,order_date desc);
create index if not exists idx_order_book_headers_party on public.order_book_headers(company_id,business_unit_id,party_id,order_type);
create index if not exists idx_order_book_commitments_order on public.order_book_commitments(order_id);
create index if not exists idx_order_book_commitments_open on public.order_book_commitments(company_id,business_unit_id,item_id,rate_status,status);
create index if not exists idx_order_book_rate_history_commitment on public.order_book_rate_history(commitment_id,effective_at desc);
create index if not exists idx_order_book_allocations_commitment on public.order_book_allocations(commitment_id,allocated_at desc);
create index if not exists idx_order_book_allocations_document on public.order_book_allocations(document_type,document_id);

alter table public.order_book_headers enable row level security;
alter table public.order_book_commitments enable row level security;
alter table public.order_book_rate_history enable row level security;
alter table public.order_book_allocations enable row level security;

drop policy if exists order_book_headers_select on public.order_book_headers;
create policy order_book_headers_select on public.order_book_headers for select to authenticated using (
 company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and
 ((order_type='sales' and public.has_module_permission(company_id,'sales','view')) or (order_type='purchase' and public.has_module_permission(company_id,'purchase','view')))
);
drop policy if exists order_book_headers_insert on public.order_book_headers;
create policy order_book_headers_insert on public.order_book_headers for insert to authenticated with check (
 company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and
 ((order_type='sales' and public.has_module_permission(company_id,'sales','create')) or (order_type='purchase' and public.has_module_permission(company_id,'purchase','create')))
);
drop policy if exists order_book_headers_update on public.order_book_headers;
create policy order_book_headers_update on public.order_book_headers for update to authenticated using (
 company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and
 ((order_type='sales' and public.has_module_permission(company_id,'sales','edit')) or (order_type='purchase' and public.has_module_permission(company_id,'purchase','edit')))
) with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id());

drop policy if exists order_book_commitments_all on public.order_book_commitments;
create policy order_book_commitments_all on public.order_book_commitments for all to authenticated using (
 company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and exists (
   select 1 from public.order_book_headers h where h.id=order_id and h.company_id=company_id and h.business_unit_id=business_unit_id and
   ((h.order_type='sales' and public.has_module_permission(h.company_id,'sales','view')) or (h.order_type='purchase' and public.has_module_permission(h.company_id,'purchase','view')))
 )) with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id());

drop policy if exists order_book_rate_history_all on public.order_book_rate_history;
create policy order_book_rate_history_all on public.order_book_rate_history for all to authenticated using (
 company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
) with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id());

drop policy if exists order_book_allocations_all on public.order_book_allocations;
create policy order_book_allocations_all on public.order_book_allocations for all to authenticated using (
 company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
) with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id());

grant select,insert,update,delete on public.order_book_headers,public.order_book_commitments,public.order_book_rate_history,public.order_book_allocations to authenticated;
revoke all on public.order_book_headers,public.order_book_commitments,public.order_book_rate_history,public.order_book_allocations from anon;