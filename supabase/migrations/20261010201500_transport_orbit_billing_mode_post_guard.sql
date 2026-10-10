-- Close draft-to-post loophole for Orbit customer Cash/Credit policy.
-- Preserve all existing invoice rows; only prevent inconsistent future transitions.
begin;
create or replace function public.transport_set_customer_billing_mode(p_customer_id uuid,p_mode text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();opposite_open bigint;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform public.assert_module_permission('sales','edit');
 if p_mode not in ('Cash','Credit') or p_mode is null then raise exception 'Choose Cash or Credit';end if;
 if not exists(select 1 from public.transport_customer_billing_enforcement where company_id=c and business_unit_id=b and enabled)
 then raise exception 'Billing mode policy is not enabled for this Transport workspace'; end if;
 if not exists(select 1 from public.customers where company_id=c and id=p_customer_id and is_active) then
   raise exception 'Active customer not found in current company';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text||':'||b::text||':'||p_customer_id::text||':billing_mode',0));
 select count(*) into opposite_open from public.sales_orders
 where company_id=c and business_unit_id=b and customer_id=p_customer_id
   and status in ('draft','posted') and payment_mode<>p_mode;
 if opposite_open>0 then
   raise exception 'Cannot change customer mode: % existing draft/posted invoices use the opposite mode. Cancel or correct drafts first; posted history must remain intact',opposite_open;
 end if;
 insert into public.transport_customer_billing_modes(company_id,business_unit_id,customer_id,billing_mode,updated_by)
 values(c,b,p_customer_id,p_mode,auth.uid())
 on conflict(company_id,business_unit_id,customer_id) do update
 set billing_mode=excluded.billing_mode,updated_by=excluded.updated_by,updated_at=now();
 return jsonb_build_object('customer_id',p_customer_id,'mode',p_mode,'status','saved');
end $$;
revoke all on function public.transport_set_customer_billing_mode(uuid,text) from public,anon;
grant execute on function public.transport_set_customer_billing_mode(uuid,text) to authenticated;

-- Status-only posting updates must re-check billing mode, without affecting cancellations/reversals.
create or replace function public.transport_guard_sales_customer_billing_mode() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE'
   and new.customer_id is not distinct from old.customer_id
   and new.payment_mode is not distinct from old.payment_mode
   and new.company_id is not distinct from old.company_id
   and new.business_unit_id is not distinct from old.business_unit_id
   and new.document_kind is not distinct from old.document_kind
   and not (new.status='posted' and old.status is distinct from new.status) then return new;end if;
 if new.document_kind='service' and exists (
  select 1 from public.business_units b where b.id=new.business_unit_id and b.company_id=new.company_id and b.unit_type='transport'
 ) then
   perform public.transport_assert_customer_billing_mode(new.company_id,new.business_unit_id,new.customer_id,new.payment_mode);
 end if;
 return new;
end $$;
revoke all on function public.transport_guard_sales_customer_billing_mode() from public,anon,authenticated;
drop trigger if exists zzzzz_transport_customer_billing_mode_guard on public.sales_orders;
create trigger zzzzz_transport_customer_billing_mode_guard
before insert or update of company_id,business_unit_id,customer_id,payment_mode,document_kind,status
on public.sales_orders for each row execute function public.transport_guard_sales_customer_billing_mode();
commit;
