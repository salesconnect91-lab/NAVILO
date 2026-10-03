-- Preserve existing canonical engine definitions; extend numeric identifiers past
-- 9,999 without LPAD truncation and make MAX(counter) / allocations indexed.
do $$
declare signature text;definition text;
begin
 foreach signature in array array['public.pay_supplier_transport_preserved_core(uuid,date,uuid,text,text,text,text,uuid,numeric)','public.receive_customer_payment_transport_preserved_core(uuid,date,uuid,text,text,text,text,jsonb,numeric)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('lpad(v_next::text,4,''0'')' in definition)=0 then raise exception 'Unexpected canonical payment numbering definition: %',signature;end if;
  execute replace(definition,'lpad(v_next::text,4,''0'')','lpad(v_next::text,greatest(4,length(v_next::text)),''0'')');
 end loop;
end $$;
create index if not exists journal_receipt_counter_idx on public.journal_entries
(user_id,company_id,business_unit_id,operating_location_id,((nullif(substring(entry_no from '^CR-([0-9]+)$'),'')::bigint)) desc)
where entry_no~'^CR-[0-9]+$';
create index if not exists journal_supplier_payment_counter_idx on public.journal_entries
(user_id,company_id,business_unit_id,operating_location_id,((nullif(substring(entry_no from '^SP-([0-9]+)$'),'')::bigint)) desc)
where entry_no~'^SP-[0-9]+$';
create index if not exists history_customer_allocation_order_idx on public.invoice_payment_allocations(sales_order_id,user_id,company_id,business_unit_id);
create index if not exists history_supplier_allocation_order_idx on public.purchase_payment_allocations(purchase_order_id,user_id,company_id,business_unit_id,operating_location_id);
create index if not exists history_sales_service_order_idx on public.sales_service_lines(order_id);
create index if not exists history_purchase_service_order_idx on public.purchase_service_lines(order_id);

-- Internal, source-indexed equivalent of the report view's monetary balance.
-- This avoids expanding all Transport documents inside every allocation trigger.
create function public.transport_service_balance_for_order(p_side text,p_order_id uuid)
returns table(outstanding_gross numeric,credit_gross numeric,paid_gross numeric,refunded_gross numeric)
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare gross numeric;credited numeric;paid numeric;refunded numeric;c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
begin
 if auth.uid() is null or c is null or b is null or loc is null then return;end if;
 if p_side='customer' then
  select s.total into gross from public.sales_orders s
  where s.id=p_order_id and s.company_id=c and s.business_unit_id=b and s.operating_location_id=loc and s.status='posted'
  and exists(select 1 from public.transport_customer_documents d join public.transport_active_journals j on j.id=d.journal_entry_id where d.sales_order_id=s.id);
  if not found then return;end if;
  select coalesce(sum(a.amount),0) into paid from public.invoice_payment_allocations a join public.transport_active_journals j on j.id=a.journal_entry_id where a.sales_order_id=p_order_id;
 elsif p_side='supplier' then
  select s.total into gross from public.purchase_orders s
  where s.id=p_order_id and s.company_id=c and s.business_unit_id=b and s.operating_location_id=loc and s.status='posted'
  and (exists(select 1 from public.transport_supplier_documents d join public.transport_active_journals j on j.id=d.journal_entry_id where d.purchase_order_id=s.id)
  or exists(select 1 from public.transport_service_cost_links d join public.transport_active_journals j on j.id=d.journal_entry_id where d.purchase_order_id=s.id));
  if not found then return;end if;
  select coalesce(sum(a.amount),0) into paid from public.purchase_payment_allocations a join public.transport_active_journals j on j.id=a.journal_entry_id where a.purchase_order_id=p_order_id;
 else return;end if;
 select coalesce(sum(n.net_amount+n.vat_amount),0) into credited from public.transport_service_note_lines n
 join public.return_notes rn on rn.id=n.note_id join public.transport_active_journals j on j.id=rn.journal_entry_id
 where n.side=p_side and n.order_id=p_order_id and rn.status='posted';
 select coalesce(sum(f.amount),0) into refunded from public.transport_service_refunds f
 join public.transport_active_journals j on j.id=f.journal_entry_id where f.side=p_side and f.order_id=p_order_id;
 return query select greatest(round(gross-credited-paid+refunded,2),0),greatest(round(paid-refunded-gross+credited,2),0),paid,refunded;
end $$;
revoke all on function public.transport_service_balance_for_order(text,uuid) from public,anon,authenticated;
create index if not exists history_cost_order_idx on public.transport_service_cost_links(purchase_order_id);
create index if not exists history_note_order_idx on public.transport_service_note_lines(side,order_id);
create index if not exists history_refund_order_idx on public.transport_service_refunds(side,order_id);
-- Preserve wrappers, credit/refund protections and payment snapshot logic.
do $$
declare spec record;definition text;
begin
 for spec in select * from (values
 ('public.receive_customer_payment(uuid,date,uuid,text,text,text,text,jsonb,numeric)',
  'from public.transport_service_document_balances where side=''customer'' and order_id=r.oid',
  'from public.transport_service_balance_for_order(''customer'',r.oid)'),
 ('public.pay_supplier(uuid,date,uuid,text,text,text,text,uuid,numeric)',
  'from public.transport_service_document_balances where side=''supplier'' and order_id=p_purchase_order_id',
  'from public.transport_service_balance_for_order(''supplier'',p_purchase_order_id)'),
 ('public.transport_refresh_document_balance(text,uuid)',
  'from public.transport_service_document_balances where side=p_side and order_id=p_order_id',
  'from public.transport_service_balance_for_order(p_side,p_order_id)'),
 ('public.transport_normalize_payment_snapshot()',
  'from public.transport_service_document_balances where side=case when tg_table_name=''sales_orders'' then ''customer'' else ''supplier'' end and order_id=new.id',
  'from public.transport_service_balance_for_order(case when tg_table_name=''sales_orders'' then ''customer'' else ''supplier'' end,new.id)')
 ) x(signature,old_query,new_query) loop
  definition:=pg_get_functiondef(spec.signature::regprocedure);
  if position(spec.old_query in definition)=0 then raise exception 'Unexpected canonical Transport balance definition: %',spec.signature;end if;
  execute replace(definition,spec.old_query,spec.new_query);
 end loop;
end $$;

-- One reviewed historical dataset per Transport workspace. Metadata only;
-- all bills, receipts, payments and journals use canonical posting coordinators.
create table public.transport_history_import_jobs(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,
 operating_location_id uuid not null,created_by uuid not null,source_hash text not null,file_name text not null,
 manifest jsonb not null,settings jsonb not null,completed_batches integer not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(company_id,business_unit_id));
create table public.transport_history_import_rows(
 job_id uuid not null references public.transport_history_import_jobs(id) on delete restrict,
 source_id text not null,payload jsonb not null,result jsonb not null,primary key(job_id,source_id));
alter table public.transport_history_import_jobs enable row level security;
alter table public.transport_history_import_rows enable row level security;
revoke all on public.transport_history_import_jobs,public.transport_history_import_rows from public,anon,authenticated;

create function public.transport_history_import_assert() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not exists(select 1 from public.business_unit_memberships
 where company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
 and user_id=auth.uid() and is_active and role in ('company_owner','admin')) then raise exception 'Workspace administrator required for one-time historical import';end if;
 perform public.transport_finance_assert('billing');perform public.transport_finance_assert('rent');perform public.transport_finance_assert('settlement');
end $$;
revoke all on function public.transport_history_import_assert() from public,anon,authenticated;

create function public.transport_prepare_history_import(p_source_hash text,p_file_name text,p_manifest jsonb,p_settings jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 job public.transport_history_import_jobs;total integer;cutoff date;
begin
 perform public.transport_history_import_assert();
 if p_source_hash is null or p_source_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_manifest) is distinct from 'array'
 or jsonb_array_length(p_manifest) not between 1 and 800 or octet_length(p_manifest::text)>3000000
 then raise exception 'Invalid history manifest';end if;
 if exists(select 1 from jsonb_array_elements(p_manifest) x where jsonb_typeof(x)<>'array' or jsonb_array_length(x) not between 1 and 25)
 then raise exception 'Historical batches require 1–25 source IDs';end if;
 select count(*) into total from jsonb_array_elements(p_manifest) a cross join lateral jsonb_array_elements(a) n;
 if total>20000 or exists(select 1 from jsonb_array_elements(p_manifest) a cross join lateral jsonb_array_elements(a) n
 where jsonb_typeof(n)<>'string' or length(btrim(n#>>'{}')) not between 1 and 120)
 or (select count(distinct n) from jsonb_array_elements(p_manifest) a cross join lateral jsonb_array_elements(a) n)<>total
 then raise exception 'Up to 20,000 unique Source Record IDs required';end if;
 cutoff:=(p_settings->>'cutoff')::date;
 if cutoff is null or cutoff>current_date or p_settings->>'opening_reviewed' is distinct from 'true'
 then raise exception 'Historical cutoff and opening balance reconciliation required';end if;
 if not exists(select 1 from public.chart_of_accounts where id=(p_settings->>'cost_account')::uuid and company_id=c and is_active and not is_group and type='expense')
 then raise exception 'Active same-company rent expense account required';end if;
 perform pg_advisory_xact_lock(hashtextextended('transport-history:'||c::text||b::text,0));
 select * into job from public.transport_history_import_jobs where company_id=c and business_unit_id=b;
 if found then
  if (job.created_by,job.operating_location_id,job.source_hash,job.manifest,job.settings) is distinct from (auth.uid(),loc,p_source_hash,p_manifest,p_settings)
  then raise exception 'One-time historical dataset already registered. Resume its original file, branch and settings';end if;
 else
  insert into public.transport_history_import_jobs(company_id,business_unit_id,operating_location_id,created_by,source_hash,file_name,manifest,settings)
  values(c,b,loc,auth.uid(),p_source_hash,left(p_file_name,255),p_manifest,p_settings) returning * into job;
 end if;
 return jsonb_build_object('id',job.id,'completed',job.completed_batches,'batches',jsonb_array_length(job.manifest));
end $$;

create function public.transport_import_history_batch(p_job_id uuid,p_batch integer,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare job public.transport_history_import_jobs;v jsonb;trip_data jsonb;pay jsonb;created jsonb;bill jsonb;purchase jsonb;answer jsonb:='[]';outcome jsonb;stored public.transport_history_import_rows;
 source text;t uuid;rent_id uuid;supplier_id uuid;customer_id uuid;cutoff date;posted boolean;side text;gross numeric;settled numeric;remaining numeric;amount numeric;invoice_day date;pay_day date;account uuid;method text;request uuid;payment_row record;actual numeric;
begin
 perform public.transport_history_import_assert();
 select * into job from public.transport_history_import_jobs where id=p_job_id and company_id=public.current_company_id()
 and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id() and created_by=auth.uid() for update;
 if not found then raise exception 'Historical job outside this user/workspace/branch';end if;
 if p_batch is null or p_batch<0 or p_batch>=jsonb_array_length(job.manifest) or p_batch>job.completed_batches
 or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<>jsonb_array_length(job.manifest->p_batch)
 or (select jsonb_agg(value->>'source_id' order by ord) from jsonb_array_elements(p_rows) with ordinality x(value,ord)) is distinct from job.manifest->p_batch
 or octet_length(p_rows::text)>3000000 then raise exception 'Invalid historical batch or Source Record IDs';end if;
 cutoff:=(job.settings->>'cutoff')::date;
 for v in select value from jsonb_array_elements(p_rows) loop
  source:=v->>'source_id';
  select * into stored from public.transport_history_import_rows where job_id=job.id and source_id=source;
  if found then
   if stored.payload<>v then raise exception 'Historical source ID reused with changed payload';end if;
   answer:=answer||jsonb_build_array(stored.result);continue;
  end if;
  trip_data:=v->'trip';
  if jsonb_typeof(trip_data) is distinct from 'object' or (trip_data->>'trip_date')::date>cutoff
  or jsonb_typeof(v->'payments') is distinct from 'array' or jsonb_array_length(v->'payments')>100 then raise exception 'Historical Trip date/cutoff or payment evidence invalid';end if;
  -- Require complete finite accounting evidence; never infer posted state from legacy labels.
  for side in select unnest(array['customer','supplier']) loop
   if jsonb_typeof(v->(side||'_posted')) is distinct from 'boolean' or jsonb_typeof(v->(side||'_vat')) is distinct from 'boolean' then raise exception 'Explicit posted and VAT flags required';end if;
   posted:=(v->>(side||'_posted'))::boolean;gross:=(v->>(side||'_gross'))::numeric;
   settled:=(v->>case when side='customer' then 'received' else 'paid' end)::numeric;remaining:=(v->>(side||'_remaining'))::numeric;
   if exists(select 1 from unnest(array[gross,settled,remaining]) a where a is null or a<0 or a::text in ('NaN','Infinity','-Infinity') or round(a,2)<>a)
   or gross-settled<>remaining then raise exception 'Historical gross, settled and remaining do not reconcile';end if;
   invoice_day:=nullif(v->>(side||'_date'),'')::date;
   if posted and (gross<=0 or invoice_day is null or invoice_day>cutoff) then raise exception 'Posted history requires positive gross and invoice date within cutoff';end if;
   if not posted and (gross<>0 or settled<>0 or remaining<>0 or (v->>(side||'_vat'))::boolean) then raise exception 'Unposted history cannot contain accounting amounts';end if;
   if coalesce((select sum((value->>'amount')::numeric) from jsonb_array_elements(v->'payments') where value->>'side'=side),0)<>settled then raise exception 'Historical payment evidence does not match settled total';end if;
  end loop;
  for pay in select value from jsonb_array_elements(v->'payments') loop
   side:=pay->>'side';pay_day:=(pay->>'date')::date;amount:=(pay->>'amount')::numeric;
   invoice_day:=nullif(v->>(side||'_date'),'')::date;
   if side is null or side not in ('customer','supplier') or pay_day is null or invoice_day is null or pay_day<invoice_day or pay_day>cutoff
   or amount is null or amount<=0 or amount::text in ('NaN','Infinity','-Infinity') or round(amount,2)<>amount or nullif(btrim(pay->>'reference'),'') is null
   then raise exception 'Dated positive customer/supplier payment evidence required';end if;
   account:=(pay->>'account_id')::uuid;method:=pay->>'method';
   if not exists(select 1 from public.chart_of_accounts where id=account and company_id=job.company_id and is_active and not is_group
    and ((method='cash' and detail_type='Cash on Hand') or (method='bank' and detail_type='Bank Account')))
   then raise exception 'Historical payment requires matching same-company cash/bank account';end if;
  end loop;
  -- Existing operational imports must be reconciled, never silently billed twice.
  if nullif(trip_data->>'source_invoice_no','') is not null and exists(select 1 from public.transport_trips old_trip
   where old_trip.company_id=job.company_id and old_trip.business_unit_id=job.business_unit_id and old_trip.customer_id=(trip_data->>'customer_id')::uuid
   and old_trip.source_invoice_no=trip_data->>'source_invoice_no'
   and old_trip.id not in (select (result->>'id')::uuid from public.transport_history_import_rows where job_id=job.id)) then raise exception 'Source invoice already exists in Transport. Reconcile existing import before history posting';end if;
  request:=md5('transport-history:'||job.id::text||':'||source)::uuid;
  created:=public.transport_create_trips(request,job.company_id,job.business_unit_id,jsonb_build_array(trip_data));t:=(created->0->>'id')::uuid;
  customer_id:=(trip_data->>'customer_id')::uuid;
  bill:=null;purchase:=null;
  if (v->>'customer_posted')::boolean then
   bill:=public.transport_post_customer_bill(t,(v->>'customer_date')::date,(v->>'customer_vat')::boolean);
   if (bill->>'net')::numeric+(bill->>'vat')::numeric<>(v->>'customer_gross')::numeric then raise exception 'Customer historical gross differs from effective canonical VAT calculation';end if;
  end if;
  if (v->>'supplier_posted')::boolean then
   select r.id,r.supplier_id into strict rent_id,supplier_id from public.transport_trip_supplier_rents r where r.trip_id=t;
   purchase:=public.transport_post_supplier_bill(rent_id,(v->>'supplier_date')::date,(job.settings->>'cost_account')::uuid,(v->>'supplier_vat')::boolean,'HISTORY-'||substr(job.id::text,1,8)||'-'||source);
   if (purchase->>'net')::numeric+(purchase->>'vat')::numeric<>(v->>'supplier_gross')::numeric then raise exception 'Supplier historical gross differs from effective canonical VAT calculation';end if;
  end if;
  for payment_row in select value,ord from jsonb_array_elements(v->'payments') with ordinality x(value,ord) order by value->>'date',ord loop
   pay:=payment_row.value;
   side:=pay->>'side';
   -- These documents were just created and locked in this atomic transaction.
   -- Batch/source evidence owns idempotency; canonical engines own allocations,
   -- cash/bank and AR/AP. Avoid expanding the full reporting view per payment.
   if side='customer' then
    perform public.receive_customer_payment(customer_id,(pay->>'date')::date,(pay->>'account_id')::uuid,pay->>'method',pay->>'reference',
     'Historical Transport Customer Receipt',null,jsonb_build_array(jsonb_build_object('sales_order_id',bill->>'document_id','amount',(pay->>'amount')::numeric)),null::numeric);
   else
    perform public.pay_supplier(supplier_id,(pay->>'date')::date,(pay->>'account_id')::uuid,pay->>'method',pay->>'reference',
     'Historical Transport Supplier Payment',null,(purchase->>'document_id')::uuid,(pay->>'amount')::numeric);
   end if;
  end loop;
  for side in select unnest(array['customer','supplier']) loop
   if (v->>(side||'_posted'))::boolean then
    if side='customer' then
     select (v->>'customer_gross')::numeric-coalesce(sum(a.amount),0) into actual from public.invoice_payment_allocations a
     join public.journal_entries j on j.id=a.journal_entry_id and j.status='posted'
     where a.sales_order_id=(bill->>'document_id')::uuid;
    else
     select (v->>'supplier_gross')::numeric-coalesce(sum(a.amount),0) into actual from public.purchase_payment_allocations a
     join public.journal_entries j on j.id=a.journal_entry_id and j.status='posted'
     where a.purchase_order_id=(purchase->>'document_id')::uuid;
    end if;
    if actual is distinct from (v->>(side||'_remaining'))::numeric then raise exception 'Canonical historical outstanding does not reconcile';end if;
   end if;
  end loop;
  outcome:=jsonb_build_object('source_id',source,'id',t,'trip_no',created->0->>'trip_no','customer_document',bill,'supplier_document',purchase,
   'customer_gross',v->'customer_gross','supplier_gross',v->'supplier_gross','received',v->'received','paid',v->'paid','customer_remaining',v->'customer_remaining','supplier_remaining',v->'supplier_remaining');
  insert into public.transport_history_import_rows(job_id,source_id,payload,result) values(job.id,source,v,outcome);
  perform public.transport_financial_audit(t,'historical_import_posted',outcome||jsonb_build_object('import_job_id',job.id));
  answer:=answer||jsonb_build_array(outcome);
 end loop;
 update public.transport_history_import_jobs set completed_batches=greatest(completed_batches,p_batch+1),updated_at=now() where id=job.id;
 return answer;
end $$;

create function public.transport_history_import_status() returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare job public.transport_history_import_jobs;totals jsonb;
begin
 perform public.transport_history_import_assert();
 select * into job from public.transport_history_import_jobs where company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
 and operating_location_id=public.current_operating_location_id() and created_by=auth.uid();
 if not found then return null;end if;
 select jsonb_build_object('trips',count(*),'customer_gross',coalesce(sum((result->>'customer_gross')::numeric),0),
 'supplier_gross',coalesce(sum((result->>'supplier_gross')::numeric),0),'received',coalesce(sum((result->>'received')::numeric),0),
 'paid',coalesce(sum((result->>'paid')::numeric),0),'customer_remaining',coalesce(sum((result->>'customer_remaining')::numeric),0),
 'supplier_remaining',coalesce(sum((result->>'supplier_remaining')::numeric),0)) into totals from public.transport_history_import_rows where job_id=job.id;
 return jsonb_build_object('id',job.id,'file',job.file_name,'source_hash',job.source_hash,'settings',job.settings,'completed',job.completed_batches,'batches',jsonb_array_length(job.manifest),'totals',totals);
end $$;
revoke all on function public.transport_prepare_history_import(text,text,jsonb,jsonb),public.transport_import_history_batch(uuid,integer,jsonb),public.transport_history_import_status() from public,anon;
grant execute on function public.transport_prepare_history_import(text,text,jsonb,jsonb),public.transport_import_history_batch(uuid,integer,jsonb),public.transport_history_import_status() to authenticated;

-- Permit correcting a rejected review only before any Trip/accounting is saved.
-- A posted/partially imported job is immutable and can only be resumed.
create function public.transport_cancel_empty_history_import(p_job_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.transport_history_import_jobs;
begin
 perform public.transport_history_import_assert();
 select * into job from public.transport_history_import_jobs where id=p_job_id and company_id=public.current_company_id()
 and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id() and created_by=auth.uid() for update;
 if not found then raise exception 'Historical job outside this user/workspace/branch';end if;
 if job.completed_batches<>0 or exists(select 1 from public.transport_history_import_rows where job_id=job.id)
 then raise exception 'Historical Trips/accounting already saved; only resume is allowed';end if;
 delete from public.transport_history_import_jobs where id=job.id;
 return true;
end $$;
revoke all on function public.transport_cancel_empty_history_import(uuid) from public,anon;
grant execute on function public.transport_cancel_empty_history_import(uuid) to authenticated;
