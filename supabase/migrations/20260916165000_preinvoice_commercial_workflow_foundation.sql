begin;

create table public.preinvoice_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade default public.current_company_id(),
  business_unit_id uuid not null references public.business_units(id) on delete restrict default public.current_business_unit_id(),
  operating_location_id uuid references public.operating_locations(id) on delete restrict default public.current_operating_location_id(),
  document_type text not null check (document_type in ('purchase_requisition','purchase_rfq','purchase_order','goods_receipt','sales_quotation','sales_order','stock_reservation','dispatch')),
  document_no text not null,
  document_date date not null default current_date,
  source_document_id uuid references public.preinvoice_documents(id) on delete restrict,
  party_id uuid,
  party_name text,
  status text not null default 'draft' check (status in ('draft','submitted','approved','posted','cancelled')),
  valid_until date,
  expected_date date,
  currency_code text not null default 'PKR',
  subtotal numeric(20,4) not null default 0 check (subtotal>=0),
  tax_amount numeric(20,4) not null default 0 check (tax_amount>=0),
  total numeric(20,4) not null default 0 check (total>=0),
  terms text,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  submitted_by uuid references auth.users(id) on delete restrict,
  submitted_at timestamptz,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  posted_by uuid references auth.users(id) on delete restrict,
  posted_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete restrict,
  cancelled_at timestamptz,
  cancellation_reason text,
  updated_at timestamptz not null default now(),
  unique(company_id,business_unit_id,document_type,document_no)
);

create table public.preinvoice_document_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  document_id uuid not null references public.preinvoice_documents(id) on delete cascade,
  source_line_id uuid references public.preinvoice_document_lines(id) on delete restrict,
  line_no integer not null check (line_no>0),
  item_id uuid not null references public.items(id) on delete restrict,
  description text,
  qty numeric(20,4) not null check (qty>0),
  uom text,
  unit_rate numeric(20,4) not null default 0 check (unit_rate>=0),
  tax_percent numeric(8,4) not null default 0 check (tax_percent>=0),
  line_total numeric(20,4) not null default 0 check (line_total>=0),
  warehouse_id uuid references public.warehouses(id) on delete restrict,
  godown_id uuid references public.godowns(id) on delete restrict,
  remarks text,
  created_at timestamptz not null default now(),
  unique(document_id,line_no)
);

create table public.preinvoice_document_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  document_id uuid not null references public.preinvoice_documents(id) on delete cascade,
  action text not null,
  from_status text,
  to_status text,
  notes text,
  actor_user_id uuid references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.preinvoice_document_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  document_type text not null,
  fiscal_year integer not null,
  next_number bigint not null default 1 check(next_number>0),
  primary key(company_id,business_unit_id,document_type,fiscal_year)
);

create index idx_preinvoice_documents_scope_status on public.preinvoice_documents(company_id,business_unit_id,document_type,status,document_date desc);
create index idx_preinvoice_documents_source on public.preinvoice_documents(source_document_id) where source_document_id is not null;
create index idx_preinvoice_lines_document on public.preinvoice_document_lines(document_id,line_no);
create index idx_preinvoice_lines_source on public.preinvoice_document_lines(source_line_id) where source_line_id is not null;
create index idx_preinvoice_history_document on public.preinvoice_document_history(document_id,created_at);

alter table public.preinvoice_documents enable row level security;
alter table public.preinvoice_document_lines enable row level security;
alter table public.preinvoice_document_history enable row level security;
alter table public.preinvoice_document_counters enable row level security;

revoke all on public.preinvoice_documents,public.preinvoice_document_lines,public.preinvoice_document_history,public.preinvoice_document_counters from anon;
revoke insert,update,delete on public.preinvoice_documents,public.preinvoice_document_lines,public.preinvoice_document_history,public.preinvoice_document_counters from authenticated;
grant select on public.preinvoice_documents,public.preinvoice_document_lines,public.preinvoice_document_history to authenticated;

create policy preinvoice_documents_select on public.preinvoice_documents for select to authenticated using (
  company_id=(select public.current_company_id()) and business_unit_id=(select public.current_business_unit_id())
  and public.has_module_permission(company_id,case when document_type like 'purchase_%' or document_type='goods_receipt' then 'purchase' else 'sales' end,'view')
);
create policy preinvoice_lines_select on public.preinvoice_document_lines for select to authenticated using (
  company_id=(select public.current_company_id()) and business_unit_id=(select public.current_business_unit_id())
  and exists(select 1 from public.preinvoice_documents d where d.id=document_id)
);
create policy preinvoice_history_select on public.preinvoice_document_history for select to authenticated using (
  company_id=(select public.current_company_id()) and business_unit_id=(select public.current_business_unit_id())
  and exists(select 1 from public.preinvoice_documents d where d.id=document_id)
);

create or replace function public.preinvoice_module(p_type text) returns text language sql immutable set search_path='' as $$
  select case when p_type like 'purchase_%' or p_type='goods_receipt' then 'purchase' else 'sales' end
$$;
create or replace function public.preinvoice_prefix(p_type text) returns text language sql immutable set search_path='' as $$
  select case p_type when 'purchase_requisition' then 'PR' when 'purchase_rfq' then 'RFQ' when 'purchase_order' then 'PO'
    when 'goods_receipt' then 'GRN' when 'sales_quotation' then 'SQ' when 'sales_order' then 'SO'
    when 'stock_reservation' then 'RSV' when 'dispatch' then 'DSP' else 'DOC' end
$$;
revoke all on function public.preinvoice_module(text),public.preinvoice_prefix(text) from public,anon,authenticated;

create or replace function public.next_preinvoice_document_no(p_company uuid,p_bu uuid,p_type text,p_date date)
returns text language plpgsql security definer set search_path='' as $$
declare v_year int:=extract(year from p_date);v_no bigint;
begin
 insert into public.preinvoice_document_counters(company_id,business_unit_id,document_type,fiscal_year,next_number)
 values(p_company,p_bu,p_type,v_year,2)
 on conflict(company_id,business_unit_id,document_type,fiscal_year) do update set next_number=public.preinvoice_document_counters.next_number+1
 returning next_number-1 into v_no;
 return public.preinvoice_prefix(p_type)||'-'||v_year::text||'-'||lpad(v_no::text,5,'0');
end;$$;
revoke all on function public.next_preinvoice_document_no(uuid,uuid,text,date) from public,anon,authenticated;

create or replace function public.create_preinvoice_document(
 p_document_type text,p_document_date date,p_party_id uuid,p_party_name text,p_source_document_id uuid,
 p_valid_until date,p_expected_date date,p_terms text,p_notes text,p_lines jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_company uuid:=public.current_company_id();v_bu uuid:=public.current_business_unit_id();v_loc uuid:=public.current_operating_location_id();
 v_module text;v_doc public.preinvoice_documents%rowtype;v_source public.preinvoice_documents%rowtype;v_line jsonb;v_item public.items%rowtype;
 v_source_line public.preinvoice_document_lines%rowtype;v_used numeric;v_qty numeric;v_rate numeric;v_tax numeric;v_sub numeric:=0;v_tax_total numeric:=0;v_expected_source text;v_line_no int:=0;
begin
 if v_user is null or v_company is null or v_bu is null then raise exception 'Authentication, company and business unit context are required.';end if;
 if p_document_type not in ('purchase_requisition','purchase_rfq','purchase_order','goods_receipt','sales_quotation','sales_order','stock_reservation','dispatch') then raise exception 'Unsupported commercial document type.';end if;
 v_module:=public.preinvoice_module(p_document_type);
 if not public.has_module_permission(v_company,v_module,'create') then raise exception 'Create permission is required for this document.';end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'At least one document line is required.';end if;
 v_expected_source:=case p_document_type when 'purchase_rfq' then 'purchase_requisition' when 'purchase_order' then 'purchase_rfq' when 'goods_receipt' then 'purchase_order'
   when 'sales_order' then 'sales_quotation' when 'stock_reservation' then 'sales_order' when 'dispatch' then 'stock_reservation' else null end;
 if v_expected_source is null and p_source_document_id is not null then raise exception '% cannot have an upstream pre-invoice document.',p_document_type;end if;
 if v_expected_source is not null then
   select * into v_source from public.preinvoice_documents where id=p_source_document_id for update;
   if v_source.id is null or v_source.company_id<>v_company or v_source.business_unit_id<>v_bu then raise exception 'Source document is not available in the active company/business unit.';end if;
   if v_source.document_type<>v_expected_source then raise exception 'Expected source type %, received %.',v_expected_source,v_source.document_type;end if;
   if v_source.status not in ('approved','posted') then raise exception 'Source document must be approved before conversion.';end if;
 end if;
 insert into public.preinvoice_documents(company_id,business_unit_id,operating_location_id,document_type,document_no,document_date,source_document_id,party_id,party_name,valid_until,expected_date,terms,notes,created_by)
 values(v_company,v_bu,v_loc,p_document_type,public.next_preinvoice_document_no(v_company,v_bu,p_document_type,coalesce(p_document_date,current_date)),coalesce(p_document_date,current_date),p_source_document_id,p_party_id,nullif(btrim(coalesce(p_party_name,'')),''),p_valid_until,p_expected_date,p_terms,p_notes,v_user)
 returning * into v_doc;
 for v_line in select value from jsonb_array_elements(p_lines) loop
   v_line_no:=v_line_no+1;v_qty:=coalesce(nullif(v_line->>'qty','')::numeric,0);v_rate:=coalesce(nullif(v_line->>'unit_rate','')::numeric,0);v_tax:=coalesce(nullif(v_line->>'tax_percent','')::numeric,0);
   if v_qty<=0 or v_rate<0 or v_tax<0 then raise exception 'Line % has invalid quantity, rate or tax.',v_line_no;end if;
   select * into v_item from public.items where id=(v_line->>'item_id')::uuid and company_id=v_company;
   if v_item.id is null then raise exception 'Line % item is not available in the active company.',v_line_no;end if;
   if v_expected_source is not null then
     select * into v_source_line from public.preinvoice_document_lines where id=(v_line->>'source_line_id')::uuid and document_id=v_source.id for update;
     if v_source_line.id is null or v_source_line.item_id<>v_item.id then raise exception 'Line % source line/item mismatch.',v_line_no;end if;
     select coalesce(sum(cl.qty),0) into v_used from public.preinvoice_document_lines cl join public.preinvoice_documents cd on cd.id=cl.document_id
       where cl.source_line_id=v_source_line.id and cd.status<>'cancelled';
     if v_qty>v_source_line.qty-v_used then raise exception 'Line % exceeds remaining source quantity (%).',v_line_no,v_source_line.qty-v_used;end if;
   else v_source_line.id:=null;end if;
   insert into public.preinvoice_document_lines(company_id,business_unit_id,document_id,source_line_id,line_no,item_id,description,qty,uom,unit_rate,tax_percent,line_total,warehouse_id,godown_id,remarks)
   values(v_company,v_bu,v_doc.id,v_source_line.id,v_line_no,v_item.id,nullif(v_line->>'description',''),v_qty,coalesce(nullif(v_line->>'uom',''),v_item.unit),v_rate,v_tax,round(v_qty*v_rate,4),nullif(v_line->>'warehouse_id','')::uuid,nullif(v_line->>'godown_id','')::uuid,nullif(v_line->>'remarks',''));
   v_sub:=v_sub+round(v_qty*v_rate,4);v_tax_total:=v_tax_total+round(v_qty*v_rate*v_tax/100,4);
 end loop;
 update public.preinvoice_documents set subtotal=v_sub,tax_amount=v_tax_total,total=v_sub+v_tax_total where id=v_doc.id;
 insert into public.preinvoice_document_history(company_id,business_unit_id,document_id,action,to_status,actor_user_id) values(v_company,v_bu,v_doc.id,'created','draft',v_user);
 if p_source_document_id is not null then perform public.record_transaction_link(v_company,v_bu,v_module,v_source.document_type,v_source.id,v_module,p_document_type,v_doc.id,'converted_to');end if;
 return jsonb_build_object('id',v_doc.id,'document_no',v_doc.document_no,'status','draft','total',v_sub+v_tax_total);
end;$$;

create or replace function public.transition_preinvoice_document(p_document_id uuid,p_action text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_doc public.preinvoice_documents%rowtype;v_to text;v_module text;v_child int;
begin
 if v_user is null then raise exception 'Authentication is required.';end if;
 select * into v_doc from public.preinvoice_documents where id=p_document_id for update;
 if v_doc.id is null or v_doc.company_id<>public.current_company_id() or v_doc.business_unit_id<>public.current_business_unit_id() then raise exception 'Document not found in active company/business unit.';end if;
 v_module:=public.preinvoice_module(v_doc.document_type);
 if p_action='submit' and v_doc.status='draft' then v_to:='submitted';
 elsif p_action='approve' and v_doc.status='submitted' then
   if v_doc.created_by=v_user then raise exception 'Maker-checker rule: creator cannot approve their own document.';end if;
   if not public.has_module_permission(v_doc.company_id,v_module,'post') then raise exception 'Post/approval permission is required.';end if;v_to:='approved';
 elsif p_action='post' and v_doc.status='approved' then
   if not public.has_module_permission(v_doc.company_id,v_module,'post') then raise exception 'Post permission is required.';end if;v_to:='posted';
 elsif p_action='cancel' and v_doc.status in ('draft','submitted','approved') then
   if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Cancellation reason is required.';end if;
   select count(*) into v_child from public.preinvoice_documents where source_document_id=v_doc.id and status<>'cancelled';
   if v_child>0 then raise exception 'Cancel downstream documents first.';end if;v_to:='cancelled';
 else raise exception 'Invalid % transition from status %.',p_action,v_doc.status;end if;
 update public.preinvoice_documents set status=v_to,updated_at=now(),
  submitted_by=case when v_to='submitted' then v_user else submitted_by end,submitted_at=case when v_to='submitted' then now() else submitted_at end,
  approved_by=case when v_to='approved' then v_user else approved_by end,approved_at=case when v_to='approved' then now() else approved_at end,
  posted_by=case when v_to='posted' then v_user else posted_by end,posted_at=case when v_to='posted' then now() else posted_at end,
  cancelled_by=case when v_to='cancelled' then v_user else cancelled_by end,cancelled_at=case when v_to='cancelled' then now() else cancelled_at end,
  cancellation_reason=case when v_to='cancelled' then btrim(p_reason) else cancellation_reason end where id=v_doc.id;
 insert into public.preinvoice_document_history(company_id,business_unit_id,document_id,action,from_status,to_status,notes,actor_user_id)
 values(v_doc.company_id,v_doc.business_unit_id,v_doc.id,p_action,v_doc.status,v_to,nullif(btrim(coalesce(p_reason,'')),''),v_user);
 return jsonb_build_object('id',v_doc.id,'document_no',v_doc.document_no,'status',v_to);
end;$$;

revoke all on function public.create_preinvoice_document(text,date,uuid,text,uuid,date,date,text,text,jsonb) from public,anon;
grant execute on function public.create_preinvoice_document(text,date,uuid,text,uuid,date,date,text,text,jsonb) to authenticated;
revoke all on function public.transition_preinvoice_document(uuid,text,text) from public,anon;
grant execute on function public.transition_preinvoice_document(uuid,text,text) to authenticated;

create or replace view public.preinvoice_line_progress with(security_invoker=true) as
select l.*,coalesce(x.downstream_qty,0)::numeric downstream_qty,greatest(l.qty-coalesce(x.downstream_qty,0),0)::numeric remaining_qty
from public.preinvoice_document_lines l left join lateral(
 select sum(cl.qty) downstream_qty from public.preinvoice_document_lines cl join public.preinvoice_documents cd on cd.id=cl.document_id
 where cl.source_line_id=l.id and cd.status<>'cancelled'
)x on true;
revoke all on public.preinvoice_line_progress from anon;
grant select on public.preinvoice_line_progress to authenticated;

notify pgrst,'reload schema';
commit;
