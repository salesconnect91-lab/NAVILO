-- Draft-only multi-vehicle Transport expense documents. No financial posting.
-- Future posting migration must enforce effective-dated VAT, credit/AP mappings,
-- double-entry balance, reversals and idempotency before enabling Post.
begin;

create table if not exists public.transport_vehicle_expense_documents (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,
 business_unit_id uuid not null,
 expense_group text not null,
 expense_date date not null,
 supplier_id uuid,
 payment_method text not null check (payment_method in ('cash','bank','payable')),
 status text not null default 'draft' check (status='draft'),
 created_by uuid not null default auth.uid(),
 created_at timestamptz not null default now(),
 unique (company_id,business_unit_id,expense_group),
 unique (id,company_id,business_unit_id),
 check (length(btrim(expense_group)) between 1 and 80),
 check (payment_method <> 'payable' or supplier_id is not null)
);
create table if not exists public.transport_vehicle_expense_document_lines (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,
 business_unit_id uuid not null,
 document_id uuid not null,
 line_number integer not null check (line_number > 0),
 vehicle_id uuid not null,
 trip_id uuid,
 expense_type text not null,
 description text not null,
 net_amount numeric(16,2) not null check (net_amount > 0),
 vat_rate numeric(6,2) not null check (vat_rate in (0,15)),
 vat_amount numeric(16,2) not null check (vat_amount >= 0),
 source_reference text not null,
 foreign key (document_id,company_id,business_unit_id)
   references public.transport_vehicle_expense_documents(id,company_id,business_unit_id) on delete cascade,
 foreign key (company_id,business_unit_id,vehicle_id)
   references public.transport_vehicles(company_id,business_unit_id,id),
 unique (document_id,line_number),
 check (length(btrim(expense_type)) between 1 and 120),
 check (length(btrim(description)) between 1 and 1000),
 check (length(btrim(source_reference)) between 1 and 120),
 check (vat_amount=round(net_amount*vat_rate/100,2))
);
create unique index if not exists transport_vehicle_expense_draft_reference_uidx
 on public.transport_vehicle_expense_document_lines(company_id,business_unit_id,lower(btrim(source_reference)));
create index if not exists transport_vehicle_expense_draft_vehicle_idx
 on public.transport_vehicle_expense_document_lines(company_id,business_unit_id,vehicle_id);
alter table public.transport_vehicle_expense_documents enable row level security;
alter table public.transport_vehicle_expense_document_lines enable row level security;
revoke all on public.transport_vehicle_expense_documents,public.transport_vehicle_expense_document_lines from public,anon,authenticated;

create or replace function public.transport_save_vehicle_expense_draft(p_group text,p_date date,p_supplier_id uuid,p_method text,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare
 c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id();
 d uuid; r jsonb; ix integer:=0; veh uuid; trip uuid; t text; amount numeric; rate numeric; ref text;
begin
 perform public.assert_module_permission('transport','edit');
 perform public.assert_module_permission('accounting','create');
 if auth.uid() is null or c is null or b is null then raise exception 'Active authenticated business required'; end if;
 if p_group is null or length(btrim(p_group)) not between 1 and 80 or p_date is null then raise exception 'Group and date required'; end if;
 if lower(coalesce(p_method,'')) not in ('cash','bank','payable') then raise exception 'Invalid payment method'; end if;
 if p_supplier_id is not null and not exists(select 1 from public.suppliers s where s.id=p_supplier_id and s.company_id=c and s.is_active) then raise exception 'Supplier not active in this company'; end if;
 if lower(p_method)='payable' and p_supplier_id is null then raise exception 'Payable requires supplier'; end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 500 then raise exception '1 to 500 expense lines required'; end if;
 insert into public.transport_vehicle_expense_documents(company_id,business_unit_id,expense_group,expense_date,supplier_id,payment_method,created_by)
 values(c,b,btrim(p_group),p_date,p_supplier_id,lower(p_method),auth.uid()) returning id into d;
 for r in select value from jsonb_array_elements(p_lines) loop
  ix:=ix+1;
  if coalesce(r->>'vehicle_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Line %: valid vehicle required',ix; end if;
  veh:=(r->>'vehicle_id')::uuid;
  if not exists(select 1 from public.transport_vehicles v where v.company_id=c and v.business_unit_id=b and v.id=veh and v.is_active) then raise exception 'Line %: vehicle not active in selected business',ix; end if;
  trip:=null;
  if nullif(r->>'trip_id','') is not null then
   trip:=(r->>'trip_id')::uuid;
   if not exists(select 1 from public.transport_trips tt where tt.id=trip and tt.company_id=c and tt.business_unit_id=b and tt.vehicle_id=veh) then raise exception 'Line %: Trip/vehicle mismatch',ix; end if;
  end if;
  t:=btrim(coalesce(r->>'expense_type',''));
  if not exists(select 1 from public.transport_vehicle_expense_types et where et.company_id=c and et.business_unit_id=b and et.is_active and lower(btrim(et.name))=lower(t)) then raise exception 'Line %: expense type inactive',ix; end if;
  if coalesce(r->>'net_amount','') !~ '^([0-9]{1,12})(\.[0-9]{1,2})?$' or coalesce(r->>'vat_rate','') !~ '^(0|15)(\.0+)?$' then raise exception 'Line %: invalid amount or VAT rate',ix; end if;
  amount:=(r->>'net_amount')::numeric;rate:=(r->>'vat_rate')::numeric;
  ref:=btrim(coalesce(r->>'source_reference',''));
  if amount<=0 or length(ref) not between 1 and 120 or length(btrim(coalesce(r->>'description',''))) not between 1 and 1000 then raise exception 'Line %: invalid amount/reference/description',ix; end if;
  insert into public.transport_vehicle_expense_document_lines(company_id,business_unit_id,document_id,line_number,vehicle_id,trip_id,expense_type,description,net_amount,vat_rate,vat_amount,source_reference)
  values(c,b,d,ix,veh,trip,t,btrim(r->>'description'),amount,rate,round(amount*rate/100,2),ref);
 end loop;
 return jsonb_build_object('document_id',d,'status','draft','lines',ix,'posted',false);
end $$;
revoke all on function public.transport_save_vehicle_expense_draft(text,date,uuid,text,jsonb) from public,anon;
grant execute on function public.transport_save_vehicle_expense_draft(text,date,uuid,text,jsonb) to authenticated;
commit;
