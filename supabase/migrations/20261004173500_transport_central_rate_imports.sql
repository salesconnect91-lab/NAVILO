create table if not exists public.transport_supplier_rates(
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete cascade, supplier_id uuid not null references public.suppliers(id) on delete restrict,
 from_location_id uuid not null,to_location_id uuid not null,truck_type_id uuid not null,effective_from date not null,effective_to date,
 amount numeric(18,2) not null check(amount>=0),is_active boolean not null default true,created_by uuid default auth.uid(),created_at timestamptz not null default now(),
 check(effective_to is null or effective_to>=effective_from),
 foreign key(company_id,business_unit_id,from_location_id) references public.transport_locations(company_id,business_unit_id,id),
 foreign key(company_id,business_unit_id,to_location_id) references public.transport_locations(company_id,business_unit_id,id),
 foreign key(company_id,business_unit_id,truck_type_id) references public.transport_truck_types(company_id,business_unit_id,id));
create index if not exists transport_supplier_rates_lookup_idx on public.transport_supplier_rates(company_id,business_unit_id,supplier_id,from_location_id,to_location_id,truck_type_id,effective_from desc);
alter table public.transport_supplier_rates enable row level security;
drop policy if exists transport_supplier_rates_read on public.transport_supplier_rates;
create policy transport_supplier_rates_read on public.transport_supplier_rates for select to authenticated using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'transport','view'));
revoke all on public.transport_supplier_rates from anon,authenticated; grant select on public.transport_supplier_rates to authenticated; grant all on public.transport_supplier_rates to service_role;
create or replace function public.transport_import_rate_rows(p_kind text,p_rows jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); r jsonb; n int:=0; cid uuid; pid uuid; tt uuid; fl uuid; tl uuid; ct uuid; ef date; et date; amt numeric; stat text;
begin
 if auth.uid() is null or c is null or b is null or not public.has_transport_action_permission(c,'customer_rate_finalize') then raise exception 'Transport rate permission required'; end if;
 if p_kind not in ('customer','supplier','customer_charge') or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'Invalid rate import'; end if;
 for r in select * from jsonb_array_elements(p_rows) loop
  ef:=(r->>'effective_from')::date; et:=nullif(r->>'effective_to','')::date; if ef is null or (et is not null and et<ef) then raise exception 'Row %: invalid effective dates',n+1; end if;
  if p_kind='customer' then
   select id into cid from public.customers where company_id=c and lower(trim(name))=lower(trim(r->>'company')) and is_active limit 1;
   select id into tt from public.transport_truck_types where company_id=c and business_unit_id=b and lower(trim(name))=lower(trim(r->>'truck_type')) and is_active limit 1;
   select id into fl from public.transport_locations where company_id=c and business_unit_id=b and lower(trim(name))=lower(trim(r->>'from')) and is_active limit 1;
   select id into tl from public.transport_locations where company_id=c and business_unit_id=b and lower(trim(name))=lower(trim(r->>'to')) and is_active limit 1; amt:=(r->>'amount')::numeric;
   if cid is null or tt is null or fl is null or tl is null or amt<0 then raise exception 'Row %: customer/truck/route/rate not valid',n+1; end if;
   perform pg_advisory_xact_lock(hashtextextended(c::text||b::text||cid::text||tt::text||fl::text||tl::text,0));
   if exists(select 1 from public.transport_customer_rates x where x.company_id=c and x.business_unit_id=b and x.customer_id=cid and x.truck_type_id=tt and x.from_location_id=fl and x.to_location_id=tl and x.is_active and daterange(x.effective_from,coalesce(x.effective_to+1,'infinity'::date),'[)') && daterange(ef,coalesce(et+1,'infinity'::date),'[)')) then raise exception 'Row %: customer rate period overlaps existing rate',n+1; end if;
   insert into public.transport_customer_rates(company_id,business_unit_id,customer_id,truck_type_id,from_location_id,to_location_id,amount,effective_from,effective_to,is_active,created_by) values(c,b,cid,tt,fl,tl,amt,ef,et,true,auth.uid());
  elsif p_kind='supplier' then
   select id into pid from public.suppliers where company_id=c and lower(trim(name))=lower(trim(r->>'supplier')) and is_active limit 1;
   select id into tt from public.transport_truck_types where company_id=c and business_unit_id=b and lower(trim(name))=lower(trim(r->>'truck_type')) and is_active limit 1;
   select id into fl from public.transport_locations where company_id=c and business_unit_id=b and lower(trim(name))=lower(trim(r->>'from')) and is_active limit 1;
   select id into tl from public.transport_locations where company_id=c and business_unit_id=b and lower(trim(name))=lower(trim(r->>'to')) and is_active limit 1; amt:=(r->>'amount')::numeric;
   if pid is null or tt is null or fl is null or tl is null or amt<0 then raise exception 'Row %: supplier/truck/route/rate not valid',n+1; end if;
   perform pg_advisory_xact_lock(hashtextextended(c::text||b::text||pid::text||tt::text||fl::text||tl::text,0));
   if exists(select 1 from public.transport_supplier_rates x where x.company_id=c and x.business_unit_id=b and x.supplier_id=pid and x.truck_type_id=tt and x.from_location_id=fl and x.to_location_id=tl and x.is_active and daterange(x.effective_from,coalesce(x.effective_to+1,'infinity'::date),'[)') && daterange(ef,coalesce(et+1,'infinity'::date),'[)')) then raise exception 'Row %: supplier rate period overlaps existing rate',n+1; end if;
   insert into public.transport_supplier_rates(company_id,business_unit_id,supplier_id,truck_type_id,from_location_id,to_location_id,amount,effective_from,effective_to,is_active,created_by) values(c,b,pid,tt,fl,tl,amt,ef,et,true,auth.uid());
  else
   select id into cid from public.customers where company_id=c and lower(trim(name))=lower(trim(r->>'company')) and is_active limit 1;
   select id into ct from public.transport_charge_types where company_id=c and business_unit_id=b and lower(trim(code))=lower(trim(r->>'charge_code')) and is_active limit 1;
   stat:=lower(coalesce(nullif(trim(r->>'status'),''),'agreed')); amt:=case when stat='pending' then null else (r->>'amount')::numeric end;
   if cid is null or ct is null or stat not in ('agreed','pending') or (stat='agreed' and (amt is null or amt<0)) then raise exception 'Row %: customer/charge/status/amount not valid',n+1; end if;
   perform public.transport_save_customer_charge_rate(null,cid,ct,ef,et,amt,stat,true);
  end if; n:=n+1;
 end loop; return jsonb_build_object('imported',n);
end $$;
revoke execute on function public.transport_import_rate_rows(text,jsonb) from public,anon; grant execute on function public.transport_import_rate_rows(text,jsonb) to authenticated,service_role;