create table if not exists public.document_print_visibility (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_type text not null check (document_type in ('sales_invoice','purchase','work_order','receipt_payment','gate_pass','reports')),
  show_company_name boolean not null default true,
  show_logo boolean not null default true,
  show_address boolean not null default true,
  show_phone_email boolean not null default true,
  show_tax_details boolean not null default true,
  show_header boolean not null default true,
  show_footer boolean not null default true,
  show_signatures boolean not null default true,
  show_print_datetime boolean not null default false,
  show_page_numbers boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  show_previous_balance boolean not null default true,
  show_closing_balance boolean not null default true,
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete restrict
);

create index if not exists idx_document_print_visibility_company_id
  on public.document_print_visibility(company_id);

alter table public.document_print_visibility enable row level security;

drop policy if exists tenant_select_document_print_visibility on public.document_print_visibility;
create policy tenant_select_document_print_visibility on public.document_print_visibility
for select to authenticated
using (public.has_module_permission(company_id,'reports','view'));

drop policy if exists tenant_insert_document_print_visibility on public.document_print_visibility;
create policy tenant_insert_document_print_visibility on public.document_print_visibility
for insert to authenticated
with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'reports','create'));

drop policy if exists tenant_update_document_print_visibility on public.document_print_visibility;
create policy tenant_update_document_print_visibility on public.document_print_visibility
for update to authenticated
using (public.has_module_permission(company_id,'reports','edit'))
with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'reports','edit'));

drop policy if exists tenant_delete_document_print_visibility on public.document_print_visibility;
create policy tenant_delete_document_print_visibility on public.document_print_visibility
for delete to authenticated
using (public.has_module_permission(company_id,'reports','delete'));
