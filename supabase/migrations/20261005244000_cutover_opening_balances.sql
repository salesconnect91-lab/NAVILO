-- One-time mid-year cut-over opening balances for a clean company/BU.
create table if not exists public.cutover_opening_balance_batches(
 id uuid primary key default gen_random_uuid(), user_id uuid not null, company_id uuid not null, business_unit_id uuid not null,
 cutover_date date not null, journal_entry_id uuid not null references public.journal_entries(id), total_debit numeric not null, total_credit numeric not null,
 created_by uuid, created_at timestamptz not null default now(), unique(company_id,business_unit_id)
);
alter table public.cutover_opening_balance_batches enable row level security;

create or replace function public.post_cutover_opening_balances(p_cutover_date date,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=public.legacy_data_user_id(); c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id();
td numeric; tc numeric; j uuid; x jsonb; aid uuid; pt text; pid uuid; pname text; coa public.chart_of_accounts%rowtype; ar uuid; ap uuid; res jsonb;
begin
 perform public.assert_module_permission('accounting','post');
 if u is null or c is null or b is null or loc is null then raise exception 'Authentication, active company, business unit and branch are required.'; end if;
 if p_cutover_date is null then raise exception 'Cut-over date is required.'; end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 then raise exception 'At least two cut-over opening lines are required.'; end if;
 if exists(select 1 from public.cutover_opening_balance_batches q where q.company_id=c and q.business_unit_id=b) then raise exception 'Cut-over opening balances are already posted for this business unit.'; end if;
 if exists(select 1 from public.opening_balance_batches q where q.company_id=c and q.business_unit_id=b) then raise exception 'Annual opening balances already exist for this business unit.'; end if;
 if exists(select 1 from public.ledgers l where l.company_id=c and l.business_unit_id=b and l.entry_date<p_cutover_date) then raise exception 'Prior ledger activity exists before cut-over date. Cut-over import is allowed only for a clean business unit.'; end if;
 select account_id into ar from public.account_mappings where user_id=u and company_id=c and mapping_key='accounts_receivable';
 select account_id into ap from public.account_mappings where user_id=u and company_id=c and mapping_key='accounts_payable';
 select round(sum(coalesce((value->>'debit')::numeric,0)),2),round(sum(coalesce((value->>'credit')::numeric,0)),2) into td,tc from jsonb_array_elements(p_lines);
 if td<=0 or abs(td-tc)>=.01 then raise exception 'Cut-over opening balances must have equal positive debit and credit totals.'; end if;
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type,source_module,source_document_type)
 values(u,c,b,loc,'COB-'||to_char(p_cutover_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),p_cutover_date,'Cut-over opening balances','draft','Opening Balance','accounting','cutover_opening_balances') returning id into j;
 for x in select value from jsonb_array_elements(p_lines) loop
  aid:=(x->>'account_id')::uuid; pt:=nullif(lower(trim(x->>'party_type')),''); pid:=nullif(x->>'party_id','')::uuid; pname:=nullif(trim(x->>'party_name'),'');
  select * into coa from public.chart_of_accounts where id=aid and user_id=u and company_id=c and is_active=true and is_group=false;
  if not found then raise exception 'Invalid cut-over account.'; end if;
  if coa.type in ('revenue','expense') then raise exception 'Revenue and expense accounts cannot carry cut-over opening balances.'; end if;
  if coalesce((x->>'debit')::numeric,0)<0 or coalesce((x->>'credit')::numeric,0)<0 or (coalesce((x->>'debit')::numeric,0)>0 and coalesce((x->>'credit')::numeric,0)>0) or (coalesce((x->>'debit')::numeric,0)<=0 and coalesce((x->>'credit')::numeric,0)<=0) then raise exception 'Each cut-over line must contain exactly one positive Debit or Credit amount.'; end if;
  if aid=ar then
   if pt is distinct from 'customer' or pid is null or not exists(select 1 from public.customers z where z.id=pid and z.company_id=c and z.account_id=ar and z.is_active=true) then raise exception 'Accounts Receivable cut-over lines require a valid Customer.'; end if;
   select name into pname from public.customers where id=pid and company_id=c;
  elsif aid=ap then
   if pt is distinct from 'supplier' or pid is null or not exists(select 1 from public.suppliers z where z.id=pid and z.company_id=c and z.account_id=ap and z.is_active=true) then raise exception 'Accounts Payable cut-over lines require a valid Supplier.'; end if;
   select name into pname from public.suppliers where id=pid and company_id=c;
  elsif pid is not null or pt is not null then raise exception 'Party can only be selected on Accounts Receivable or Accounts Payable cut-over lines.'; end if;
  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name)
  values(u,c,b,loc,j,coa.id,coa.code||' - '||coa.name,round(coalesce((x->>'debit')::numeric,0),2),round(coalesce((x->>'credit')::numeric,0),2),pt,pid,pname);
 end loop;
 res:=public.post_journal_entry(j);
 insert into public.cutover_opening_balance_batches(user_id,company_id,business_unit_id,cutover_date,journal_entry_id,total_debit,total_credit,created_by) values(u,c,b,p_cutover_date,j,td,tc,auth.uid());
 insert into public.audit_logs(user_id,module,action,table_name,record_id,record_name,performed_by,new_data,metadata)
 values(u,'accounting','POST_CUTOVER_OPENING_BALANCES','cutover_opening_balance_batches',j,'Cut-over opening balances',auth.uid(),jsonb_build_object('total_debit',td,'total_credit',tc),jsonb_build_object('company_id',c,'business_unit_id',b,'operating_location_id',loc,'cutover_date',p_cutover_date));
 return jsonb_build_object('success',true,'journal_entry_id',j,'cutover_date',p_cutover_date,'total_debit',td,'total_credit',tc,'post_result',res);
end$$;
revoke all on function public.post_cutover_opening_balances(date,jsonb) from public,anon;
grant execute on function public.post_cutover_opening_balances(date,jsonb) to authenticated;
