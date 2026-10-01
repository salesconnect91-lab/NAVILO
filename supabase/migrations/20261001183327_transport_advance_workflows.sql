-- Expose only available, unreversed canonical cash receipts / supplier payments.
create view public.transport_party_advances with(security_invoker=true) as
with sources as (
 select j.id journal_entry_id,j.company_id,j.business_unit_id,j.operating_location_id,j.entry_no,j.entry_date,
 j.currency_code,j.description reference,j.trans_type,case when l.party_type='customer' then 'customer' else 'supplier' end side,
 l.party_id,case when l.party_type='customer' then l.credit-l.debit else l.debit-l.credit end amount
 from public.journal_entries j join public.journal_lines l on l.entry_id=j.id
 where j.status='posted' and ((j.trans_type='Customer Receipt' and l.party_type='customer') or (j.trans_type='Supplier Payment' and l.party_type='supplier'))
 and not exists(select 1 from public.journal_entries r where r.reversal_of_entry_id=j.id and r.status='posted')
 and j.company_id=public.current_company_id() and j.business_unit_id=public.current_business_unit_id()
 and j.operating_location_id=public.current_operating_location_id()
 and public.has_module_permission(j.company_id,'transport','view') and public.has_module_permission(j.company_id,'accounting','view')
), available as (
 select s.*,coalesce((case when s.side='customer' then (select sum(a.amount) from public.invoice_payment_allocations a where a.journal_entry_id=s.journal_entry_id)
 else (select sum(a.amount) from public.purchase_payment_allocations a where a.journal_entry_id=s.journal_entry_id) end),0) allocated
 from sources s join public.companies c on c.id=s.company_id where coalesce(s.currency_code,c.base_currency_code)=c.base_currency_code
)
select *,greatest(amount-allocated,0) available from available where amount-allocated>0.005;
grant select on public.transport_party_advances to authenticated;

create function public.transport_manage_advance(p_request_id uuid,p_side text,p_operation text,p_party_id uuid,p_date date,p_amount numeric,
 p_account_id uuid default null,p_method text default 'cash',p_source_id uuid default null,p_order_id uuid default null,p_reference text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 body jsonb;stored public.transport_settlement_requests%rowtype;outcome jsonb;d record;source record;balance numeric;tid uuid;
begin
 perform public.transport_finance_assert('settlement');
 if p_request_id is null or p_date is null or loc is null or p_side is null or p_operation is null or p_side not in ('customer','supplier') or p_operation not in ('record','allocate')
 or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or round(p_amount,2)<>p_amount then raise exception 'Valid side, operation, request, date and positive two-decimal amount required';end if;
 if (p_side='customer' and not exists(select 1 from public.customers where id=p_party_id and company_id=c and is_active))
 or (p_side='supplier' and not exists(select 1 from public.suppliers where id=p_party_id and company_id=c and is_active)) then raise exception 'Active party in current company required';end if;
 body:=jsonb_build_object('operation','advance_'||p_operation,'side',p_side,'party',p_party_id,'date',p_date,'amount',p_amount,'account',p_account_id,'method',p_method,'source',p_source_id,'order',p_order_id,'reference',p_reference);
 insert into public.transport_settlement_requests(company_id,business_unit_id,operating_location_id,request_id,created_by,payload)
 values(c,b,loc,p_request_id,auth.uid(),body) on conflict do nothing;
 select * into strict stored from public.transport_settlement_requests where company_id=c and business_unit_id=b and operating_location_id=loc and request_id=p_request_id for update;
 if stored.created_by<>auth.uid() or stored.payload<>body then raise exception 'Advance request reused with different actor or payload';end if;
 if stored.result is not null then return stored.result;end if;
 if p_operation='record' then
  if p_account_id is null or p_method is null or p_method not in ('cash','bank') then raise exception 'Cash/bank account required';end if;
  if p_side='customer' then
   outcome:=public.receive_customer_payment(p_party_id,p_date,p_account_id,p_method,p_reference,'Transport customer advance',null,'[]'::jsonb,p_amount);
  else
   outcome:=public.pay_supplier_advance(p_party_id,p_date,p_account_id,p_method,p_reference,'Transport supplier advance',null,p_amount);
  end if;
 else
  if p_side='customer' then perform 1 from public.sales_orders where id=p_order_id for update;
  else perform 1 from public.purchase_orders where id=p_order_id for update;end if;
  select * into d from public.transport_party_document_sources where side=p_side and order_id=p_order_id and party_id=p_party_id;
  if not found then raise exception 'Transport bill for selected party and active branch required';end if;
  if p_date<d.posted_date then raise exception 'Allocation date cannot precede bill posting';end if;
  perform 1 from public.journal_entries where id=p_source_id for update;
  select * into source from public.transport_party_advances where journal_entry_id=p_source_id and side=p_side and party_id=p_party_id;
  if not found or p_amount>source.available+0.005 then raise exception 'Available unreversed advance for same party required';end if;
  select outstanding_gross into balance from public.transport_service_document_balances where side=p_side and order_id=p_order_id;
  if balance is null or p_amount>balance+0.005 then raise exception 'Advance allocation exceeds current bill balance after credits';end if;
  if p_side='customer' then outcome:=public.allocate_customer_advance(p_source_id,p_order_id,p_amount,p_date,p_reference,'Transport allocation from existing advance');
  else outcome:=public.allocate_supplier_advance(p_source_id,p_order_id,p_amount,p_date,p_reference,'Transport allocation from existing advance');end if;
  perform public.transport_refresh_document_balance(p_side,p_order_id);
  foreach tid in array d.trip_ids loop perform public.transport_financial_audit(tid,'advance_allocated',outcome||body);end loop;
 end if;
 update public.transport_settlement_requests set result=outcome where company_id=c and business_unit_id=b and operating_location_id=loc and request_id=p_request_id;
 return outcome;
end $$;
revoke all on function public.transport_manage_advance(uuid,text,text,uuid,date,numeric,uuid,text,uuid,uuid,text) from public,anon;
grant execute on function public.transport_manage_advance(uuid,text,text,uuid,date,numeric,uuid,text,uuid,uuid,text) to authenticated;

-- Advance allocation dates must remain correct in historical Trip reports.
create or replace view public.transport_party_movements with(security_invoker=true) as
with allocations as (
 select 'customer'::text side,id allocation_id,sales_order_id order_id,journal_entry_id,amount,allocation_date from public.invoice_payment_allocations
 union all select 'supplier',id,purchase_order_id,journal_entry_id,amount,allocation_date from public.purchase_payment_allocations
 union all select side,allocation_id,order_id,journal_entry_id,amount,allocation_date from public.transport_reversed_allocation_evidence
), sources as (
 select 'bill:'||d.order_id::text event_id,d.side,d.order_id,d.company_id,d.business_unit_id,d.operating_location_id,
 d.party_id,d.party_name,d.trip_ids,d.trip_no,d.order_no,d.kind,'bill'::text event_type,d.journal_entry_id,
 d.original_gross amount,d.original_net net_amount,null::date movement_date
 from public.transport_party_document_sources d
 union all
 select 'note:'||n.id,n.side,n.order_id,d.company_id,d.business_unit_id,d.operating_location_id,d.party_id,d.party_name,
 d.trip_ids,d.trip_no,d.order_no,d.kind,'credit_note',r.journal_entry_id,-(n.net_amount+n.vat_amount),-n.net_amount,null::date
 from public.transport_service_note_lines n join public.return_notes r on r.id=n.note_id and r.status='posted'
 join public.transport_party_document_sources d on d.side=n.side and d.order_id=n.order_id
 union all
 select 'receipt:'||a.allocation_id,d.side,d.order_id,d.company_id,d.business_unit_id,d.operating_location_id,d.party_id,d.party_name,
 d.trip_ids,d.trip_no,d.order_no,d.kind,'receipt',a.journal_entry_id,-a.amount,
 -round(a.amount*d.original_net/nullif(d.original_gross,0),2),a.allocation_date
 from allocations a join public.transport_party_document_sources d on a.side='customer' and d.side=a.side and d.order_id=a.order_id
 union all
 select 'payment:'||a.allocation_id,d.side,d.order_id,d.company_id,d.business_unit_id,d.operating_location_id,d.party_id,d.party_name,
 d.trip_ids,d.trip_no,d.order_no,d.kind,'payment',a.journal_entry_id,-a.amount,
 -round(a.amount*d.original_net/nullif(d.original_gross,0),2),a.allocation_date
 from allocations a join public.transport_party_document_sources d on a.side='supplier' and d.side=a.side and d.order_id=a.order_id
 union all
 select 'refund:'||f.id,d.side,d.order_id,d.company_id,d.business_unit_id,d.operating_location_id,d.party_id,d.party_name,
 d.trip_ids,d.trip_no,d.order_no,d.kind,case when f.side='customer' then 'refund' else 'recovery' end,f.journal_entry_id,f.amount,
 round(f.amount*d.original_net/nullif(d.original_gross,0),2),null::date
 from public.transport_service_refunds f join public.transport_party_document_sources d on d.side=f.side and d.order_id=f.order_id
), posted as (
 select s.event_id,s.side,s.order_id,s.company_id,s.business_unit_id,s.operating_location_id,s.party_id,s.party_name,s.trip_ids,s.trip_no,s.order_no,s.kind,s.event_type,s.journal_entry_id,s.amount,s.net_amount,j.entry_no,coalesce(s.movement_date,j.entry_date) event_date,j.description,j.created_at,
 case when s.side='customer' then greatest(s.amount,0) else greatest(-s.amount,0) end debit,
 case when s.side='supplier' then greatest(s.amount,0) else greatest(-s.amount,0) end credit
 from sources s join public.journal_entries j on j.id=s.journal_entry_id and j.status='posted'
)
select * from posted
union all
-- Preserve historical statements: original payment remains on its posting date,
-- and the reversal restores the outstanding on the reversal date.
select p.event_id||':reversal:'||r.id,p.side,p.order_id,p.company_id,p.business_unit_id,p.operating_location_id,
 p.party_id,p.party_name,p.trip_ids,p.trip_no,p.order_no,p.kind,'reversal_'||p.event_type,r.id,
 -p.amount,-p.net_amount,r.entry_no,r.entry_date,r.description,r.created_at,p.credit,p.debit
from posted p join public.journal_entries r on r.reversal_of_entry_id=p.journal_entry_id and r.status='posted';

