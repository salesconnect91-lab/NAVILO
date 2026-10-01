begin;
-- Read-only projections of canonical documents and journals; no new ledger or posting engine.
-- Invoker views preserve existing RLS. Explicit current branch prevents broad party RLS
-- from widening the reporting scope. No grants are added to unprotected base tables.
do $$ declare rel text; begin
 foreach rel in array array['journal_lines','journal_entries'] loop
 if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname=rel and c.relrowsecurity) then
 raise exception 'Reporting requires canonical RLS on %',rel; end if;
 execute format('grant select on public.%I to authenticated',rel);
 end loop;
end $$;

-- Canonical payment reversal deletes live allocations. Preserve exact source
-- provenance before deletion so historical as-of statements remain possible.
-- This archive contains no new balances and never fabricates earlier history.
create table public.transport_reversed_allocation_evidence(
 side text not null check(side in ('customer','supplier')),allocation_id uuid not null,
 order_id uuid not null,journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
 company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 amount numeric(18,2) not null check(amount>0),allocation_date date not null,
 archived_by uuid,archived_at timestamptz not null default now(),primary key(side,allocation_id));
alter table public.transport_reversed_allocation_evidence enable row level security;
create policy transport_reversed_allocation_read on public.transport_reversed_allocation_evidence
for select to authenticated using(company_id=public.current_company_id()
 and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id()
 and public.has_module_permission(company_id,'transport','view')
 and public.has_module_permission(company_id,case when side='customer' then 'sales' else 'purchase' end,'view'));
revoke all on public.transport_reversed_allocation_evidence from public,anon,authenticated;
grant select on public.transport_reversed_allocation_evidence to authenticated;
create trigger transport_reversed_allocation_immutable before update or delete on public.transport_reversed_allocation_evidence
for each row execute function public.transport_financial_append_only();
create function public.transport_archive_reversed_allocation() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare side_name text;oid uuid;
begin
 if tg_table_name='invoice_payment_allocations' then
 side_name:='customer';oid:=old.sales_order_id;
 if not exists(select 1 from public.transport_customer_documents where sales_order_id=oid) then return old;end if;
 else
 side_name:='supplier';oid:=old.purchase_order_id;
 if not exists(select 1 from public.transport_supplier_documents where purchase_order_id=oid)
 and not exists(select 1 from public.transport_service_cost_links where purchase_order_id=oid) then return old;end if;
 end if;
 if not exists(select 1 from public.journal_entries where reversal_of_entry_id=old.journal_entry_id and status='posted'
 and company_id=old.company_id and business_unit_id=old.business_unit_id and operating_location_id=old.operating_location_id)
 then raise exception 'Transport allocation deletion requires posted canonical reversal';end if;
 insert into public.transport_reversed_allocation_evidence(side,allocation_id,order_id,journal_entry_id,
 company_id,business_unit_id,operating_location_id,amount,allocation_date,archived_by)
 values(side_name,old.id,oid,old.journal_entry_id,old.company_id,old.business_unit_id,old.operating_location_id,old.amount,old.allocation_date,auth.uid());
 return old;
end $$;
revoke all on function public.transport_archive_reversed_allocation() from public,anon,authenticated;
create trigger transport_archive_customer_allocation before delete on public.invoice_payment_allocations
for each row execute function public.transport_archive_reversed_allocation();
create trigger transport_archive_supplier_allocation before delete on public.purchase_payment_allocations
for each row execute function public.transport_archive_reversed_allocation();
create index transport_reversed_allocation_source on public.transport_reversed_allocation_evidence(side,order_id);

-- Legacy return-note SELECT requires Inventory view permission. Transport
-- service corrections need no inventory. Expose only attributed service notes
-- within the checked current branch and the relevant Sales/Purchase permission.
create policy transport_attributed_service_notes_read on public.return_notes
for select to authenticated using (
 exists(select 1 from public.transport_service_note_lines n
 where n.note_id=return_notes.id and n.company_id=public.current_company_id()
 and n.business_unit_id=public.current_business_unit_id()
 and n.operating_location_id=public.current_operating_location_id()
 and public.has_module_permission(n.company_id,'transport','view')
 and public.has_module_permission(n.company_id,case when n.side='customer' then 'sales' else 'purchase' end,'view'))
);

create view public.transport_party_document_sources with(security_invoker=true) as
with links as (
 select 'customer'::text side,d.sales_order_id order_id,d.journal_entry_id,d.document_kind::text kind,l.trip_id
 from public.transport_customer_documents d join public.transport_customer_document_trips l on l.document_id=d.id
 union all
 select 'supplier',d.purchase_order_id,d.journal_entry_id,'rent',l.trip_id
 from public.transport_supplier_documents d join public.transport_supplier_document_rents l on l.document_id=d.id
 union all
 select 'supplier',l.purchase_order_id,l.journal_entry_id,l.cost_kind,l.trip_id from public.transport_service_cost_links l
), grouped as (
 select l.side,l.order_id,l.journal_entry_id,l.kind,array_agg(distinct t.id order by t.id) trip_ids,
 string_agg(distinct t.trip_no,', ' order by t.trip_no) trip_no
 from links l join public.transport_trips t on t.id=l.trip_id group by l.side,l.order_id,l.journal_entry_id,l.kind
), orders as (
 select 'customer'::text side,s.id order_id,s.company_id,s.business_unit_id,s.operating_location_id,s.customer_id party_id,
 coalesce(s.customer_name_snapshot,c.name,s.customer_id::text) party_name,s.order_no,s.order_date,s.total original_gross,
 coalesce((select sum(amount) from public.sales_service_lines where order_id=s.id),0) original_net
 from public.sales_orders s left join public.customers c on c.id=s.customer_id
 union all
 select 'supplier',p.id,p.company_id,p.business_unit_id,p.operating_location_id,p.supplier_id,coalesce(p.supplier_name_snapshot,c.name,p.supplier_id::text),p.order_no,p.order_date,p.total,
 coalesce((select sum(amount) from public.purchase_service_lines where order_id=p.id),0)
 from public.purchase_orders p left join public.suppliers c on c.id=p.supplier_id
)
select o.*,g.journal_entry_id,g.kind,g.trip_ids,g.trip_no,j.entry_no,j.entry_date posted_date
from orders o join grouped g on g.side=o.side and g.order_id=o.order_id
join public.journal_entries j on j.id=g.journal_entry_id and j.status='posted'
where o.company_id=public.current_company_id() and o.business_unit_id=public.current_business_unit_id()
and o.operating_location_id=public.current_operating_location_id()
and public.has_module_permission(o.company_id,'transport','view');

-- Keep historical movement reads independent of expensive live-balance joins.
create view public.transport_party_documents with(security_invoker=true) as
select d.*,b.billed_gross current_billed_gross,b.paid_gross current_paid_gross,b.refunded_gross current_refunded_gross,
 b.outstanding_gross current_outstanding_gross,b.credit_gross current_credit_gross
from public.transport_party_document_sources d
left join public.transport_service_document_balances b on b.side=d.side and b.order_id=d.order_id;

create view public.transport_party_movements with(security_invoker=true) as
with allocations as (
 select 'customer'::text side,id allocation_id,sales_order_id order_id,journal_entry_id,amount from public.invoice_payment_allocations
 union all select 'supplier',id,purchase_order_id,journal_entry_id,amount from public.purchase_payment_allocations
 union all select side,allocation_id,order_id,journal_entry_id,amount from public.transport_reversed_allocation_evidence
), sources as (
 select 'bill:'||d.order_id::text event_id,d.side,d.order_id,d.company_id,d.business_unit_id,d.operating_location_id,
 d.party_id,d.party_name,d.trip_ids,d.trip_no,d.order_no,d.kind,'bill'::text event_type,d.journal_entry_id,
 d.original_gross amount,d.original_net net_amount
 from public.transport_party_document_sources d
 union all
 select 'note:'||n.id,n.side,n.order_id,d.company_id,d.business_unit_id,d.operating_location_id,d.party_id,d.party_name,
 d.trip_ids,d.trip_no,d.order_no,d.kind,'credit_note',r.journal_entry_id,-(n.net_amount+n.vat_amount),-n.net_amount
 from public.transport_service_note_lines n join public.return_notes r on r.id=n.note_id and r.status='posted'
 join public.transport_party_document_sources d on d.side=n.side and d.order_id=n.order_id
 union all
 select 'receipt:'||a.allocation_id,d.side,d.order_id,d.company_id,d.business_unit_id,d.operating_location_id,d.party_id,d.party_name,
 d.trip_ids,d.trip_no,d.order_no,d.kind,'receipt',a.journal_entry_id,-a.amount,
 -round(a.amount*d.original_net/nullif(d.original_gross,0),2)
 from allocations a join public.transport_party_document_sources d on a.side='customer' and d.side=a.side and d.order_id=a.order_id
 union all
 select 'payment:'||a.allocation_id,d.side,d.order_id,d.company_id,d.business_unit_id,d.operating_location_id,d.party_id,d.party_name,
 d.trip_ids,d.trip_no,d.order_no,d.kind,'payment',a.journal_entry_id,-a.amount,
 -round(a.amount*d.original_net/nullif(d.original_gross,0),2)
 from allocations a join public.transport_party_document_sources d on a.side='supplier' and d.side=a.side and d.order_id=a.order_id
 union all
 select 'refund:'||f.id,d.side,d.order_id,d.company_id,d.business_unit_id,d.operating_location_id,d.party_id,d.party_name,
 d.trip_ids,d.trip_no,d.order_no,d.kind,case when f.side='customer' then 'refund' else 'recovery' end,f.journal_entry_id,f.amount,
 round(f.amount*d.original_net/nullif(d.original_gross,0),2)
 from public.transport_service_refunds f join public.transport_party_document_sources d on d.side=f.side and d.order_id=f.order_id
), posted as (
 select s.*,j.entry_no,j.entry_date event_date,j.description,j.created_at,
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

create view public.transport_canonical_party_movements with(security_invoker=true) as
select j.id::text||':'||l.party_type||':'||l.party_id::text event_id,l.party_type side,l.party_id,
 coalesce(c.name,s.name,max(l.party_name)) party_name,j.company_id,j.business_unit_id,j.operating_location_id,
 j.id journal_entry_id,j.entry_no,j.entry_date event_date,j.description,j.created_at,
 sum(l.debit) debit,sum(l.credit) credit,
 case when l.party_type='supplier' then sum(l.credit-l.debit) else sum(l.debit-l.credit) end amount
from public.journal_entries j join public.journal_lines l on l.entry_id=j.id
left join public.customers c on l.party_type='customer' and c.id=l.party_id
left join public.suppliers s on l.party_type='supplier' and s.id=l.party_id
where j.status='posted' and l.party_type in ('customer','supplier') and l.party_id is not null
and j.company_id=public.current_company_id() and j.business_unit_id=public.current_business_unit_id()
and j.operating_location_id=public.current_operating_location_id()
and public.has_module_permission(j.company_id,'transport','view')
and public.has_module_permission(j.company_id,'accounting','view')
group by j.id,l.party_type,l.party_id,c.name,s.name;

revoke all on public.transport_party_document_sources,public.transport_party_documents,public.transport_party_movements,public.transport_canonical_party_movements from public,anon;
grant select on public.transport_party_document_sources,public.transport_party_documents,public.transport_party_movements,public.transport_canonical_party_movements to authenticated;

-- Atomic retry protection for reviewed multi-Trip payments. Canonical settlement
-- remains responsible for all vouchers and allocations.
create table public.transport_settlement_requests(
 company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 request_id uuid not null,created_by uuid not null,payload jsonb not null,result jsonb,
 created_at timestamptz not null default now(),
 primary key(company_id,business_unit_id,operating_location_id,request_id));
alter table public.transport_settlement_requests enable row level security;
revoke all on public.transport_settlement_requests from public,anon,authenticated;
create function public.transport_settle_reviewed_documents(p_request_id uuid,p_side text,p_party_id uuid,p_date date,
 p_account_id uuid,p_method text,p_allocations jsonb,p_reference text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 body jsonb;stored public.transport_settlement_requests%rowtype;outcome jsonb;
begin
 perform public.transport_finance_assert('settlement');
 if p_request_id is null or loc is null then raise exception 'Request and active branch required';end if;
 body:=jsonb_build_object('side',p_side,'party',p_party_id,'date',p_date,'account',p_account_id,'method',p_method,
 'allocations',p_allocations,'reference',p_reference);
 insert into public.transport_settlement_requests(company_id,business_unit_id,operating_location_id,request_id,created_by,payload)
 values(c,b,loc,p_request_id,auth.uid(),body) on conflict do nothing;
 select * into strict stored from public.transport_settlement_requests
 where company_id=c and business_unit_id=b and operating_location_id=loc and request_id=p_request_id for update;
 if stored.created_by<>auth.uid() or stored.payload<>body then raise exception 'Settlement request reused with different actor or payload';end if;
 if stored.result is not null then return stored.result;end if;
 outcome:=public.transport_settle_documents(p_side,p_party_id,p_date,p_account_id,p_method,p_allocations,null,p_reference);
 update public.transport_settlement_requests set result=outcome
 where company_id=c and business_unit_id=b and operating_location_id=loc and request_id=p_request_id;
 return outcome;
end $$;
revoke all on function public.transport_settle_reviewed_documents(uuid,text,uuid,date,uuid,text,jsonb,text) from public,anon;
grant execute on function public.transport_settle_reviewed_documents(uuid,text,uuid,date,uuid,text,jsonb,text) to authenticated;
commit;
