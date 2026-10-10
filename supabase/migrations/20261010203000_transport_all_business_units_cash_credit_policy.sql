-- Extend customer-level Cash/Credit exclusivity from Orbit to every active Transport
-- business unit, including units created later. Non-Transport invoicing is unchanged.
-- Existing invoice rows are never rewritten; only unambiguous active history is seeded.
begin;

create or replace function public.transport_customer_billing_scope(p_company uuid,p_business_unit uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists (
   select 1 from public.business_units b
   where b.id=p_business_unit and b.company_id=p_company and b.unit_type='transport' and b.is_active
 );
$$;
revoke all on function public.transport_customer_billing_scope(uuid,uuid) from public,anon,authenticated;

create or replace function public.transport_assert_customer_billing_mode(
 p_company uuid,p_business_unit uuid,p_customer uuid,p_mode text
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare expected text;
begin
 if not public.transport_customer_billing_scope(p_company,p_business_unit) then return; end if;
 if p_customer is null or p_mode not in ('Cash','Credit') or p_mode is null then
  raise exception 'Customer and Cash/Credit are required for Transport billing';
 end if;
 -- Serialize configuration and invoice writes for the same customer and business unit.
 perform pg_advisory_xact_lock(hashtextextended(
   p_company::text||':'||p_business_unit::text||':'||p_customer::text||':billing_mode',0));
 select m.billing_mode into expected
 from public.transport_customer_billing_modes m
 where m.company_id=p_company and m.business_unit_id=p_business_unit and m.customer_id=p_customer
 for share;
 if expected is null then
  raise exception 'Customer Cash/Credit not configured. Set this Transport customer billing mode in Import Center before invoicing';
 end if;
 if expected<>p_mode then
  raise exception 'Customer Cash/Credit mismatch: customer is % Only, invoice is %',expected,p_mode;
 end if;
end $$;
revoke all on function public.transport_assert_customer_billing_mode(uuid,uuid,uuid,text) from public,anon,authenticated;

create or replace function public.transport_get_customer_billing_modes() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform public.assert_module_permission('sales','view');
 if not public.transport_customer_billing_scope(c,b) then
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

create or replace function public.transport_set_customer_billing_mode(p_customer_id uuid,p_mode text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();opposite_open bigint;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform public.assert_module_permission('sales','edit');
 if p_mode not in ('Cash','Credit') or p_mode is null then raise exception 'Choose Cash or Credit';end if;
 if not public.transport_customer_billing_scope(c,b) then
  raise exception 'Customer billing mode is only configured in active Transport business units';
 end if;
 if not exists(select 1 from public.customers where company_id=c and id=p_customer_id and is_active) then
  raise exception 'Active customer not found in current company';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(
   c::text||':'||b::text||':'||p_customer_id::text||':billing_mode',0));
 select count(*) into opposite_open from public.sales_orders
 where company_id=c and business_unit_id=b and customer_id=p_customer_id
   and status in ('draft','posted') and payment_mode<>p_mode;
 if opposite_open>0 then
  raise exception 'Cannot change customer mode: % existing draft/posted invoices use the opposite mode. Correct drafts first; posted history must remain intact',opposite_open;
 end if;
 insert into public.transport_customer_billing_modes(company_id,business_unit_id,customer_id,billing_mode,updated_by)
 values(c,b,p_customer_id,p_mode,auth.uid())
 on conflict(company_id,business_unit_id,customer_id) do update
 set billing_mode=excluded.billing_mode,updated_by=excluded.updated_by,updated_at=now();
 return jsonb_build_object('customer_id',p_customer_id,'mode',p_mode,'status','saved');
end $$;
revoke all on function public.transport_set_customer_billing_mode(uuid,text) from public,anon;
grant execute on function public.transport_set_customer_billing_mode(uuid,text) to authenticated;

-- Fill only unequivocal Cash/Credit history in each distinct Transport business unit.
insert into public.transport_customer_billing_modes(company_id,business_unit_id,customer_id,billing_mode)
select s.company_id,s.business_unit_id,s.customer_id,min(s.payment_mode)
from public.sales_orders s
join public.business_units b
 on b.id=s.business_unit_id and b.company_id=s.company_id
 and b.unit_type='transport' and b.is_active
where s.customer_id is not null and s.payment_mode in ('Cash','Credit')
  and s.status in ('draft','posted')
group by s.company_id,s.business_unit_id,s.customer_id
having count(distinct s.payment_mode)=1
on conflict(company_id,business_unit_id,customer_id) do nothing;

-- Original Orbit-specific scope registry is retained as historical metadata.
-- The active policy now follows unit_type='transport' rather than registry rows.
notify pgrst,'reload schema';
commit;
