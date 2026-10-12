begin;
-- Carry-forward invoice evidence. Does not issue a new tax invoice or post historical turnover/cash.
create table public.transport_opening_invoice_documents (
 id uuid primary key, company_id uuid not null references public.companies(id),
 business_unit_id uuid not null references public.business_units(id), operating_location_id uuid not null references public.operating_locations(id),
 side text not null check(side in('customer','supplier')), party_id uuid not null, party_name text not null,
 original_reference text, opening_date date not null, original_invoice_date date,
 original_net numeric not null, original_gross numeric not null, historical_settled numeric not null,
 opening_remaining numeric(18,2) not null, journal_entry_id uuid not null references public.journal_entries(id),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(company_id,business_unit_id,operating_location_id,side,party_id,id)
);
create table public.transport_opening_invoice_lines (
 document_id uuid not null references public.transport_opening_invoice_documents(id),
 trip_id uuid not null references public.transport_trips(id), side text not null check(side in('customer','supplier')),
 source_reference text, original_net numeric not null, original_gross numeric not null,
 source_remaining numeric not null, opening_remaining numeric(18,2) not null,
 primary key(document_id,trip_id),unique(side,trip_id)
);
create table public.transport_opening_invoice_allocations (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.transport_opening_invoice_documents(id),
 trip_id uuid not null references public.transport_trips(id), journal_entry_id uuid not null references public.journal_entries(id),
 amount numeric(18,2) not null check(amount>0), created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(journal_entry_id,document_id,trip_id), foreign key(document_id,trip_id) references public.transport_opening_invoice_lines(document_id,trip_id)
);
create index transport_opening_invoice_scope_idx on public.transport_opening_invoice_documents(company_id,business_unit_id,operating_location_id,side,party_id);
create index transport_opening_invoice_alloc_document_idx on public.transport_opening_invoice_allocations(document_id);
create index transport_opening_invoice_alloc_trip_idx on public.transport_opening_invoice_allocations(trip_id);
create table public.transport_opening_invoice_requests (
 company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,request_id uuid not null,
 payload jsonb not null,response jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 primary key(company_id,business_unit_id,operating_location_id,request_id)
);
alter table public.transport_opening_invoice_documents enable row level security;
alter table public.transport_opening_invoice_lines enable row level security;
alter table public.transport_opening_invoice_allocations enable row level security;
alter table public.transport_opening_invoice_requests enable row level security;
revoke all on public.transport_opening_invoice_documents,public.transport_opening_invoice_lines,public.transport_opening_invoice_allocations,public.transport_opening_invoice_requests from public,anon,authenticated;
grant select on public.transport_opening_invoice_documents,public.transport_opening_invoice_lines,public.transport_opening_invoice_allocations to authenticated;
create policy opening_document_read on public.transport_opening_invoice_documents for select to authenticated using (
 auth.uid() is not null and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
 and operating_location_id=public.current_operating_location_id() and public.transport_financial_read_allowed(side));
create policy opening_line_read on public.transport_opening_invoice_lines for select to authenticated using(exists(select 1 from public.transport_opening_invoice_documents d where d.id=document_id));
create policy opening_allocation_read on public.transport_opening_invoice_allocations for select to authenticated using(exists(select 1 from public.transport_opening_invoice_documents d where d.id=document_id));
create function public.transport_opening_invoice_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Imported opening invoice evidence is immutable; use payment reversal for a new settlement';end $$;
revoke all on function public.transport_opening_invoice_immutable() from public,anon,authenticated;
create trigger opening_document_immutable before update or delete on public.transport_opening_invoice_documents for each row execute function public.transport_opening_invoice_immutable();
create trigger opening_line_immutable before update or delete on public.transport_opening_invoice_lines for each row execute function public.transport_opening_invoice_immutable();
create trigger opening_allocation_immutable before update or delete on public.transport_opening_invoice_allocations for each row execute function public.transport_opening_invoice_immutable();
create trigger opening_request_immutable before update or delete on public.transport_opening_invoice_requests for each row execute function public.transport_opening_invoice_immutable();

create view public.transport_opening_invoice_balances with(security_invoker=true) as
with paid as (select a.document_id,sum(a.amount) amount from public.transport_opening_invoice_allocations a join public.transport_active_journals j on j.id=a.journal_entry_id group by a.document_id),
trips as(select l.document_id,array_agg(l.trip_id order by h.source_row,l.trip_id) trip_ids,string_agg(public.transport_display_trip_no(t.id,t.trip_no),' / ' order by h.source_row,l.trip_id) trip_no
 from public.transport_opening_invoice_lines l join public.transport_trips t on t.id=l.trip_id left join public.transport_historical_trip_identity h on h.trip_id=t.id group by l.document_id)
select d.*,d.id order_id,coalesce(d.original_reference,'Opening Trip '||t.trip_no) order_no,d.opening_date order_date,'opening_balance'::text kind,
 t.trip_ids,t.trip_no,d.original_gross current_billed_gross,d.historical_settled+coalesce(p.amount,0) current_paid_gross,
 0::numeric current_refunded_gross,greatest(d.opening_remaining-coalesce(p.amount,0),0) current_outstanding_gross,
 greatest(coalesce(p.amount,0)-d.opening_remaining,0) current_credit_gross
from public.transport_opening_invoice_documents d join public.transport_active_journals j on j.id=d.journal_entry_id join trips t on t.document_id=d.id left join paid p on p.document_id=d.id;
revoke all on public.transport_opening_invoice_balances from public,anon;
grant select on public.transport_opening_invoice_balances to authenticated;

-- Only source evidence and immutable links are inserted. The existing cutover journal is untouched.
create function public.transport_link_opening_invoices() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();j uuid;day date;ct integer;
begin
 if auth.uid() is null or c is null or b is null or loc is null or not exists(select 1 from public.company_memberships where company_id=c and user_id=auth.uid() and role='company_owner' and is_active)
 or not public.transport_financial_read_allowed('customer') or not public.transport_financial_read_allowed('supplier') then raise exception 'Company owner and both financial views required';end if;
 perform pg_advisory_xact_lock(hashtextextended('opening-invoice-link:'||c||':'||b||':'||loc,0));
 select count(*),min(x.id::text)::uuid,min(x.entry_date) into ct,j,day from public.transport_active_journals x where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc and x.source_document_type='cutover_opening_balances';
 if ct<>1 then raise exception 'Exactly one active posted cutover journal is required';end if;
 perform t.id from public.transport_trips t join public.transport_historical_operational_mapping m on m.trip_id=t.id where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc order by t.id for update of t;
 if exists(select 1 from public.transport_historical_operational_mapping m join public.transport_customer_document_trips x on x.trip_id=m.trip_id where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc)
 or exists(select 1 from public.transport_historical_operational_mapping m join public.transport_supplier_document_rents x on x.trip_id=m.trip_id where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc)
 then raise exception 'Historical Trips already have native invoice evidence; reconciliation required before carry-forward linking';end if;
 if exists(select 1 from public.transport_opening_invoice_documents where company_id=c and business_unit_id=b and operating_location_id=loc) then
 return jsonb_build_object('linked',0,'already_linked',true);end if;
 create temporary table opening_link_source on commit drop as
 with source as (
 select m.company_id,m.business_unit_id,m.operating_location_id,'customer'::text side,t.customer_id party_id,cu.name party_name,t.id trip_id,m.source_row,
 nullif(btrim(m.raw_source->>4),'') ref,(m.raw_source->>20)::numeric net,(m.raw_source->>23)::numeric gross,(m.raw_source->>25)::numeric remaining
 from public.transport_historical_operational_mapping m join public.transport_trips t on t.id=m.trip_id join public.customers cu on cu.id=t.customer_id and cu.company_id=m.company_id
 where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc
 union all
 select m.company_id,m.business_unit_id,m.operating_location_id,'supplier',s.id,s.name,m.trip_id,m.source_row,
 nullif(btrim(m.raw_source->>13),''),(m.raw_source->>15)::numeric,(m.raw_source->>17)::numeric,(m.raw_source->>18)::numeric
 from public.transport_historical_operational_mapping m join public.suppliers s on s.company_id=m.company_id and public.transport_master_normalized_key(s.name)=public.transport_master_normalized_key(m.raw_source->>7)
 where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc and not m.company_owned
 ), ranked as(select *,floor(remaining*100) floor_cents,
 row_number() over(partition by side,party_id order by remaining*100-floor(remaining*100) desc,source_row,trip_id) fractional_rank,
 round(sum(remaining) over(partition by side,party_id),2)*100-sum(floor(remaining*100)) over(partition by side,party_id) extra_cents from source)
 select *,md5(c::text||':'||b::text||':'||loc::text||':'||side||':'||party_id::text||':'||case when ref~'[0-9]' then ref else trip_id::text end)::uuid document_id,
 (floor_cents+case when fractional_rank<=extra_cents then 1 else 0 end)/100 opening_remaining from ranked;
 if (select count(*) from opening_link_source where side='customer')<>(select count(*) from public.transport_historical_operational_mapping where company_id=c and business_unit_id=b and operating_location_id=loc)
 or (select count(*) from opening_link_source where side='supplier')<>(select count(*) from public.transport_historical_operational_mapping where company_id=c and business_unit_id=b and operating_location_id=loc and not company_owned)
 then raise exception 'Missing or ambiguous source party mappings';end if;
 if exists(with source_totals as(select side,party_id,sum(opening_remaining) amount from opening_link_source group by side,party_id),
 ledger_totals as(select party_type side,party_id,round(sum(case when party_type='supplier' then credit-debit else debit-credit end),2) amount from public.journal_lines where entry_id=j and party_type in('customer','supplier') group by party_type,party_id)
 select 1 from source_totals s full join ledger_totals l using(side,party_id) where coalesce(s.amount,0)<>coalesce(l.amount,0)) then raise exception 'Source balances do not reconcile to posted party cutover; no invoices linked';end if;
 insert into public.transport_opening_invoice_documents(id,company_id,business_unit_id,operating_location_id,side,party_id,party_name,original_reference,opening_date,original_net,original_gross,historical_settled,opening_remaining,journal_entry_id,created_by)
 select document_id,c,b,loc,side,party_id,min(party_name),case when min(ref)~'[0-9]' then min(ref) else null end,day,sum(net),sum(gross),sum(gross)-sum(opening_remaining),sum(opening_remaining),j,auth.uid() from opening_link_source group by document_id,side,party_id;
 get diagnostics ct=row_count;
 insert into public.transport_opening_invoice_lines(document_id,trip_id,side,source_reference,original_net,original_gross,source_remaining,opening_remaining)
 select document_id,trip_id,side,ref,net,gross,remaining,opening_remaining from opening_link_source;
 return jsonb_build_object('linked',ct,'trips',(select count(*) from opening_link_source where side='customer'),'financial_postings',0);
end $$;
revoke all on function public.transport_link_opening_invoices() from public,anon;
grant execute on function public.transport_link_opening_invoices() to authenticated;

create function public.transport_opening_invoice_query(p_kind text,p_side text,p_filters jsonb default '{}',p_limit integer default 1000,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.transport_financial_read_allowed(p_side) then raise exception 'Side financial view and active workspace required';end if;
 if p_kind not in('documents','movements','summary','details') or jsonb_typeof(p_filters)<>'object' or octet_length(p_filters::text)>10000 then raise exception 'Invalid opening invoice query';end if;
 if p_kind='details' then
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from(select d.side,d.id order_id,d.party_id,d.party_name,coalesce(d.original_reference,'Opening Trip '||public.transport_display_trip_no(t.id,t.trip_no)) order_no,
 public.transport_display_trip_no(t.id,t.trip_no) trip_no,t.trip_date,m.raw_source->>9 from_location,m.raw_source->>10 to_location,h.vehicle_no_snapshot vehicle_no,h.driver_name_snapshot driver_name,h.owner_name_snapshot owner_name,h.truck_type_snapshot truck_type,t.po_do_job_no,
 d.original_net base_amount,null::numeric charge_amount,d.original_gross-d.original_net tax_amount,d.original_gross total_amount,'Original source totals; separate charge breakdown not supplied'::text charge_breakdown
 from public.transport_opening_invoice_documents d join public.transport_opening_invoice_lines l on l.document_id=d.id join public.transport_trips t on t.id=l.trip_id
 join public.transport_historical_operational_mapping m on m.trip_id=t.id join public.transport_historical_trip_identity h on h.trip_id=t.id join public.transport_active_journals j on j.id=d.journal_entry_id
 where d.company_id=c and d.business_unit_id=b and d.operating_location_id=loc and d.side=p_side
 and (nullif(p_filters->>'party','') is null or d.party_id=(p_filters->>'party')::uuid)
 and (nullif(p_filters->>'to','') is null or d.opening_date<=(p_filters->>'to')::date)
 and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(concat_ws(' ',public.transport_display_trip_no(t.id,t.trip_no),d.original_reference,d.party_name)))>0)
 order by d.id,l.trip_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0))q;
 return answer;end if;
 if p_kind='summary' then
 select jsonb_build_object('count',count(*),'outstanding',coalesce(sum(d.current_outstanding_gross),0),'credit',coalesce(sum(d.current_credit_gross),0)) into answer
 from public.transport_opening_invoice_balances d where d.company_id=c and d.business_unit_id=b and d.operating_location_id=loc and d.side=p_side
 and (nullif(p_filters->>'party','') is null or d.party_id=(p_filters->>'party')::uuid)
 and (nullif(p_filters->>'to','') is null or d.order_date<=(p_filters->>'to')::date)
 and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(concat_ws(' ',d.trip_no,d.order_no,d.party_name)))>0);
 return answer;end if;
 with docs as(select d.* from public.transport_opening_invoice_balances d where d.company_id=c and d.business_unit_id=b and d.operating_location_id=loc and d.side=p_side
 and (nullif(p_filters->>'party','') is null or d.party_id=(p_filters->>'party')::uuid)
 and (nullif(p_filters->>'to','') is null or d.order_date<=(p_filters->>'to')::date)
 and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(concat_ws(' ',d.trip_no,d.order_no,d.party_name)))>0)),
 events as(select d.id::text||':opening' event_id,d.side,d.party_id,d.party_name,d.order_id,d.order_no,d.trip_ids,d.trip_no,d.kind,'opening_balance'::text event_type,d.journal_entry_id,j.entry_no,d.opening_date event_date,d.created_at,
 'Imported opening balance; original issue date unavailable'::text description,
 case when d.side='customer' then greatest(d.opening_remaining,0) else greatest(-d.opening_remaining,0) end debit,
 case when d.side='supplier' then greatest(d.opening_remaining,0) else greatest(-d.opening_remaining,0) end credit,
 d.opening_remaining amount,0::numeric net_amount,d.original_net,d.original_gross,d.historical_settled
 from docs d join public.journal_entries j on j.id=d.journal_entry_id
 union all
 select d.id::text||':'||j.id::text,d.side,d.party_id,d.party_name,d.order_id,d.order_no,d.trip_ids,d.trip_no,d.kind,
 case when j.reversal_of_entry_id is not null then 'reversal_' else '' end||case when d.side='customer' then 'receipt' else 'payment' end,
 j.id,j.entry_no,j.entry_date,j.created_at,j.description,
 case when d.side='supplier' and j.reversal_of_entry_id is null or d.side='customer' and j.reversal_of_entry_id is not null then sum(a.amount) else 0 end,
 case when d.side='customer' and j.reversal_of_entry_id is null or d.side='supplier' and j.reversal_of_entry_id is not null then sum(a.amount) else 0 end,
 case when j.reversal_of_entry_id is not null then sum(a.amount) else -sum(a.amount) end,0::numeric,null::numeric,null::numeric,null::numeric
 from docs d join public.transport_opening_invoice_allocations a on a.document_id=d.id join public.journal_entries j on j.id=a.journal_entry_id or j.reversal_of_entry_id=a.journal_entry_id
 where j.status='posted' and (nullif(p_filters->>'to','') is null or j.entry_date<=(p_filters->>'to')::date)
 group by d.id,d.side,d.party_id,d.party_name,d.order_id,d.order_no,d.trip_ids,d.trip_no,d.kind,j.id)
 select coalesce(jsonb_agg(q.row),'[]') into answer from(
 select row from (select d.order_id::text sort_key,to_jsonb(d) row from docs d where p_kind='documents' union all select e.event_id,to_jsonb(e) from events e where p_kind='movements') r order by sort_key limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0))q;
 return answer;
end $$;
revoke all on function public.transport_opening_invoice_query(text,text,jsonb,integer,integer) from public,anon;
grant execute on function public.transport_opening_invoice_query(text,text,jsonb,integer,integer) to authenticated;

create function public.transport_settle_opening_invoices(p_request_id uuid,p_side text,p_party_id uuid,p_date date,p_account_id uuid,p_method text,p_allocations jsonb,p_reference text default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();u uuid:=public.legacy_data_user_id();payload jsonb;cached public.transport_opening_invoice_requests;
 doc record;item jsonb;total numeric:=0;value numeric;j uuid;party_account uuid;party_text text;cash_text text;cash_kind text;name text;entry text;response jsonb;invoice_refs text;
begin
 perform public.transport_finance_assert('settlement');perform public.assert_module_permission('accounting','post');
 if auth.uid() is null or c is null or b is null or loc is null or u is null or p_request_id is null or p_party_id is null or p_date is null or p_side is null or p_method is null or p_side not in('customer','supplier') or p_method not in('cash','bank') or not public.transport_financial_read_allowed(p_side) then raise exception 'Valid opening invoice settlement, side view and active workspace required';end if;
 if jsonb_typeof(p_allocations) is distinct from 'array' or jsonb_array_length(p_allocations) not between 1 and 500 or octet_length(p_allocations::text)>100000 then raise exception '1–500 reviewed allocations required';end if;
 if exists(select 1 from jsonb_array_elements(p_allocations)x group by x->>'document_id' having count(*)>1) then raise exception 'Duplicate invoice allocation';end if;
 payload:=jsonb_build_object('side',p_side,'party',p_party_id,'date',p_date,'account',p_account_id,'method',p_method,'allocations',p_allocations,'reference',p_reference);
 perform pg_advisory_xact_lock(hashtextextended('opening-invoice-request:'||c||':'||b||':'||loc||':'||p_request_id,0));
 select * into cached from public.transport_opening_invoice_requests where company_id=c and business_unit_id=b and operating_location_id=loc and request_id=p_request_id;
 if found then if cached.payload<>payload then raise exception 'Request ID already used with different settlement';end if;return cached.response;end if;
 perform pg_advisory_xact_lock(hashtextextended('opening-invoice-party:'||c||':'||b||':'||loc||':'||p_side||':'||p_party_id,0));
 select account_id into party_account from public.account_mappings where company_id=c and user_id=u and mapping_key=case when p_side='customer' then 'accounts_receivable' else 'accounts_payable' end;
 if p_side='customer' then select cu.name into name from public.customers cu where id=p_party_id and company_id=c and user_id=u and account_id=party_account and is_active;
 else select s.name into name from public.suppliers s where id=p_party_id and company_id=c and user_id=u and account_id=party_account and is_active;end if;
 if name is null then raise exception 'Active party/account mapping mismatch';end if;
 select code||' - '||coa.name into party_text from public.chart_of_accounts coa where id=party_account and company_id=c and user_id=u and is_active and not is_group and allow_manual_entries;
 select code||' - '||coa.name,detail_type into cash_text,cash_kind from public.chart_of_accounts coa where id=p_account_id and company_id=c and user_id=u and is_active and not is_group and allow_manual_entries;
 if party_text is null or cash_text is null or cash_kind is distinct from (case when p_method='cash' then 'Cash on Hand' else 'Bank Account' end) then raise exception 'Valid mapped party and cash/bank posting accounts required';end if;
 for item in select x from jsonb_array_elements(p_allocations)x order by x->>'document_id' loop
 value:=(item->>'amount')::numeric;if value is null or value<=0 or value<>round(value,2) then raise exception 'Positive two-decimal allocation required';end if;
 select d.* into doc from public.transport_opening_invoice_balances d where d.order_id=(item->>'document_id')::uuid and d.company_id=c and d.business_unit_id=b and d.operating_location_id=loc and d.side=p_side and d.party_id=p_party_id;
 if not found or value>doc.current_outstanding_gross then raise exception 'Opening invoice allocation exceeds balance or is outside selected party';end if;
 if not exists(select 1 from public.journal_lines where entry_id=doc.journal_entry_id and party_type=p_side and party_id=p_party_id and account_id=party_account) then raise exception 'Current control account differs from the posted opening party account; reconcile mapping before settlement';end if;
 if p_date<doc.opening_date then raise exception 'Settlement cannot precede opening date';end if;
 perform 1 from public.journal_entries where id=doc.journal_entry_id and status='posted' for update;
 if not found then raise exception 'Posted opening journal required';end if;
 total:=total+value;
 invoice_refs:=concat_ws(' / ',invoice_refs,doc.order_no);
 end loop;
 if total>greatest((select coalesce(sum(opening_remaining-(current_paid_gross-historical_settled)),0) from public.transport_opening_invoice_balances where company_id=c and business_unit_id=b and operating_location_id=loc and side=p_side and party_id=p_party_id),0) then raise exception 'Selected party has existing opening credits; new cash cannot exceed its net opening balance';end if;
 entry:='OI-'||upper(substr(replace(p_request_id::text,'-',''),1,20));
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,payment_mode,party_name,trans_type,source_module,source_document_type,source_document_id,payment_amount)
 values(u,c,b,loc,entry,p_date,'Opening invoice '||case when p_side='customer' then 'receipt' else 'payment' end||' - '||name||' / '||left(invoice_refs,1000)||coalesce(' / '||nullif(btrim(p_reference),''),''),'draft',initcap(p_method),name,case when p_side='customer' then 'Customer Receipt' else 'Supplier Payment' end,'transport','transport_opening_'||case when p_side='customer' then 'receipt' else 'payment' end,p_request_id,total) returning id into j;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account,account_id,debit,credit,party_type,party_id,party_name)
 values(u,c,b,loc,j,party_text,party_account,case when p_side='supplier' then total else 0 end,case when p_side='customer' then total else 0 end,p_side,p_party_id,name);
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account,account_id,debit,credit)
 values(u,c,b,loc,j,cash_text,p_account_id,case when p_side='customer' then total else 0 end,case when p_side='supplier' then total else 0 end);
 perform public.post_journal_entry(j);
 for item in select x from jsonb_array_elements(p_allocations)x loop
 value:=(item->>'amount')::numeric;
 with remain as(select l.trip_id,greatest(l.opening_remaining-coalesce(sum(a.amount) filter(where aj.id is not null),0),0) remaining
 from public.transport_opening_invoice_lines l left join public.transport_opening_invoice_allocations a on a.document_id=l.document_id and a.trip_id=l.trip_id left join public.transport_active_journals aj on aj.id=a.journal_entry_id
 where l.document_id=(item->>'document_id')::uuid group by l.trip_id,l.opening_remaining), shares as(select *,value*100*remaining/sum(remaining) over() exact_cents from remain where remaining>0), ranked as(select *,floor(exact_cents) floor_cents,row_number() over(order by exact_cents-floor(exact_cents) desc,trip_id) rn,value*100-sum(floor(exact_cents)) over() extras from shares)
 insert into public.transport_opening_invoice_allocations(document_id,trip_id,journal_entry_id,amount,created_by)
 select (item->>'document_id')::uuid,trip_id,j,(floor_cents+case when rn<=extras then 1 else 0 end)/100,auth.uid() from ranked where floor_cents+case when rn<=extras then 1 else 0 end>0;
 if (select coalesce(sum(amount),0) from public.transport_opening_invoice_allocations where journal_entry_id=j and document_id=(item->>'document_id')::uuid)<>value then raise exception 'Trip allocation total mismatch';end if;
 end loop;
 response:=jsonb_build_object('success',true,'payments',jsonb_build_array(jsonb_build_object('journal_entry_id',j,'entry_no',entry,'amount',total)));
 insert into public.transport_opening_invoice_requests(company_id,business_unit_id,operating_location_id,request_id,payload,response,created_by) values(c,b,loc,p_request_id,payload,response,auth.uid());
 return response;
end $$;
revoke all on function public.transport_settle_opening_invoices(uuid,text,uuid,date,uuid,text,jsonb,text) from public,anon;
grant execute on function public.transport_settle_opening_invoices(uuid,text,uuid,date,uuid,text,jsonb,text) to authenticated;

-- New allocations flow back into both register readers. Historical snapshots remain immutable.
create view public.transport_historical_payment_effective with(security_invoker=true) as
with payments as(select a.trip_id,d.side,sum(a.amount) amount,max(j.entry_date) payment_date from public.transport_opening_invoice_allocations a
 join public.transport_opening_invoice_documents d on d.id=a.document_id join public.transport_active_journals j on j.id=a.journal_entry_id group by a.trip_id,d.side),
lines as(select trip_id,max(document_id::text) filter(where side='customer')::uuid customer_document_id,max(document_id::text) filter(where side='supplier')::uuid supplier_document_id,
 sum(opening_remaining) filter(where side='customer') customer_remaining,sum(opening_remaining) filter(where side='supplier') supplier_remaining from public.transport_opening_invoice_lines group by trip_id)
select m.trip_id,m.company_id,m.business_unit_id,m.operating_location_id,h.source_hash,
 coalesce(h.received_gross,0)+coalesce(cp.amount,0) received_gross,coalesce(h.paid_gross,0)+coalesce(sp.amount,0) paid_gross,
 coalesce(sp.payment_date,h.payment_date) payment_date,h.evidence,h.created_at,
 coalesce(l.customer_remaining,(m.raw_source->>25)::numeric)-coalesce(cp.amount,0) customer_remaining_effective,
 case when m.company_owned then 0::numeric else coalesce(l.supplier_remaining,(m.raw_source->>18)::numeric)-coalesce(sp.amount,0) end supplier_remaining_effective,
 l.customer_document_id opening_customer_document_id,l.supplier_document_id opening_supplier_document_id
from public.transport_historical_operational_mapping m left join public.transport_historical_payment_snapshots h on h.trip_id=m.trip_id
left join payments cp on cp.trip_id=m.trip_id and cp.side='customer' left join payments sp on sp.trip_id=m.trip_id and sp.side='supplier' left join lines l on l.trip_id=m.trip_id;
revoke all on public.transport_historical_payment_effective from public,anon;
grant select on public.transport_historical_payment_effective to authenticated;

do $patch$ declare d text;signature regprocedure:='public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure;
begin
 d:=pg_get_viewdef('public.transport_financial_register'::regclass,true);
 d:=replace(d,'transport_historical_payment_snapshots hp','transport_historical_payment_effective hp');
 d:=regexp_replace(d,'\(hm\.raw_source\s*->>\s*25\)::numeric','hp.customer_remaining_effective','g');
 d:=regexp_replace(d,'\(hm\.raw_source\s*->>\s*18\)::numeric','hp.supplier_remaining_effective','g');
 d:=replace(d,'f.customer_rate_locked,','(f.customer_rate_locked OR hp.opening_customer_document_id IS NOT NULL) AS customer_rate_locked,');
 d:=replace(d,'f.supplier_rate_locked,','(f.supplier_rate_locked OR hp.opening_supplier_document_id IS NOT NULL) AS supplier_rate_locked,');
 d:=replace(d,'hm.paper_status AS historical_paper_status','hm.paper_status AS historical_paper_status, hp.opening_customer_document_id, hp.opening_supplier_document_id');
 execute 'create or replace view public.transport_financial_register as '||d;
 d:=pg_get_functiondef(signature);
 d:=replace(d,'transport_historical_payment_snapshots hp','transport_historical_payment_effective hp');
 d:=regexp_replace(d,'\(hm\.raw_source\s*->>\s*25\)::numeric','hp.customer_remaining_effective','g');
 d:=regexp_replace(d,'\(hm\.raw_source\s*->>\s*18\)::numeric','hp.supplier_remaining_effective','g');
 d:=replace(d,'''invoiced'',false,''customer_rate_locked'',false,''supplier_rate_locked'',false,',
 '''invoiced'',false,''customer_rate_locked'',exists(select 1 from public.transport_opening_invoice_lines ol where ol.trip_id=t.id and ol.side=''customer''),''supplier_rate_locked'',exists(select 1 from public.transport_opening_invoice_lines ol where ol.trip_id=t.id and ol.side=''supplier''),
 ''opening_customer_document_id'',(select ol.document_id from public.transport_opening_invoice_lines ol where ol.trip_id=t.id and ol.side=''customer''),''opening_supplier_document_id'',(select ol.document_id from public.transport_opening_invoice_lines ol where ol.trip_id=t.id and ol.side=''supplier''),');
 execute d;
end $patch$;

do $mask$ declare d text:=pg_get_functiondef('public._transport_mask_financial_row(jsonb,boolean,boolean)'::regprocedure);begin
 if position('''customer_rate'',''customer_rate_state''' in d)=0 or position('''owner_supplier_id'',''owner_name''' in d)=0 then raise exception 'Unexpected financial mask; opening side keys stopped';end if;
 d:=replace(d,'''customer_rate'',''customer_rate_state''','''opening_customer_document_id'',''customer_rate'',''customer_rate_state''');
 d:=replace(d,'''owner_supplier_id'',''owner_name''','''opening_supplier_document_id'',''owner_supplier_id'',''owner_name''');
 execute d;
end $mask$;

create function public.transport_opening_trip_commercial_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.transport_opening_invoice_lines where trip_id=old.id) then
 -- job_status is generated from the immutable Job No; NEW generated values are null in BEFORE triggers.
 if (to_jsonb(new)-array['job_status','notes','ppr_status','ppr_receiver_type','ppr_received_by','ppr_received_by_employee_id','ppr_received_by_name','ppr_received_date','ppr_attachment_path','updated_at','updated_by'])
 is distinct from (to_jsonb(old)-array['job_status','notes','ppr_status','ppr_receiver_type','ppr_received_by','ppr_received_by_employee_id','ppr_received_by_name','ppr_received_date','ppr_attachment_path','updated_at','updated_by'])
 then raise exception 'Imported Trip is linked to posted opening balances; only Papers Received and Remarks may change (fields: %)',(select string_agg(k,',') from jsonb_object_keys(to_jsonb(new)) k where to_jsonb(new)->k is distinct from to_jsonb(old)->k);end if;
 end if;return new;
end $$;
revoke all on function public.transport_opening_trip_commercial_guard() from public,anon,authenticated;
create trigger opening_trip_commercial_guard before update on public.transport_trips for each row execute function public.transport_opening_trip_commercial_guard();

-- Money already allocated here must not appear as an advance or be allocated again elsewhere.
do $advance$ declare d text:=pg_get_viewdef('public.transport_party_advances'::regclass,true);begin
 d:=regexp_replace(d,';[[:space:]]*$','');
 execute 'create or replace view public.transport_party_advances with(security_invoker=true) as select a.* from ('||d||') a where not exists(select 1 from public.journal_entries j where j.id=a.journal_entry_id and j.source_document_type in (''transport_opening_receipt'',''transport_opening_payment''))';
end $advance$;
create function public.transport_opening_no_double_allocation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin if exists(select 1 from public.journal_entries where id=new.journal_entry_id and source_document_type in('transport_opening_receipt','transport_opening_payment')) then raise exception 'This voucher is already allocated to imported opening invoices';end if;return new;end $$;
revoke all on function public.transport_opening_no_double_allocation() from public,anon,authenticated;
create trigger opening_no_double_receipt before insert or update on public.invoice_payment_allocations for each row execute function public.transport_opening_no_double_allocation();
create trigger opening_no_double_payment before insert or update on public.purchase_payment_allocations for each row execute function public.transport_opening_no_double_allocation();

create function public.transport_opening_no_rebill() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin if exists(select 1 from public.transport_opening_invoice_lines where trip_id=new.trip_id and side=case when tg_table_name='transport_customer_document_trips' then 'customer' else 'supplier' end) then raise exception 'Original Trip is already linked to imported opening balances; do not bill it again';end if;return new;end $$;
revoke all on function public.transport_opening_no_rebill() from public,anon,authenticated;
create trigger opening_no_customer_rebill before insert on public.transport_customer_document_trips for each row execute function public.transport_opening_no_rebill();
create trigger opening_no_supplier_rebill before insert on public.transport_supplier_document_rents for each row execute function public.transport_opening_no_rebill();
create function public.transport_opening_cutover_protect() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin if new.reversal_of_entry_id is not null and exists(select 1 from public.transport_opening_invoice_documents where journal_entry_id=new.reversal_of_entry_id) then raise exception 'This posted cutover backs imported invoice balances; use controlled source reconciliation';end if;return new;end $$;
revoke all on function public.transport_opening_cutover_protect() from public,anon,authenticated;
create trigger opening_cutover_protect before insert or update of reversal_of_entry_id on public.journal_entries for each row execute function public.transport_opening_cutover_protect();

-- The raw audit contains both financial sides. Restore its side checks, including original Trip search.
do $audit$ declare d text:=replace(pg_get_functiondef('public.transport_trip_audit_report(text,integer,integer)'::regprocedure),chr(13),'');marker text:=E'begin\n if auth.uid()';begin
 if position(marker in d)=0 then raise exception 'Unexpected raw audit reader; side guard patch stopped';end if;
 d:=replace(d,marker,E'begin\n if not public.transport_financial_read_allowed(''customer'') or not public.transport_financial_read_allowed(''supplier'') then raise exception ''Both financial side view permissions required for raw Trip audit'';end if;\n if auth.uid()');
 execute d;
end $audit$;
create or replace function public.transport_cancel_opening_invoice_settlement(
  p_entry_id uuid, p_reversal_date date, p_reason text
) returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp'
as $$
declare
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  loc uuid:=public.current_operating_location_id();
  u uuid:=public.legacy_data_user_id();
  src public.journal_entries%rowtype;
  rev_id uuid;
  rev_no text;
  post_result jsonb;
  base_ccy text;
  n_lines integer;
  n_ledgers integer;
  debit_total numeric;
  credit_total numeric;
begin
  if not public.owner_posted_control_access() then
    raise exception 'Only the NAVILO software owner can cancel posted opening invoice payments.';
  end if;
  perform public.assert_module_permission('accounting','post');
  if p_entry_id is null or p_reversal_date is null then
    raise exception 'Journal and cancellation date are required.';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then
    raise exception 'A cancellation reason of at least 10 characters is required.';
  end if;
  if loc is null or u is null then
    raise exception 'Active operating location and accounting identity required.';
  end if;
  select * into src from public.journal_entries
    where id=p_entry_id and company_id=c and business_unit_id=b and user_id=u
      and operating_location_id=loc for update;
  if not found then raise exception 'Journal not found in active company, business unit and location.'; end if;
  if src.status <> 'posted' then raise exception 'Only posted journals can be cancelled.'; end if;
  if src.reversal_of_entry_id is not null or src.fiscal_year_closure_id is not null
     or src.monthly_profit_closure_id is not null then
    raise exception 'Reversal, period close and profit close journals cannot be cancelled here.';
  end if;
  if src.source_module is distinct from 'transport' or src.source_document_type not in ('transport_opening_receipt','transport_opening_payment')
     or not exists(select 1 from public.transport_opening_invoice_allocations where journal_entry_id=src.id) then
    raise exception 'Only an allocated opening invoice settlement is eligible';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('opening-invoice-party:'||c||':'||b||':'||loc||':'||d.side||':'||d.party_id,0))
  from public.transport_opening_invoice_allocations a join public.transport_opening_invoice_documents d on d.id=a.document_id where a.journal_entry_id=src.id limit 1;
  if exists(select 1 from public.cutover_opening_balance_batches
    where journal_entry_id=src.id) then
    raise exception 'Cutover opening balances require a separate controlled correction.';
  end if;
  if p_reversal_date < src.entry_date then
    raise exception 'Cancellation date cannot precede the original journal date.';
  end if;
  select base_currency_code into base_ccy from public.companies where id=c;
  if base_ccy is null or coalesce(src.currency_code,base_ccy) <> base_ccy
     or coalesce(src.exchange_rate,1) <> 1 then
    raise exception 'Foreign-currency journals require the FX-specific correction workflow.';
  end if;
  if exists(select 1 from public.journal_entries
     where reversal_of_entry_id=src.id and company_id=c and business_unit_id=b)
     or exists(select 1 from public.owner_posted_control_events
     where company_id=c and business_unit_id=b and document_type='manual_journal'
       and document_id=src.id and action_type='cancel') then
    raise exception 'This journal already has a cancellation or reversal.';
  end if;
  select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)
    into n_lines,debit_total,credit_total
    from public.journal_lines
    where entry_id=src.id and company_id=c and business_unit_id=b;
  select count(*) into n_ledgers from public.ledgers
    where journal_entry_id=src.id and company_id=c and business_unit_id=b;
  if n_lines=0 or n_ledgers<>n_lines or abs(debit_total-credit_total)>=0.01 then
    raise exception 'Original journal/ledger reconciliation failed; cancellation blocked.';
  end if;
  rev_no:='OWNER-REV-'||src.entry_no;
  insert into public.journal_entries(
    user_id,company_id,business_unit_id,operating_location_id,
    entry_no,entry_date,description,status,payment_mode,party_name,trans_type,
    reversal_of_entry_id,reversal_reason,currency_code,exchange_rate,
    accounting_dimension_id
  ) values(
    u,c,b,loc,rev_no,p_reversal_date,
    'Owner cancellation of '||src.entry_no||': '||btrim(p_reason),
    'draft',src.payment_mode,src.party_name,'Journal Reversal',
    src.id,btrim(p_reason),base_ccy,1,src.accounting_dimension_id
  ) returning id into rev_id;
  insert into public.journal_lines(
    user_id,company_id,business_unit_id,operating_location_id,entry_id,
    account_id,account,party_type,party_id,party_name,debit,credit,
    accounting_dimension_id,transport_vehicle_id,transport_vehicle_no
  )
  select u,c,b,loc,rev_id,account_id,account,party_type,party_id,party_name,
         round(coalesce(credit,0),2),round(coalesce(debit,0),2),
         accounting_dimension_id,transport_vehicle_id,transport_vehicle_no
  from public.journal_lines
  where entry_id=src.id and company_id=c and business_unit_id=b;
  post_result:=public.post_journal_entry(rev_id);
  if coalesce(post_result->>'status','')<>'posted' then
    raise exception 'Cancellation reversal did not post successfully.';
  end if;
  if (select count(*) from public.ledgers where journal_entry_id=rev_id
      and company_id=c and business_unit_id=b)<>n_lines then
    raise exception 'Reversal ledger reconciliation failed.';
  end if;
  insert into public.owner_posted_control_events(company_id,business_unit_id,document_type,document_id,action_type,reason,performed_by,reversal_document_id,metadata)
  values(c,b,'opening_invoice_settlement',src.id,'cancel',btrim(p_reason),auth.uid(),rev_id,jsonb_build_object('original_entry_no',src.entry_no,'reversal_entry_no',rev_no));
  insert into public.audit_logs(user_id,module,action,table_name,record_id,performed_by,metadata)
  values(u,'transport','CANCEL_OPENING_INVOICE_SETTLEMENT','journal_entries',src.id,auth.uid(),jsonb_build_object('reversal_id',rev_id,'reason',btrim(p_reason)));
  return jsonb_build_object('success',true,'reversal_entry_id',rev_id,'reversal_entry_no',rev_no);
end $$;
revoke all on function public.transport_cancel_opening_invoice_settlement(uuid,date,text) from public,anon;
grant execute on function public.transport_cancel_opening_invoice_settlement(uuid,date,text) to authenticated;

notify pgrst,'reload schema';
commit;
