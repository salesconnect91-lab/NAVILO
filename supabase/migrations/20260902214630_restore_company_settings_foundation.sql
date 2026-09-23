-- Restore the legacy company_settings foundation that predates tenant scoping.
-- The live database still carries these original columns/constraints; later migrations
-- add company_id, language controls, order-book controls and jurisdiction fields.

create table if not exists public.company_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_name text not null default 'Steel Mill ERP',
  company_name_urdu text,
  currency text not null default 'PKR',
  address text,
  phone text,
  email text,
  website text,
  ntn text,
  strn text,
  logo_url text,
  document_header text,
  document_header_urdu text,
  document_footer text,
  document_footer_urdu text,
  prepared_by_label text not null default 'Prepared By',
  checked_by_label text not null default 'Checked By',
  approved_by_label text not null default 'Approved By',
  page_size text not null default 'A4' check (page_size in ('A4','Letter')),
  page_orientation text not null default 'portrait' check (page_orientation in ('portrait','landscape')),
  show_logo boolean not null default true,
  show_address boolean not null default true,
  show_phone boolean not null default true,
  show_email boolean not null default true,
  show_tax_details boolean not null default true,
  show_signatures boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_settings_user_id_key unique (user_id)
);

alter table public.company_settings enable row level security;
