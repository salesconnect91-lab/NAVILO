-- Orbit customer Cash/Credit policy; isolated to enabled Transport business units.
-- Existing posted/draft invoices are untouched. A new service invoice requires an approved customer mode.
begin;

create table public.transport_customer_billing_enforcement (
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  enabled boolean not null default true,
  primary key(company_id,business_unit_id)
);
alter table public.transport_customer_billing_enforcement enable row level security;
revoke all on public.transport_customer_billing_enforcement from public,anon,authenticated;

create table public.transport_customer_billing_modes (
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  billing_mode text not null check (billing_mode in ('Cash','Credit')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key(company_id,business_unit_id,customer_id)
);
create index transport_customer_billing_modes_customer_idx on public.transport_customer_billing_modes(customer_id);
alter table public.transport_customer_billing_modes enable row level security;
revoke all on public.transport_customer_billing_modes from public,anon,authenticated;

-- Enable only the known Orbit Transport workspace, never Steel or unrelated Transport companies.
insert into public.transport_customer_billing_enforcement(company_id,business_unit_id,enabled)
select b.company_id,b.id,true
from public.business_units b join public.companies c on c.id=b.company_id
where lower(btrim(b.name))='orbit' and lower(btrim(c.name))='orbit - usman sajjad'
  and b.unit_type='transport'
on conflict(company_id,business_unit_id) do nothing;

-- Preserve unanimous existing invoice classification; never guess a mode where history is mixed.
insert into public.transport_customer_billing_modes(company_id,business_unit_id,customer_id,billing_mode)
select s.company_id,s.business_unit_id,s.customer_id,min(s.payment_mode)
from public.sales_orders s
join public.transport_customer_billing_enforcement e
  on e.company_id=s.company_id and e.business_unit_id=s.business_unit_id and e.enabled
where s.customer_id is not null and s.payment_mode in ('Cash','Credit')
group by s.company_id,s.business_unit_id,s.customer_id
having count(distinct s.payment_mode)=1
on conflict(company_id,business_unit_id,customer_id) do nothing;

create function public.transport_assert_customer_billing_mode(
  p_company uuid,p_business_unit uuid,p_customer uuid,p_mode text
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare expected text;
begin
 if not exists(select 1 from public.transport_customer_billing_enforcement
               where company_id=p_company and business_unit_id=p_business_unit and enabled) then return; end if;
 if p_customer is null or p_mode not in ('Cash','Credit') or p_mode is null then
   raise exception 'Customer and Cash/Credit are required for Orbit billing';
 end if;
 select m.billing_mode into expected
 from public.transport_customer_billing_modes m
 where m.company_id=p_company and m.business_unit_id=p_business_unit and m.customer_id=p_customer
 for share;
 if expected is null then
   raise exception 'Customer Cash/Credit not configured. Set the customer billing mode in Import Center before invoicing';
 end if;
 if expected<>p_mode then
   raise exception 'Customer Cash/Credit mismatch: customer is % Only, invoice is %',expected,p_mode;
 end if;
end $$;
revoke all on function public.transport_assert_customer_billing_mode(uuid,uuid,uuid,text) from public,anon,authenticated;

create function public.transport_guard_sales_customer_billing_mode() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE'
   and new.customer_id is not distinct from old.customer_id
   and new.payment_mode is not distinct from old.payment_mode
   and new.company_id is not distinct from old.company_id
   and new.business_unit_id is not distinct from old.business_unit_id
   and new.document_kind is not distinct from old.document_kind then return new; end if;
 if new.document_kind='service' and exists (
  select 1 from public.business_units b where b.id=new.business_unit_id and b.company_id=new.company_id and b.unit_type='transport'
 ) then
   perform public.transport_assert_customer_billing_mode(new.company_id,new.business_unit_id,new.customer_id,new.payment_mode);
 end if;
 return new;
end $$;
revoke all on function public.transport_guard_sales_customer_billing_mode() from public,anon,authenticated;
create trigger zzzzz_transport_customer_billing_mode_guard
before insert or update of company_id,business_unit_id,customer_id,payment_mode,document_kind
on public.sales_orders for each row execute function public.transport_guard_sales_customer_billing_mode();

create function public.transport_get_customer_billing_modes() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 perform public.assert_module_permission('sales','view');
 if not exists(select 1 from public.transport_customer_billing_enforcement
               where company_id=c and business_unit_id=b and enabled) then
   return jsonb_build_object('enabled',false,'rows','[]'::jsonb);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',cu.id,'name',cu.name,'mode',m.billing_mode,
  'cash_invoices',(select count(*) from public.sales_orders s where s.company_id=c and s.business_unit_id=b and s.customer_id=cu.id and s.payment_mode='Cash'),
  'credit_invoices',(select count(*) from public.sales_orders s where s.company_id=c and s.business_unit_id=b and s.customer_id=cu.id and s.payment_mode='Credit')
 ) order by cu.name),'[]'::jsonb) into result
 from public.customers cu left join public.transport_customer_billing_modes m
  on m.company_id=c and m.business_unit_id=b and m.customer_id=cu.id
 where cu.company_id=c and cu.is_active;
 return jsonb_build_object('enabled',true,'rows',result);
end $$;
revoke all on function public.transport_get_customer_billing_modes() from public,anon;
grant execute on function public.transport_get_customer_billing_modes() to authenticated;

create function public.transport_set_customer_billing_mode(p_customer_id uuid,p_mode text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id(); opposite_posted bigint;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform public.assert_module_permission('sales','edit');
 if p_mode not in ('Cash','Credit') or p_mode is null then raise exception 'Choose Cash or Credit';end if;
 if not exists(select 1 from public.transport_customer_billing_enforcement where company_id=c and business_unit_id=b and enabled)
 then raise exception 'Billing mode policy is not enabled for this Transport workspace'; end if;
 if not exists(select 1 from public.customers where company_id=c and id=p_customer_id and is_active) then
   raise exception 'Active customer not found in current company';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text||':'||b::text||':'||p_customer_id::text||':billing_mode',0));
 select count(*) into opposite_posted from public.sales_orders
 where company_id=c and business_unit_id=b and customer_id=p_customer_id and status='posted' and payment_mode<>p_mode;
 if opposite_posted>0 then raise exception 'Cannot change customer mode: % opposite-mode posted invoices need accounting review',opposite_posted;end if;
 insert into public.transport_customer_billing_modes(company_id,business_unit_id,customer_id,billing_mode,updated_by)
 values(c,b,p_customer_id,p_mode,auth.uid())
 on conflict(company_id,business_unit_id,customer_id) do update
 set billing_mode=excluded.billing_mode,updated_by=excluded.updated_by,updated_at=now();
 return jsonb_build_object('customer_id',p_customer_id,'mode',p_mode,'status','saved');
end $$;
revoke all on function public.transport_set_customer_billing_mode(uuid,text) from public,anon;
grant execute on function public.transport_set_customer_billing_mode(uuid,text) to authenticated;

-- Retain existing source validation, with additional customer-policy checks; existing VAT rules are preserved.
create or replace function public.transport_preview_external_invoices(p_source_company text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
x jsonb;st text;reason text;cid uuid;dt date;tax numeric;amt numeric;output jsonb:='[]';
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform public.assert_module_permission('sales','create');
 if c is null or b is null or loc is null or not exists(select 1 from public.business_units where id=b and company_id=c and unit_type='transport' and is_active)
 then raise exception 'Active Transport workspace and branch required';end if;
 if nullif(btrim(p_source_company),'') is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then
 raise exception 'Source Company and 1 to 500 lines required';end if;
 for x in select value from jsonb_array_elements(p_rows) loop
  st:='New';reason:='';cid:=null;
  begin
   dt:=(x->>'invoice_date')::date;amt:=(x->>'amount')::numeric;tax:=(x->>'tax_percent')::numeric;
   if dt is null or amt is null or amt<=0 or amt<>round(amt,2) or tax is null or tax not between 0 and 100
    or nullif(btrim(x->>'source_reference'),'') is null or nullif(btrim(x->>'description'),'') is null
    or x->>'sale_type' not in ('Cash','Credit') or x->>'sale_type' is null then
    raise exception 'Date, positive two-decimal Amount, Reference, Description and Cash/Credit required';end if;
   if (x->>'sale_type'='Cash' and tax<>0) or (x->>'sale_type'='Credit' and (tax<=0 or nullif(btrim(x->>'invoice_no'),'') is null)) then raise exception 'Credit requires Invoice No and VAT; Cash requires zero VAT';end if;
   if coalesce((x->>'tax_amount')::numeric,-1)<>round(amt*tax/100,2)
      or coalesce((x->>'bill_amount')::numeric,-1)<>amt+round(amt*tax/100,2) then
      raise exception 'Source net, VAT and gross do not reconcile';end if;
   if tax>0 and public.fixed_tax_rate_on(c,'sales',dt) is null then
     raise exception 'No active Sales VAT rate for invoice date. Configure VAT in Tax Settings';end if;
   if tax>0 and tax is distinct from public.fixed_tax_rate_on(c,'sales',dt) then
     raise exception 'Source VAT does not match effective invoice-date VAT rate';end if;
   if (select count(*) from public.customers where company_id=c and is_active and lower(btrim(name))=lower(btrim(x->>'customer')))<>1 then
     raise exception 'Customer must match exactly one active master';end if;
   select id into cid from public.customers where company_id=c and is_active and lower(btrim(name))=lower(btrim(x->>'customer'));
   perform public.transport_assert_customer_billing_mode(c,b,cid,x->>'sale_type');
   if (select count(*) from public.transport_vehicles where company_id=c and business_unit_id=b and is_active
       and lower(btrim(vehicle_no))=lower(btrim(x->>'vehicle_no')))<>1 then
       raise exception 'Vehicle must match exactly one active master';end if;
   if (select count(*) from jsonb_array_elements(p_rows) y where lower(btrim(y->>'source_reference'))=lower(btrim(x->>'source_reference')))<>1 then
       raise exception 'Duplicate source reference in file';end if;
   if nullif(btrim(x->>'invoice_no'),'') is not null and exists(
     select 1 from jsonb_array_elements(p_rows) y where lower(btrim(y->>'invoice_no'))=lower(btrim(x->>'invoice_no'))
     and (lower(btrim(y->>'customer')) is distinct from lower(btrim(x->>'customer'))
     or y->>'invoice_date' is distinct from x->>'invoice_date' or y->>'sale_type' is distinct from x->>'sale_type'
     or (y->>'tax_percent')::numeric is distinct from tax)) then
       raise exception 'Invoice lines disagree on Customer, Date, Cash/Credit or VAT';end if;
   if exists(select 1 from public.transport_external_invoice_lines e where e.company_id=c and e.business_unit_id=b
      and e.source_company=lower(btrim(p_source_company)) and e.source_reference=lower(btrim(x->>'source_reference')))
     or exists(select 1 from public.transport_trips t where t.company_id=c and t.business_unit_id=b
      and lower(btrim(t.transport_source_company))=lower(btrim(p_source_company))
      and lower(btrim(t.transport_source_trip_id))=lower(btrim(x->>'reference_trip_no')) and t.sales_order_id is not null)
       then st:='Duplicate';reason:='Source line is already billed';
   elsif nullif(btrim(x->>'invoice_no'),'') is not null and exists(select 1 from public.sales_orders
     where company_id=c and business_unit_id=b and lower(btrim(order_no))=lower(btrim(x->>'invoice_no')))
       then st:='Duplicate';reason:='Invoice number already exists';end if;
  exception when others then st:='Error';reason:=sqlerrm;end;
  output:=output||jsonb_build_array(x||jsonb_build_object('import_status',st,'import_reason',reason));
 end loop;
 return jsonb_build_object('rows',output);
end $$;
revoke all on function public.transport_preview_external_invoices(text,jsonb) from public,anon;
grant execute on function public.transport_preview_external_invoices(text,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
