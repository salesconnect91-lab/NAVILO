-- Transport-only source of truth for trip sale mode and canonical service invoices.
-- No historical trips or posted financial documents are rewritten.
create or replace function public.transport_trip_customer_sale_type(p_company uuid,p_business_unit uuid,p_customer uuid)
returns text language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_mode text;
begin
 if auth.uid() is null or p_company is distinct from public.current_company_id()
    or p_business_unit is distinct from public.current_business_unit_id()
    or not public.transport_customer_billing_scope(p_company,p_business_unit)
 then raise exception 'Active Transport business is required for customer billing mode';end if;
 if p_customer is null then raise exception 'Select a customer before creating the Trip';end if;
 perform pg_advisory_xact_lock(hashtextextended(
   p_company::text||':'||p_business_unit::text||':'||p_customer::text||':billing_mode',0));
 select lower(m.billing_mode) into v_mode
 from public.transport_customer_billing_modes m
 join public.customers c on c.id=m.customer_id and c.company_id=p_company and c.is_active
 where m.company_id=p_company and m.business_unit_id=p_business_unit and m.customer_id=p_customer;
 if v_mode not in ('cash','credit') or v_mode is null then
  raise exception 'Customer Cash/Credit not configured. Set Billing Rules in Transport Customer Master before adding a Trip';
 end if;
 return v_mode;
end $$;
revoke all on function public.transport_trip_customer_sale_type(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.transport_trip_customer_modes()
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();v jsonb;
begin
 if auth.uid() is null or not public.transport_customer_billing_scope(c,b)
    or not (public.has_module_permission(c,'transport','view') or public.has_module_permission(c,'transport','create'))
 then raise exception 'Transport access required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',cu.id,'mode',m.billing_mode) order by cu.name),'[]'::jsonb)
 into v from public.customers cu
 left join public.transport_customer_billing_modes m
 on m.company_id=c and m.business_unit_id=b and m.customer_id=cu.id
 where cu.company_id=c and cu.is_active;
 return v;
end $$;
revoke all on function public.transport_trip_customer_modes() from public,anon;
grant execute on function public.transport_trip_customer_modes() to authenticated;

create or replace function public.transport_trip_customer_mode_guard()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_mode text;
begin
 if not public.transport_customer_billing_scope(new.company_id,new.business_unit_id) then return new;end if;
 if tg_op='UPDATE'
    and new.customer_id is not distinct from old.customer_id
    and new.sale_type is not distinct from old.sale_type then return new;end if;
 v_mode:=public.transport_trip_customer_sale_type(new.company_id,new.business_unit_id,new.customer_id);
 if tg_op='INSERT' then
  if new.sale_type is not null and new.sale_type<>v_mode then
   raise exception 'Trip mode mismatch. Customer is % Only',initcap(v_mode);
  end if;
 elsif new.customer_id is not distinct from old.customer_id and new.sale_type is distinct from v_mode then
  raise exception 'Trip mode is fixed by Customer Master: % Only',initcap(v_mode);
 end if;
 new.sale_type:=v_mode;
 return new;
end $$;
drop trigger if exists zzz_transport_trip_customer_mode_guard on public.transport_trips;
create trigger zzz_transport_trip_customer_mode_guard
before insert or update of customer_id,sale_type on public.transport_trips
for each row execute function public.transport_trip_customer_mode_guard();

-- Patch exact forward-only functions without dropping/rebuilding historical logic.
do $$
declare definition text;old_text text;new_text text;
begin
 select pg_get_functiondef(p.oid) into definition from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='transport_create_trips';
 old_text:='sale:=row_data->>''sale_type'';ppr:=';
 new_text:='ppr:=';
 if position(old_text in definition)=0 then raise exception 'transport_create_trips classification anchor changed';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:='  if sale is null or sale not in (''cash'',''credit'') then raise exception ''Sale Type must be Cash or Credit'';end if;';
 if position(old_text in definition)=0 then raise exception 'transport_create_trips validation anchor changed';end if;
 definition:=replace(definition,old_text,'');
 old_text:='  if not found then raise exception ''Active same-company Customer required'';end if;';
 new_text:=old_text||E'\n  sale:=public.transport_trip_customer_sale_type(c,b,customer.id);'
 ||E'\n  if nullif(row_data->>''sale_type'','''') is not null and row_data->>''sale_type''<>sale'
 ||E'\n  then raise exception ''Customer Master billing mode disagrees with uploaded Trip mode'';end if;';
 if position(old_text in definition)=0 then raise exception 'transport_create_trips customer anchor changed';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;

 select pg_get_functiondef(p.oid) into definition from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='transport_create_charged_service_document_accounted';
 old_text:='tax,base,1,''service'',''Credit''';
 new_text:='tax,base,1,''service'',coalesce('
 || '(select initcap(t.sale_type) from public.transport_trips t where t.id=p_trip_id and t.company_id=c and t.business_unit_id=b),'
 || '(select m.billing_mode from public.transport_customer_billing_modes m where m.company_id=c and m.business_unit_id=b and m.customer_id=p_party),'
 || '''Credit'')';
 if position(old_text in definition)=0 then raise exception 'charged service posting mode anchor changed';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;

 select pg_get_functiondef(p.oid) into definition from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='transport_post_customer_bill_grouped';
 old_text:='v_tax,v_base_currency,1,''service'',''Credit''';
 new_text:='v_tax,v_base_currency,1,''service'',initcap(v_sale_type)';
 if position(old_text in definition)=0 then raise exception 'grouped service posting mode anchor changed';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;

 select pg_get_functiondef(p.oid) into definition from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='transport_assert_customer_billing_mode';
 old_text:='in Import Center before invoicing';
 if position(old_text in definition)=0 then raise exception 'billing error message anchor changed';end if;
 definition:=replace(definition,old_text,'in Transport Customer Master before invoicing');
 execute definition;
end $$;

notify pgrst,'reload schema';
