create table if not exists public.order_book_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  sales_order_book_enabled boolean not null default false,
  purchase_order_book_enabled boolean not null default false,
  bilingual_labels boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_book_headers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  order_no text not null,
  order_type text not null check (order_type in ('sales','purchase')),
  party_id uuid not null,
  salesperson_id uuid null,
  order_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft','confirmed','partially_fulfilled','completed','cancelled')),
  notes text null,
  created_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  unique(company_id, order_type, order_no)
);

create table if not exists public.order_book_commitments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  order_id uuid not null references public.order_book_headers(id) on delete cascade,
  item_id uuid not null references public.items(id),
  ordered_qty numeric not null check (ordered_qty > 0),
  fulfilled_qty numeric not null default 0 check (fulfilled_qty >= 0),
  cancelled_qty numeric not null default 0 check (cancelled_qty >= 0),
  rate_status text not null default 'pending' check (rate_status in ('pending','agreed','revised','closed')),
  agreed_rate numeric null check (agreed_rate is null or agreed_rate >= 0),
  effective_date date not null default current_date,
  source text not null default 'order' check (source in ('order','spot','revision')),
  parent_commitment_id uuid null references public.order_book_commitments(id),
  remarks text null,
  created_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  check (fulfilled_qty + cancelled_qty <= ordered_qty),
  check ((rate_status='pending' and agreed_rate is null) or rate_status<>'pending')
);

create table if not exists public.order_book_fulfillments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  commitment_id uuid not null references public.order_book_commitments(id),
  document_type text not null check (document_type in ('sales_invoice','consolidated_sales_invoice','purchase_invoice','consolidated_purchase_invoice')),
  document_id uuid null,
  document_no text null,
  document_date date not null default current_date,
  qty numeric not null check (qty > 0),
  rate numeric not null check (rate >= 0),
  created_by uuid null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_obh_company_type_party on public.order_book_headers(company_id,order_type,party_id,status);
create index if not exists idx_obc_order_item on public.order_book_commitments(order_id,item_id,rate_status);
create index if not exists idx_obf_commitment on public.order_book_fulfillments(commitment_id);

alter table public.order_book_settings enable row level security;
alter table public.order_book_headers enable row level security;
alter table public.order_book_commitments enable row level security;
alter table public.order_book_fulfillments enable row level security;

create policy ob_settings_select on public.order_book_settings for select to authenticated using (public.has_company_access(company_id));
create policy ob_settings_insert on public.order_book_settings for insert to authenticated with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'settings','edit'));
create policy ob_settings_update on public.order_book_settings for update to authenticated using (public.has_module_permission(company_id,'settings','edit')) with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'settings','edit'));

create policy ob_headers_select on public.order_book_headers for select to authenticated using (public.has_company_access(company_id));
create policy ob_headers_insert on public.order_book_headers for insert to authenticated with check (company_id=public.current_company_id() and ((order_type='sales' and public.has_module_permission(company_id,'sales','create')) or (order_type='purchase' and public.has_module_permission(company_id,'purchase','create'))));
create policy ob_headers_update on public.order_book_headers for update to authenticated using ((order_type='sales' and public.has_module_permission(company_id,'sales','edit')) or (order_type='purchase' and public.has_module_permission(company_id,'purchase','edit'))) with check (company_id=public.current_company_id());
create policy ob_headers_delete on public.order_book_headers for delete to authenticated using (status='draft' and ((order_type='sales' and public.has_module_permission(company_id,'sales','delete')) or (order_type='purchase' and public.has_module_permission(company_id,'purchase','delete'))));

create policy ob_commitments_select on public.order_book_commitments for select to authenticated using (public.has_company_access(company_id));
create policy ob_commitments_insert on public.order_book_commitments for insert to authenticated with check (company_id=public.current_company_id() and public.has_company_access(company_id));
create policy ob_commitments_update on public.order_book_commitments for update to authenticated using (public.has_company_access(company_id)) with check (company_id=public.current_company_id());

create policy ob_fulfillments_select on public.order_book_fulfillments for select to authenticated using (public.has_company_access(company_id));
create policy ob_fulfillments_insert on public.order_book_fulfillments for insert to authenticated with check (company_id=public.current_company_id() and public.has_company_access(company_id));

grant select,insert,update on public.order_book_settings to authenticated;
grant select,insert,update,delete on public.order_book_headers to authenticated;
grant select,insert,update on public.order_book_commitments to authenticated;
grant select,insert on public.order_book_fulfillments to authenticated;

create or replace function public.next_order_book_no(p_order_type text)
returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_company uuid:=public.current_company_id(); v_prefix text; v_n integer;
begin
 if v_company is null then raise exception 'No active company selected.'; end if;
 if p_order_type not in ('sales','purchase') then raise exception 'Invalid order type.'; end if;
 v_prefix:=case when p_order_type='sales' then 'SO' else 'PO' end;
 select coalesce(max(nullif(regexp_replace(order_no,'[^0-9]','','g'),'')::integer),0)+1 into v_n from public.order_book_headers where company_id=v_company and order_type=p_order_type;
 return v_prefix||'-'||lpad(v_n::text,6,'0');
end $$;
grant execute on function public.next_order_book_no(text) to authenticated;
