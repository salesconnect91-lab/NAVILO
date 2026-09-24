-- These sales-consolidation tables existed in the hosted database before the
-- recorded company-tenancy migrations. Their pre-tenant shape is evidenced by
-- live catalog column order/constraints and the later company, BU and branch
-- migrations that add the remaining scope columns.

create table if not exists public.sales_consolidations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consolidation_no text not null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  consolidation_date date not null default current_date,
  title text,
  notes text,
  status text not null default 'draft'
    constraint sales_consolidations_status_check
    check (status in ('draft','finalized','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  previous_balance numeric,
  bills_total numeric,
  received_amount numeric,
  closing_balance numeric,
  finalized_at timestamptz,
  constraint sales_consolidations_user_id_consolidation_no_key
    unique (user_id, consolidation_no)
);

create index if not exists idx_sales_consolidations_date
  on public.sales_consolidations(user_id, consolidation_date desc);
create index if not exists idx_sales_consolidations_user_customer
  on public.sales_consolidations(user_id, customer_id);

create table if not exists public.sales_consolidation_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consolidation_id uuid not null references public.sales_consolidations(id) on delete cascade,
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  reference_name text,
  reference_no text,
  remarks text,
  created_at timestamptz not null default now(),
  constraint sales_consolidation_invoices_consolidation_id_sales_order_i_key
    unique (consolidation_id, sales_order_id)
);

create index if not exists idx_sales_consolidation_invoices_parent
  on public.sales_consolidation_invoices(consolidation_id);
create unique index if not exists uq_sales_consolidation_invoice_once
  on public.sales_consolidation_invoices(sales_order_id);
