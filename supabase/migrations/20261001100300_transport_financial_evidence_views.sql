begin;
-- security_invoker views require underlying SELECT as well as RLS policies.
-- Fail safely rather than grant access to an unprotected canonical relation.
do $$ declare relation_name text;begin
 foreach relation_name in array array['sales_orders','purchase_orders','return_notes','journal_entries','invoice_payment_allocations','purchase_payment_allocations','employee_salary_accruals','employee_salary_payments','customers','suppliers','user_profiles'] loop
 if not exists(select 1 from pg_class r join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and r.relname=relation_name and r.relrowsecurity) then raise exception 'Required canonical RLS missing: %',relation_name;end if;
 execute format('grant select on public.%I to authenticated',relation_name);
 end loop;
end $$;
-- A posted journal counts only while no posted canonical reversal exists.
create view public.transport_active_journals with(security_invoker=true) as
select j.* from public.journal_entries j where j.status='posted'
and not exists(select 1 from public.journal_entries r where r.reversal_of_entry_id=j.id and r.status='posted');
revoke all on public.transport_active_journals from public,anon;grant select on public.transport_active_journals to authenticated;
create view public.transport_service_document_balances with(security_invoker=true) as
with sources as (
 select 'customer'::text side,s.id order_id,s.company_id,s.business_unit_id,s.operating_location_id,s.customer_id party_id,s.order_no,s.order_date,
 s.total original_gross,s.tax_percent,coalesce((select sum(amount) from public.sales_service_lines where order_id=s.id),0) original_net
 from public.sales_orders s join public.transport_customer_documents d on d.sales_order_id=s.id join public.transport_active_journals j on j.id=d.journal_entry_id where s.status='posted'
 union all
 select 'supplier',p.id,p.company_id,p.business_unit_id,p.operating_location_id,p.supplier_id,p.order_no,p.order_date,p.total,p.tax_percent,
 coalesce((select sum(amount) from public.purchase_service_lines where order_id=p.id),0)
 from public.purchase_orders p where p.status='posted' and (exists(select 1 from public.transport_supplier_documents d join public.transport_active_journals j on j.id=d.journal_entry_id where d.purchase_order_id=p.id)
 or exists(select 1 from public.transport_service_cost_links d join public.transport_active_journals j on j.id=d.journal_entry_id where d.purchase_order_id=p.id))
), amounts as (
 select s.*,coalesce(n.net,0) credited_net,coalesce(n.gross,0) credited_gross,coalesce(a.paid,0) paid_gross,coalesce(a.last_date,null) last_payment_date,
 coalesce(f.refunded,0) refunded_gross
 from sources s
 left join lateral(select sum(n.net_amount) net,sum(n.net_amount+n.vat_amount) gross
 from public.transport_service_note_lines n join public.return_notes rn on rn.id=n.note_id join public.transport_active_journals j on j.id=rn.journal_entry_id
 where n.side=s.side and n.order_id=s.order_id and rn.status='posted') n on true
 left join lateral(
 select sum(amount) paid,max(allocation_date) last_date from (
 select a.amount,a.allocation_date from public.invoice_payment_allocations a join public.transport_active_journals j on j.id=a.journal_entry_id where s.side='customer' and a.sales_order_id=s.order_id
 union all
 select a.amount,a.allocation_date from public.purchase_payment_allocations a join public.transport_active_journals j on j.id=a.journal_entry_id where s.side='supplier' and a.purchase_order_id=s.order_id) a
 ) a on true
 left join lateral(select sum(f.amount) refunded from public.transport_service_refunds f join public.transport_active_journals j on j.id=f.journal_entry_id where f.side=s.side and f.order_id=s.order_id) f on true
)
select *,original_net-credited_net billed_net,original_gross-credited_gross billed_gross,
 round((paid_gross-refunded_gross)*original_net/nullif(original_gross,0),2) paid_net,
 greatest(round(original_gross-credited_gross-paid_gross+refunded_gross,2),0) outstanding_gross,
 greatest(round(paid_gross-refunded_gross-original_gross+credited_gross,2),0) credit_gross,
 greatest(round(original_net-credited_net-(paid_gross-refunded_gross)*original_net/nullif(original_gross,0),2),0) outstanding_net
from amounts;
revoke all on public.transport_service_document_balances from public,anon;grant select on public.transport_service_document_balances to authenticated;

create view public.transport_trip_financial_summary with(security_invoker=true) as
with evidence as (
 select t.id,t.company_id,t.business_unit_id,
 coalesce(c.net,0) customer_net,coalesce(c.gross,0) customer_gross,coalesce(c.paid_net,0) customer_received_net,coalesce(c.paid_gross,0) customer_received_gross,
 coalesce(c.outstanding,0) customer_outstanding_gross,coalesce(c.outstanding_net,0) customer_outstanding_net,coalesce(c.credit,0) customer_credit_gross,coalesce(c.docs,0) customer_documents,
 coalesce(s.net,0) supplier_net,coalesce(s.gross,0) supplier_gross,coalesce(s.paid_net,0) supplier_paid_net,coalesce(s.paid_gross,0) supplier_paid_gross,
 coalesce(s.outstanding,0) supplier_outstanding_gross,coalesce(s.credit,0) supplier_credit_gross,s.last_date supplier_payment_date,
 coalesce(dr.accrued,0) driver_accrued,coalesce(dp.paid,0) driver_paid,
 greatest(t.driver_pay-coalesce(dp.paid,0),0) driver_outstanding,
 coalesce(costs.net,0) other_cost_net,coalesce(costs.commission_paid,0) commission_paid_net,
 coalesce(costs.required_outstanding,0) required_cost_outstanding,
 exists(select 1 from public.transport_trip_supplier_rents where trip_id=t.id) structured_rents,
 exists(select 1 from public.transport_trip_supplier_rents r where r.trip_id=t.id and not exists(select 1 from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.transport_active_journals j on j.id=d.journal_entry_id where l.rent_id=r.id and not l.is_adjustment)) unbilled_rent,
 t.customer_rate original_customer_rate,t.owner_rent legacy_owner_rent,t.driver_pay agreed_driver_pay,t.status operational_status,t.job_status,
 (t.sales_order_id is not null or exists(select 1 from public.transport_customer_document_trips where trip_id=t.id)) customer_rate_locked,
 exists(select 1 from public.transport_supplier_document_rents where trip_id=t.id) supplier_rate_locked
 from public.transport_trips t
 left join lateral(select sum(b.billed_net) net,sum(b.billed_gross) gross,sum(b.paid_net) paid_net,sum(b.paid_gross-b.refunded_gross) paid_gross,
 sum(b.outstanding_gross) outstanding,sum(b.outstanding_net) outstanding_net,sum(b.credit_gross) credit,count(*) docs
 from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id
 join public.transport_service_document_balances b on b.side='customer' and b.order_id=d.sales_order_id where l.trip_id=t.id) c on true
 left join lateral(select sum(b.billed_net) net,sum(b.billed_gross) gross,sum(b.paid_net) paid_net,sum(b.paid_gross-b.refunded_gross) paid_gross,
 sum(b.outstanding_gross) outstanding,sum(b.credit_gross) credit,max(b.last_payment_date) last_date
 from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id
 join public.transport_service_document_balances b on b.side='supplier' and b.order_id=d.purchase_order_id where l.trip_id=t.id) s on true
 left join lateral(select sum(a.amount) accrued from public.transport_driver_accrual_attributions a
 join public.employee_salary_accruals p on p.id=a.accrual_id join public.transport_active_journals j on j.id=p.journal_entry_id where a.trip_id=t.id) dr on true
 left join lateral(select sum(a.amount) paid from public.transport_driver_payment_attributions a
 join public.employee_salary_payments p on p.id=a.salary_payment_id join public.transport_active_journals j on j.id=p.journal_entry_id where a.trip_id=t.id) dp on true
 left join lateral(select sum(b.billed_net) net,sum(b.paid_net) filter(where x.cost_kind='commission') commission_paid,
 sum(b.outstanding_gross+b.credit_gross) required_outstanding
 from public.transport_service_cost_links x join public.transport_service_document_balances b on b.side='supplier' and b.order_id=x.purchase_order_id where x.trip_id=t.id) costs on true
)
select *,case when customer_documents=0 then null else customer_net-supplier_net-driver_accrued-other_cost_net end posted_profit,
 case when operational_status='cancelled' then 'Cancelled'
 when customer_documents>0 and operational_status in ('completed','ready_to_invoice','invoiced','paid') and job_status='completed'
 and customer_outstanding_gross<=0.005 and customer_credit_gross<=0.005 and supplier_outstanding_gross<=0.005 and supplier_credit_gross<=0.005
 and driver_outstanding<=0.005 and driver_accrued>=agreed_driver_pay-0.005 and not unbilled_rent
 and (legacy_owner_rent<=0 or structured_rents) and required_cost_outstanding<=0.005 then 'Closed'
 when customer_rate_locked or supplier_rate_locked or driver_accrued>0 or driver_paid>0 or other_cost_net>0 then 'Under Settlement'
 when operational_status='draft' then 'Draft'
 when original_customer_rate>0 and (legacy_owner_rent>0 or structured_rents) then 'Complete' else 'Not Complete' end financial_status
from evidence;
revoke all on public.transport_trip_financial_summary from public,anon;grant select on public.transport_trip_financial_summary to authenticated;

-- Keep the prior register view and its dependent consumers intact.
create view public.transport_financial_register with(security_invoker=true) as
select t.*,coalesce(c.name,t.customer_name_snapshot) customer_name,v.vehicle_no,coalesce(tt.name,t.truck_type,v.truck_type) truck_type_name,
 d.driver_name,coalesce(t.owner_name_snapshot,v.owner_name,s.name) owner_name,
 f.financial_status,f.customer_documents>0 invoiced,f.customer_rate_locked,f.supplier_rate_locked,
 case when f.customer_documents>0 then f.customer_net end billed_customer_net,
 case when f.customer_documents>0 then f.customer_received_net end received_from_company,
 case when f.customer_documents>0 then f.customer_outstanding_net end remaining_with_company,
 f.customer_received_gross,f.customer_outstanding_gross,f.customer_credit_gross,
 case when f.supplier_rate_locked then f.supplier_net end billed_supplier_net,
 case when f.supplier_rate_locked then f.supplier_paid_net end supplier_paid_net,
 f.supplier_outstanding_gross,f.supplier_credit_gross,
 case when f.driver_accrued>0 then f.driver_accrued end driver_accrued,
 f.driver_paid,f.driver_outstanding,
 case when f.customer_rate_locked or f.supplier_rate_locked then f.supplier_outstanding_gross+f.driver_outstanding end remaining_with_us,
 f.supplier_payment_date payment_date,
 case when f.supplier_rate_locked then f.supplier_paid_gross end payment_amount,
 f.posted_profit trip_profit,f.commission_paid_net,f.other_cost_net
from public.transport_trips t join public.transport_trip_financial_summary f on f.id=t.id
left join public.customers c on c.id=t.customer_id
left join public.transport_vehicles v on v.id=t.vehicle_id
left join public.transport_truck_types tt on tt.id=t.truck_type_id
left join public.transport_drivers d on d.id=t.driver_id
left join public.suppliers s on s.id=v.supplier_id
left join public.user_profiles u on u.id=t.ppr_received_by;
revoke all on public.transport_financial_register from public,anon;grant select on public.transport_financial_register to authenticated;

-- The old financial values and payer identities cannot be overwritten by Trip
-- Edit after attribution. Correction creates new documents; this guard has no bypass.
create function public.transport_posted_rate_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare effect boolean;
begin
 select exists(select 1 from public.transport_customer_document_trips where trip_id=old.id)
 or exists(select 1 from public.transport_supplier_document_rents where trip_id=old.id)
 or exists(select 1 from public.transport_driver_accrual_attributions where trip_id=old.id)
 or exists(select 1 from public.transport_driver_payment_attributions where trip_id=old.id)
 or exists(select 1 from public.transport_service_cost_links where trip_id=old.id)
 or old.sales_order_id is not null into effect;
 if tg_op='DELETE' then
 if old.status<>'draft' or effect then raise exception 'Only a Draft Trip without financial effect may be deleted'; end if;return old;end if;
 if (new.company_id,new.business_unit_id,new.trip_no) is distinct from (old.company_id,old.business_unit_id,old.trip_no)
 then raise exception 'Trip workspace and company-wide number are immutable'; end if;
 if exists(select 1 from public.transport_customer_document_trips where trip_id=old.id) or old.sales_order_id is not null then
 if (new.customer_id,new.sale_type,new.customer_rate,new.sales_order_id) is distinct from (old.customer_id,old.sale_type,old.customer_rate,old.sales_order_id)
 then raise exception 'Posted customer billing amounts and payer identity are read-only; use Rate Adjustment';end if;end if;
 if exists(select 1 from public.transport_supplier_document_rents where trip_id=old.id)
 and (new.owner_rent,new.supplier_rent) is distinct from(old.owner_rent,old.supplier_rent)
 then raise exception 'Posted supplier rates are read-only; use Rate Adjustment';end if;
 if new.driver_pay is distinct from old.driver_pay then perform public.transport_finance_assert('driver');end if;
 if effect and new.status='cancelled' then raise exception 'Financial Trip cannot be silently cancelled'; end if;
 if (new.driver_pay is distinct from old.driver_pay or new.driver_id is distinct from old.driver_id) and (exists(select 1 from public.transport_driver_accrual_attributions where trip_id=old.id) or exists(select 1 from public.transport_driver_payment_attributions where trip_id=old.id)) then raise exception 'Attributed driver obligation and identity are immutable';end if;
 if (new.customer_rate,new.owner_rent) is distinct from (old.customer_rate,old.owner_rent) and old.status<>'draft'
 then
 perform public.transport_finance_assert('adjustment');
 if nullif(btrim(new.notes),'') is null or new.notes is not distinct from old.notes then raise exception 'Completed unposted rate correction requires a new reason in Notes';end if;
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,event_type,old_data,new_data,changed_by) values(old.company_id,old.business_unit_id,old.id,'unposted_rate_correction',jsonb_build_object('customer_rate',old.customer_rate,'owner_rent',old.owner_rent),jsonb_build_object('customer_rate',new.customer_rate,'owner_rent',new.owner_rent,'customer_difference',new.customer_rate-old.customer_rate,'owner_difference',new.owner_rent-old.owner_rent,'reason',new.notes),auth.uid());end if;
 return new;
end $$;
revoke all on function public.transport_posted_rate_guard() from public,anon,authenticated;
create trigger zz_transport_posted_rate_guard before update or delete on public.transport_trips for each row execute function public.transport_posted_rate_guard();

-- Canonical receipt/payment entry points remain the source of all allocations.
-- Reject payment above a service document's net-of-credit outstanding even
-- though the legacy core validates only original invoice total.
alter function public.receive_customer_payment(uuid,date,uuid,text,text,text,text,jsonb,numeric) rename to receive_customer_payment_transport_preserved_core;
alter function public.pay_supplier(uuid,date,uuid,text,text,text,text,uuid,numeric) rename to pay_supplier_transport_preserved_core;
revoke all on function public.receive_customer_payment_transport_preserved_core(uuid,date,uuid,text,text,text,text,jsonb,numeric),public.pay_supplier_transport_preserved_core(uuid,date,uuid,text,text,text,text,uuid,numeric) from public,anon,authenticated;
-- Reproduced compatibility defect: current canonical base-currency receipts
-- and supplier payments label their journal lines source_currency, which the
-- current FX guard rejects. Correct that label only; retain FX arithmetic,
-- account validation, posting and allocation code verbatim.
do $$declare sig regprocedure;f text;begin
 foreach sig in array array[
 'public.receive_customer_payment_transport_preserved_core(uuid,date,uuid,text,text,text,text,jsonb,numeric)'::regprocedure,
 'public.pay_supplier_transport_preserved_core(uuid,date,uuid,text,text,text,text,uuid,numeric)'::regprocedure] loop
 select pg_get_functiondef(sig) into f;
 if position('v_currency' in f)=0 or position('v_base' in f)=0 or position(chr(39)||'source_currency'||chr(39) in f)=0
 then raise exception 'Canonical settlement FX contract changed; review compatibility correction';end if;
 f:=replace(f,chr(39)||'source_currency'||chr(39),
 'case when v_currency=v_base then ''base_currency'' else ''source_currency'' end');
 execute f;
 end loop;
end $$;
create function public.receive_customer_payment(p_customer_id uuid,p_payment_date date,p_payment_account_id uuid,p_payment_method text,
 p_reference text,p_description text,p_notes text,p_allocations jsonb,p_amount numeric default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record;balance numeric;out jsonb;
begin
 for r in select (value->>'sales_order_id')::uuid oid,sum((value->>'amount')::numeric) amount from jsonb_array_elements(p_allocations) group by 1 order by 1 loop
 if exists(select 1 from public.transport_customer_documents where sales_order_id=r.oid) then
 perform public.transport_finance_assert('settlement');
 perform 1 from public.sales_orders where id=r.oid for update;
 select outstanding_gross into balance from public.transport_service_document_balances where side='customer' and order_id=r.oid;
 if balance is null or r.amount>balance+0.005 then raise exception 'Receipt exceeds service document net outstanding'; end if;
 end if;end loop;
 out:=public.receive_customer_payment_transport_preserved_core(p_customer_id,p_payment_date,p_payment_account_id,p_payment_method,p_reference,p_description,p_notes,p_allocations,p_amount);
 for r in select distinct (value->>'sales_order_id')::uuid oid from jsonb_array_elements(p_allocations) loop perform public.transport_refresh_document_balance('customer',r.oid);end loop;
 return out;
end $$;
create function public.pay_supplier(p_supplier_id uuid,p_payment_date date,p_payment_account_id uuid,p_payment_method text,
 p_reference text,p_description text,p_notes text,p_purchase_order_id uuid,p_amount numeric) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare balance numeric;out jsonb;
begin
 if exists(select 1 from public.transport_supplier_documents where purchase_order_id=p_purchase_order_id)
 or exists(select 1 from public.transport_service_cost_links where purchase_order_id=p_purchase_order_id) then
 perform public.transport_finance_assert('settlement');perform 1 from public.purchase_orders where id=p_purchase_order_id for update;
 select outstanding_gross into balance from public.transport_service_document_balances where side='supplier' and order_id=p_purchase_order_id;
 if balance is null or p_amount>balance+0.005 then raise exception 'Payment exceeds service document net outstanding'; end if;
 end if;
 out:=public.pay_supplier_transport_preserved_core(p_supplier_id,p_payment_date,p_payment_account_id,p_payment_method,p_reference,p_description,p_notes,p_purchase_order_id,p_amount);
 perform public.transport_refresh_document_balance('supplier',p_purchase_order_id);
 return out;
end $$;
revoke all on function public.receive_customer_payment(uuid,date,uuid,text,text,text,text,jsonb,numeric),public.pay_supplier(uuid,date,uuid,text,text,text,text,uuid,numeric) from public,anon;
grant execute on function public.receive_customer_payment(uuid,date,uuid,text,text,text,text,jsonb,numeric),public.pay_supplier(uuid,date,uuid,text,text,text,text,uuid,numeric) to authenticated;
-- Rebind the legacy eight-argument overload to the guarded canonical entry point.
create or replace function public.receive_customer_payment(p_customer_id uuid,p_payment_date date,p_payment_account_id uuid,p_payment_method text,p_reference text,p_description text,p_notes text,p_allocations jsonb) returns jsonb
language sql security definer set search_path=public,pg_temp as $$select public.receive_customer_payment($1,$2,$3,$4,$5,$6,$7,$8,null::numeric)$$;
revoke all on function public.receive_customer_payment(uuid,date,uuid,text,text,text,text,jsonb) from public,anon;
grant execute on function public.receive_customer_payment(uuid,date,uuid,text,text,text,text,jsonb) to authenticated;

-- Explicit allocation, or FIFO only over attributed posted documents selected
-- by exact party/scope/document identity. No customer-level guessing.
create function public.transport_settle_documents(p_side text,p_party_id uuid,p_date date,p_account_id uuid,p_method text,
 p_allocations jsonb default null,p_fifo_amount numeric default null,p_reference text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record;alloc jsonb:=coalesce(p_allocations,'[]');left_amount numeric:=round(p_fifo_amount,2);a numeric;results jsonb:='[]';result jsonb;
begin
 perform public.transport_finance_assert('settlement');
 if p_side not in ('customer','supplier') then raise exception 'Customer/supplier settlement required'; end if;
 if p_fifo_amount is not null then
 if p_allocations is not null or left_amount<=0 then raise exception 'Choose explicit allocations or positive FIFO amount'; end if;
 -- Lock all eligible source documents consistently before computing balances.
 if p_side='customer' then perform 1 from public.sales_orders s join public.transport_customer_documents d on d.sales_order_id=s.id
 where d.customer_id=p_party_id and d.company_id=public.current_company_id() and d.business_unit_id=public.current_business_unit_id() and d.operating_location_id=public.current_operating_location_id() order by s.id for update of s;
 else perform 1 from public.purchase_orders p where supplier_id=p_party_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id()
 and (exists(select 1 from public.transport_supplier_documents where purchase_order_id=p.id) or exists(select 1 from public.transport_service_cost_links where purchase_order_id=p.id)) order by id for update;end if;
 for r in select * from public.transport_service_document_balances where side=p_side and party_id=p_party_id and company_id=public.current_company_id()
 and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id() and outstanding_gross>0 order by order_date,order_no,order_id loop
 a:=least(left_amount,r.outstanding_gross);if a>0 then alloc:=alloc||jsonb_build_array(jsonb_build_object('document_id',r.order_id,'amount',a));left_amount:=left_amount-a;end if;end loop;
 if left_amount>0.005 then raise exception 'FIFO amount exceeds eligible attributed documents'; end if;end if;
 if jsonb_typeof(alloc)<>'array' or jsonb_array_length(alloc)=0 then raise exception 'At least one document allocation required'; end if;
 for r in select (value->>'document_id')::uuid oid,sum((value->>'amount')::numeric) amount from jsonb_array_elements(alloc) group by 1 order by 1 loop
 if r.amount<=0 or not exists(select 1 from public.transport_service_document_balances where side=p_side and order_id=r.oid and party_id=p_party_id
 and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id()) then raise exception 'Allocation document outside selected party/workspace';end if;
 if p_side='customer' then
 results:=results||jsonb_build_array(jsonb_build_object('sales_order_id',r.oid,'amount',r.amount));
 else
 result:=public.pay_supplier(p_party_id,p_date,p_account_id,p_method,p_reference,'Transport Supplier Payment',null,r.oid,r.amount);results:=results||jsonb_build_array(result);
 end if;end loop;
 if p_side='customer' then result:=public.receive_customer_payment(p_party_id,p_date,p_account_id,p_method,p_reference,'Transport Customer Receipt',null,results,null::numeric);return result;end if;
 return jsonb_build_object('success',true,'payments',results);
end $$;
revoke all on function public.transport_settle_documents(text,uuid,date,uuid,text,jsonb,numeric,text) from public,anon;
grant execute on function public.transport_settle_documents(text,uuid,date,uuid,text,jsonb,numeric,text) to authenticated;

-- Refund/credit recovery is a canonical cash/AR/AP journal; the small table
-- records which service document it settles, not a second ledger.
create function public.transport_refund_service_credit(p_side text,p_order_id uuid,p_date date,p_cash_account_id uuid,p_amount numeric,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare b record;account uuid;party_name text;j uuid:=gen_random_uuid();u uuid:=public.legacy_data_user_id();c uuid:=public.current_company_id();
 bu uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
begin
 perform public.transport_finance_assert('settlement');
 if p_side='customer' then perform 1 from public.sales_orders where id=p_order_id for update;
 else perform 1 from public.purchase_orders where id=p_order_id for update;end if;
 select * into b from public.transport_service_document_balances where side=p_side and order_id=p_order_id and company_id=c and business_unit_id=bu and operating_location_id=loc;
 if not found or round(coalesce(p_amount,0),2)<=0 or round(p_amount,2)>b.credit_gross or nullif(btrim(p_reason),'') is null or p_date is null then raise exception 'Positive refund within current document credit and reason required'; end if;
 if not exists(select 1 from public.chart_of_accounts where id=p_cash_account_id and company_id=c and is_active and not is_group and allow_manual_entries and detail_type in ('Cash on Hand','Bank Account')) then raise exception 'Valid Cash/Bank account required'; end if;
 -- Reuse the original posted party account; do not remap after correction.
 if p_side='customer' then select jl.account_id into account from public.transport_customer_documents d join public.journal_lines jl on jl.entry_id=d.journal_entry_id where d.sales_order_id=p_order_id and jl.party_type='customer' and jl.party_id=b.party_id;
 select name into party_name from public.customers where id=b.party_id;
 else select jl.account_id into account from public.transport_supplier_documents d join public.journal_lines jl on jl.entry_id=d.journal_entry_id where d.purchase_order_id=p_order_id and jl.party_type='supplier' and jl.party_id=b.party_id;
 select name into party_name from public.suppliers where id=b.party_id;end if;
 insert into public.journal_entries(id,user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,party_name,trans_type,source_module,source_document_type,source_document_id)
 values(j,u,c,bu,loc,'TR-REF-'||substr(replace(j::text,'-',''),1,12),p_date,p_reason,'draft',party_name,
 case when p_side='customer' then 'Customer Service Refund' else 'Supplier Service Refund Received' end,'accounting','service_refund',p_order_id);
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name,amount_basis)
 select u,c,bu,loc,j,a.id,a.code||' - '||a.name,case when p_side='customer' then p_amount else 0 end,case when p_side='supplier' then p_amount else 0 end,p_side,b.party_id,party_name,'base_currency' from public.chart_of_accounts a where a.id=account;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,amount_basis)
 select u,c,bu,loc,j,a.id,a.code||' - '||a.name,case when p_side='supplier' then p_amount else 0 end,case when p_side='customer' then p_amount else 0 end,'base_currency' from public.chart_of_accounts a where a.id=p_cash_account_id;
 perform public.post_journal_entry(j);
 insert into public.transport_service_refunds(company_id,business_unit_id,side,order_id,journal_entry_id,amount,reason,created_by) values(c,bu,p_side,p_order_id,j,round(p_amount,2),p_reason,auth.uid());
 return jsonb_build_object('success',true,'journal_entry_id',j,'amount',p_amount);
end $$;
revoke all on function public.transport_refund_service_credit(text,uuid,date,uuid,numeric,text) from public,anon;
grant execute on function public.transport_refund_service_credit(text,uuid,date,uuid,numeric,text) to authenticated;

create function public.transport_complete_operations(p_trip_id uuid,p_reason text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;
begin
 perform public.transport_finance_assert('close');t:=public.transport_financial_trip(p_trip_id);
 if nullif(btrim(p_reason),'') is null then raise exception 'Operational completion reason required';end if;
 update public.transport_trips set status='completed',trip_status='completed',job_status='completed' where id=t.id;
 perform public.transport_financial_audit(t.id,'operational_completion',jsonb_build_object('reason',p_reason));
end $$;
revoke all on function public.transport_complete_operations(uuid,text) from public,anon;
grant execute on function public.transport_complete_operations(uuid,text) to authenticated;

-- Scope every new evidence table to the active operating location, in addition
-- to BU/company RLS. Values derive from the checked posting RPC context.
do $$declare t text;begin
 foreach t in array array['transport_trip_supplier_rents','transport_customer_documents','transport_customer_document_trips','transport_supplier_documents','transport_supplier_document_rents',
 'transport_driver_accrual_attributions','transport_driver_payment_attributions','transport_service_cost_links','transport_service_note_lines','transport_rate_adjustments','transport_service_refunds'] loop
 execute format('alter table public.%I add column if not exists operating_location_id uuid not null default public.current_operating_location_id() references public.operating_locations(id) on delete restrict',t);
 execute format('create policy %I on public.%I as restrictive for select to authenticated using(operating_location_id=public.current_operating_location_id())',t||'_branch_read',t);
 end loop;end $$;
-- Query indexes match the attribution/settlement paths.
create index transport_customer_link_trip on public.transport_customer_document_trips(trip_id);
create index transport_supplier_link_trip on public.transport_supplier_document_rents(trip_id);
create index transport_driver_accrual_trip on public.transport_driver_accrual_attributions(trip_id);
create index transport_driver_payment_trip on public.transport_driver_payment_attributions(trip_id);
create index transport_cost_trip on public.transport_service_cost_links(trip_id);
create index transport_note_source on public.transport_service_note_lines(side,order_id);
create index transport_adjustment_trip on public.transport_rate_adjustments(trip_id,side,rent_id);
-- Compatibility with current assignment-edit UI. Existing history is preserved.
create table if not exists public.transport_financial_assignment_history(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,
 trip_id uuid not null references public.transport_trips(id) on delete restrict,
 old_vehicle_id uuid,vehicle_id uuid,old_driver_id uuid,driver_id uuid,
 reason text not null check(btrim(reason)<>''),created_by uuid not null,created_at timestamptz not null default now());
alter table public.transport_financial_assignment_history enable row level security;
create policy transport_financial_assignment_history_read on public.transport_financial_assignment_history for select to authenticated
 using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'transport','view'));
grant select on public.transport_financial_assignment_history to authenticated;
create trigger evidence_immutable before update or delete on public.transport_financial_assignment_history for each row execute function public.transport_financial_append_only();
-- Install a compatibility RPC only if the authoritative workspace's database
-- does not already provide its existing controlled assignment implementation.
do $install$begin
 if to_regprocedure('public.transport_replace_trip_assignment(uuid,uuid,uuid,text)') is null then
 execute $definition$
 create function public.transport_replace_trip_assignment(p_trip_id uuid,p_vehicle_id uuid,p_driver_id uuid,p_reason text) returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $body$
 declare t public.transport_trips%rowtype;owner text;
 begin
 if not public.has_module_permission(public.current_company_id(),'transport','edit') or nullif(btrim(p_reason),'') is null
 then raise exception 'Transport Edit permission and assignment reason required';end if;
 t:=public.transport_financial_trip(p_trip_id);
 if p_vehicle_id is not null and not exists(select 1 from public.transport_vehicles where id=p_vehicle_id and company_id=t.company_id and business_unit_id=t.business_unit_id and is_active) then raise exception 'Same-workspace active vehicle required';end if;
 if p_driver_id is not null and not exists(select 1 from public.transport_drivers where id=p_driver_id and company_id=t.company_id and business_unit_id=t.business_unit_id and is_active) then raise exception 'Same-workspace active driver required';end if;
 insert into public.transport_financial_assignment_history(company_id,business_unit_id,trip_id,old_vehicle_id,vehicle_id,old_driver_id,driver_id,reason,created_by)
 values(t.company_id,t.business_unit_id,t.id,t.vehicle_id,p_vehicle_id,t.driver_id,p_driver_id,p_reason,auth.uid());
 select coalesce(v.owner_name,s.name) into owner from public.transport_vehicles v left join public.suppliers s on s.id=v.supplier_id where v.id=p_vehicle_id;
 update public.transport_trips set vehicle_id=p_vehicle_id,driver_id=p_driver_id,owner_name_snapshot=owner where id=t.id;
 perform public.transport_financial_audit(t.id,'assignment_replacement',jsonb_build_object('old_driver_id',t.driver_id,'driver_id',p_driver_id,'old_vehicle_id',t.vehicle_id,'vehicle_id',p_vehicle_id,'reason',p_reason));
 return jsonb_build_object('success',true);
 end $body$;
 $definition$;
 end if;
end $install$;
revoke all on function public.transport_replace_trip_assignment(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.transport_replace_trip_assignment(uuid,uuid,uuid,text) to authenticated;
create function public.transport_set_driver_pay(p_trip_id uuid,p_amount numeric,p_reason text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;
begin
 perform public.transport_finance_assert('driver');t:=public.transport_financial_trip(p_trip_id);
 if coalesce(p_amount,-1)<0 or nullif(btrim(p_reason),'') is null then raise exception 'Non-negative driver obligation and reason required';end if;
 if exists(select 1 from public.transport_driver_accrual_attributions where trip_id=t.id) or exists(select 1 from public.transport_driver_payment_attributions where trip_id=t.id) then raise exception 'Attributed driver obligation is immutable; use canonical payroll correction';end if;
 update public.transport_trips set driver_pay=round(p_amount,2) where id=t.id;
 perform public.transport_financial_audit(t.id,'driver_pay_agreed',jsonb_build_object('old_value',t.driver_pay,'new_value',p_amount,'difference',p_amount-t.driver_pay,'reason',p_reason));
end $$;
revoke all on function public.transport_set_driver_pay(uuid,numeric,text) from public,anon;
grant execute on function public.transport_set_driver_pay(uuid,numeric,text) to authenticated;

create table public.transport_cost_upload_requests(
 request_id uuid primary key,company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 payload_hash text not null,result jsonb not null,created_by uuid not null,created_at timestamptz not null default now());
revoke all on public.transport_cost_upload_requests from public,anon,authenticated;
alter table public.transport_cost_upload_requests enable row level security;
create function public.transport_post_cost_chunk(p_request_id uuid,p_rows jsonb,p_supplier_id uuid,p_cost_account_id uuid,p_with_tax boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare row jsonb;result jsonb:='[]';saved public.transport_cost_upload_requests%rowtype;hash text;
 c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
begin
 perform public.transport_finance_assert('cost');
 if p_request_id is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Request ID and 1 to 500 reviewed rows required';end if;
 hash:=md5(p_rows::text||p_supplier_id::text||p_cost_account_id::text||p_with_tax::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into saved from public.transport_cost_upload_requests where request_id=p_request_id;
 if found then
 if (saved.company_id,saved.business_unit_id,saved.operating_location_id,saved.payload_hash) is distinct from(c,b,loc,hash) then raise exception 'Upload request belongs to a different scope or payload';end if;
 return saved.result;end if;
 for row in select value from jsonb_array_elements(p_rows) loop
 result:=result||jsonb_build_array(public.transport_post_cost((row->>'trip_id')::uuid,'driver_expense',p_supplier_id,(row->>'amount')::numeric,(row->>'date')::date,p_cost_account_id,p_with_tax,row->>'reference'));
 end loop;
 insert into public.transport_cost_upload_requests values(p_request_id,c,b,loc,hash,jsonb_build_object('success',true,'documents',result),auth.uid(),now());
 return jsonb_build_object('success',true,'documents',result);
end $$;
revoke all on function public.transport_post_cost_chunk(uuid,jsonb,uuid,uuid,boolean) from public,anon;
grant execute on function public.transport_post_cost_chunk(uuid,jsonb,uuid,uuid,boolean) to authenticated;

notify pgrst,'reload schema';

-- Keep canonical header payment snapshots consistent with actual refunds/credits.
create function public.transport_refresh_document_balance(p_side text,p_order_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare b record;v_status text;begin
 select * into b from public.transport_service_document_balances where side=p_side and order_id=p_order_id;
 if not found then return;end if;
 v_status:=case when b.credit_gross>0.005 then 'overpaid' when b.outstanding_gross<=0.005 then 'paid' when b.paid_gross-b.refunded_gross>0 then 'partial' else 'unpaid' end;
 if p_side='customer' then perform set_config('app.customer_payment_update','1',true);
 update public.sales_orders set paid_amount=greatest(b.paid_gross-b.refunded_gross,0),outstanding_amount=b.outstanding_gross,payment_status=v_status where id=p_order_id;
 else perform set_config('app.supplier_payment_update','1',true);
 update public.purchase_orders set paid_amount=greatest(b.paid_gross-b.refunded_gross,0),outstanding_amount=b.outstanding_gross,payment_status=v_status where id=p_order_id;end if;
end $$;
revoke all on function public.transport_refresh_document_balance(text,uuid) from public,anon,authenticated;
create function public.transport_refresh_after_credit() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.transport_refresh_document_balance(new.side,new.order_id);return new;end $$;
revoke all on function public.transport_refresh_after_credit() from public,anon,authenticated;
create trigger zz_transport_refresh_note after insert on public.transport_service_note_lines for each row execute function public.transport_refresh_after_credit();
create trigger zz_transport_refresh_refund after insert on public.transport_service_refunds for each row execute function public.transport_refresh_after_credit();
-- Rate documents and credits are corrected by a new controlled delta, never a silent reversal.
create function public.transport_guard_financial_reversal() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.reversal_of_entry_id is not null and (
 exists(select 1 from public.transport_customer_documents where journal_entry_id=new.reversal_of_entry_id)
 or exists(select 1 from public.transport_supplier_documents where journal_entry_id=new.reversal_of_entry_id)
 or exists(select 1 from public.transport_service_note_lines n join public.return_notes r on r.id=n.note_id where r.journal_entry_id=new.reversal_of_entry_id)
 or exists(select 1 from public.transport_service_refunds where journal_entry_id=new.reversal_of_entry_id))
 then raise exception 'Transport posted billing/credit/refund history is immutable; use controlled rate correction';end if;return new;
end $$;
revoke all on function public.transport_guard_financial_reversal() from public,anon,authenticated;
create trigger transport_financial_reversal_guard before insert or update of reversal_of_entry_id on public.journal_entries for each row execute function public.transport_guard_financial_reversal();

create function public.transport_normalize_payment_snapshot() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare b record;begin
 select * into b from public.transport_service_document_balances where side=case when tg_table_name='sales_orders' then 'customer' else 'supplier' end and order_id=new.id;
 if found then
 new.paid_amount:=greatest(b.paid_gross-b.refunded_gross,0);new.outstanding_amount:=b.outstanding_gross;
 new.payment_status:=case when b.credit_gross>0.005 then 'overpaid' when b.outstanding_gross<=0.005 then 'paid' when new.paid_amount>0 then 'partial' else 'unpaid' end;
 end if;return new;
end $$;
revoke all on function public.transport_normalize_payment_snapshot() from public,anon,authenticated;
create trigger zz_transport_sales_payment_snapshot before update of paid_amount,outstanding_amount,payment_status on public.sales_orders for each row execute function public.transport_normalize_payment_snapshot();
create trigger zz_transport_purchase_payment_snapshot before update of paid_amount,outstanding_amount,payment_status on public.purchase_orders for each row execute function public.transport_normalize_payment_snapshot();
commit;
