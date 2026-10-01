-- Reconcile Batch-1 and Fresh-V1 Transport audit contracts without deleting or rewriting history.
alter table public.transport_trip_audit
  add column if not exists event_type text,
  add column if not exists old_data jsonb,
  add column if not exists new_data jsonb,
  add column if not exists changed_by uuid,
  add column if not exists changed_at timestamptz;

-- Do not fabricate migration-time timestamps for historical Batch-1 audit rows.
alter table public.transport_trip_audit alter column changed_at drop default;

create or replace function public.transport_trip_audit_compat_fill()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.trip_no is null and new.trip_id is not null then
    select t.trip_no into new.trip_no
    from public.transport_trips t
    where t.id=new.trip_id;
  end if;

  new.action := coalesce(new.action,new.event_type);
  new.event_type := coalesce(new.event_type,new.action);
  new.old_value := coalesce(new.old_value,new.old_data);
  new.old_data := coalesce(new.old_data,new.old_value);
  new.new_value := coalesce(new.new_value,new.new_data);
  new.new_data := coalesce(new.new_data,new.new_value);
  new.actor_id := coalesce(new.actor_id,new.changed_by);
  new.changed_by := coalesce(new.changed_by,new.actor_id);
  new.occurred_at := coalesce(new.occurred_at,new.changed_at,now());
  new.changed_at := coalesce(new.changed_at,new.occurred_at,now());

  if new.trip_no is null then
    raise exception 'Transport audit trip number could not be resolved';
  end if;
  if new.action is null or new.event_type is null then
    raise exception 'Transport audit event/action is required';
  end if;

  return new;
end
$$;

revoke all on function public.transport_trip_audit_compat_fill() from public,anon,authenticated;

drop trigger if exists aaa_transport_trip_audit_compat_fill on public.transport_trip_audit;
create trigger aaa_transport_trip_audit_compat_fill
before insert on public.transport_trip_audit
for each row execute function public.transport_trip_audit_compat_fill();

create index if not exists transport_trip_audit_event_history_idx
  on public.transport_trip_audit(company_id,business_unit_id,trip_id,event_type,changed_at);

-- Financial V1 compatibility: once a pending legacy owner_rent Trip begins using
-- structured supplier-rent rows, retire the legacy amount first so the two
-- models can never be counted together. Existing historical rows are not
-- bulk-converted or inferred.
create or replace function public.transport_add_supplier_rent(
  p_trip_id uuid,
  p_supplier_id uuid,
  p_amount numeric,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  t public.transport_trips%rowtype;
  r uuid;
  v_legacy_rent numeric;
begin
  perform public.transport_finance_assert('rent');
  t:=public.transport_financial_trip(p_trip_id);

  if not exists(
    select 1
    from public.suppliers
    where id=p_supplier_id
      and company_id=t.company_id
      and is_active
  ) then
    raise exception 'Active same-company supplier required';
  end if;

  if coalesce(t.owner_rent,0)<>0 then
    if t.rent_state='finalized' then
      raise exception 'Finalized legacy owner rent requires controlled correction before structured supplier rents';
    end if;
    if exists(
      select 1
      from public.transport_trip_supplier_rents
      where trip_id=t.id
    ) then
      raise exception 'Legacy owner rent cannot coexist with structured supplier rents';
    end if;

    v_legacy_rent:=t.owner_rent;

    insert into public.transport_action_gate(transaction_id,trip_id,action)
    values(txid_current(),t.id,'rent_correct')
    on conflict do nothing;

    update public.transport_trips
       set owner_rent=0
     where id=t.id;

    delete from public.transport_action_gate
     where transaction_id=txid_current()
       and trip_id=t.id
       and action='rent_correct';

    perform public.transport_financial_audit(
      t.id,
      'legacy_owner_rent_retired',
      jsonb_build_object(
        'legacy_owner_rent',v_legacy_rent,
        'reason','Structured supplier rent became canonical'
      )
    );
  end if;

  insert into public.transport_trip_supplier_rents(
    company_id,business_unit_id,trip_id,supplier_id,amount,reason,created_by
  )
  values(
    t.company_id,t.business_unit_id,t.id,p_supplier_id,
    round(p_amount,2),btrim(p_reason),auth.uid()
  )
  returning id into r;

  perform public.transport_financial_audit(
    t.id,
    'rent_finalized',
    jsonb_build_object(
      'rent_id',r,
      'supplier_id',p_supplier_id,
      'amount',p_amount,
      'reason',p_reason
    )
  );

  return r;
end
$$;

revoke all on function public.transport_add_supplier_rent(uuid,uuid,numeric,text)
  from public,anon;
grant execute on function public.transport_add_supplier_rent(uuid,uuid,numeric,text)
  to authenticated;


-- Batch-1 compatibility: job_status is a generated pending/done projection of
-- PO/DO/Job No. Fresh-V1 used a writable completed status.
create or replace function public.transport_complete_operations(
  p_trip_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  t public.transport_trips%rowtype;
  v_job_generated boolean;
begin
  perform public.transport_finance_assert('close');
  t:=public.transport_financial_trip(p_trip_id);

  if nullif(btrim(p_reason),'') is null then
    raise exception 'Operational completion reason required';
  end if;

  select (c.is_generated='ALWAYS')
    into v_job_generated
    from information_schema.columns c
   where c.table_schema='public'
     and c.table_name='transport_trips'
     and c.column_name='job_status';

  if coalesce(v_job_generated,false) then
    -- Batch-1 owns legacy status and derives job_status from PO/DO/Job No.
    -- Only the Fresh-V1 operational field is writable here.
    if t.job_status<>'done' then
      raise exception 'PO / DO / Job No. is required before operational completion';
    end if;
    update public.transport_trips
       set trip_status='completed'
     where id=t.id;
  else
    -- Fresh-V1-only shape: job_status remains a writable operational field.
    update public.transport_trips
       set trip_status='completed',job_status='completed'
     where id=t.id;
  end if;

  perform public.transport_financial_audit(
    t.id,
    'operational_completion',
    jsonb_build_object('reason',p_reason)
  );
end
$$;

revoke all on function public.transport_complete_operations(uuid,text)
  from public,anon;
grant execute on function public.transport_complete_operations(uuid,text)
  to authenticated;

-- Batch-1 keeps legacy status immutable. Fresh-V1 trip_status is the canonical
-- operational lifecycle for financial settlement; generated Batch-1 job_status
-- "done" and Fresh-V1 "completed" are equivalent completion evidence.
create or replace view public.transport_trip_financial_summary with(security_invoker=true) as
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
 t.customer_rate original_customer_rate,t.owner_rent legacy_owner_rent,t.driver_pay agreed_driver_pay,t.trip_status operational_status,t.job_status,
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
 when customer_documents>0 and operational_status in ('completed','ready_to_invoice','invoiced','paid') and job_status in ('completed','done')
 and customer_outstanding_gross<=0.005 and customer_credit_gross<=0.005 and supplier_outstanding_gross<=0.005 and supplier_credit_gross<=0.005
 and driver_outstanding<=0.005 and driver_accrued>=agreed_driver_pay-0.005 and not unbilled_rent
 and (legacy_owner_rent<=0 or structured_rents) and required_cost_outstanding<=0.005 then 'Closed'
 when customer_rate_locked or supplier_rate_locked or driver_accrued>0 or driver_paid>0 or other_cost_net>0 then 'Under Settlement'
 when operational_status='draft' then 'Draft'
 when original_customer_rate>0 and (legacy_owner_rent>0 or structured_rents) then 'Complete' else 'Not Complete' end financial_status
from evidence;
revoke all on public.transport_trip_financial_summary from public,anon;grant select on public.transport_trip_financial_summary to authenticated;
