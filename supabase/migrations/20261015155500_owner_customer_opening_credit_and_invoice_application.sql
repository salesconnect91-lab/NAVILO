-- Software Owner: convert a wrongly posted Credit opening account to a customer opening credit.
-- Original opening journal and its ledger stay immutable. A compensating journal
-- clears the wrong GL and credits the canonical A/R control with the customer ID.
-- Future eligible same-currency sales invoices consume this pre-existing customer credit
-- through the normal invoice allocation table, without a duplicate receipt or bank entry.
create table if not exists public.owner_customer_opening_credits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  business_unit_id uuid not null references public.business_units(id),
  operating_location_id uuid not null references public.operating_locations(id),
  original_account_id uuid not null unique references public.chart_of_accounts(id),
  original_opening_journal_id uuid not null references public.journal_entries(id),
  correction_journal_id uuid not null unique references public.journal_entries(id),
  correction_ar_line_id uuid not null unique references public.journal_lines(id),
  customer_id uuid not null references public.customers(id),
  opening_credit numeric(20,2) not null check (opening_credit>0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists owner_customer_opening_credits_customer_idx
  on public.owner_customer_opening_credits(company_id,business_unit_id,operating_location_id,customer_id);
alter table public.owner_customer_opening_credits enable row level security;
revoke all on public.owner_customer_opening_credits from public,anon,authenticated;

create or replace function public.owner_correct_customer_opening_credit(
  p_account_id uuid, p_customer_name text, p_reason text default '',
  p_preview boolean default true
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $function$
declare
  v_company uuid:=public.current_company_id();
  v_unit uuid:=public.current_business_unit_id();
  v_loc uuid:=public.current_operating_location_id();
  v_actor uuid:=auth.uid();
  v_user uuid:=public.legacy_data_user_id();
  v_old public.chart_of_accounts%rowtype;
  v_ar public.chart_of_accounts%rowtype;
  v_opening uuid;
  v_amount numeric;
  v_credit numeric;
  v_debit numeric;
  v_cnt integer;
  v_ledger_count integer;
  v_party uuid;
  v_correction uuid;
  v_ar_line uuid;
  v_code text;
  v_name text:=btrim(coalesce(p_customer_name,''));
  v_fk record;
  v_used boolean;
  v_post jsonb;
begin
  if v_actor is null or not public.is_platform_owner() then
    raise exception 'Software Owner access is required for posted opening credit correction.';
  end if;
  if v_company is null or v_unit is null or v_loc is null or v_user is null then
    raise exception 'Select the correct company, business unit and operating location.';
  end if;
  if p_account_id is null then raise exception 'Select the wrong posted opening account.'; end if;
  if length(v_name)<2 or length(v_name)>160 then raise exception 'Enter a valid Customer Master name.'; end if;
  if exists (select 1 from public.customers where company_id=v_company
       and lower(btrim(name))=lower(v_name)) then
    raise exception 'Customer already exists. Do not create a duplicate customer.';
  end if;
  select * into v_old from public.chart_of_accounts
    where id=p_account_id and company_id=v_company and user_id=v_user for update;
  if not found or not v_old.is_active or v_old.is_group or coalesce(v_old.is_system_account,false)
       or v_old.type<>'asset' then
    raise exception 'Choose an active non-system Asset posting account in the active company.';
  end if;
  if exists(select 1 from public.owner_customer_opening_credits
       where original_account_id=p_account_id) then
    raise exception 'This original opening account was already corrected. Duplicate credit is blocked.';
  end if;
  select a.* into v_ar
    from public.account_mappings m join public.chart_of_accounts a on a.id=m.account_id
    where m.company_id=v_company and m.user_id=v_user and m.mapping_key='accounts_receivable'
      and a.type='asset' and a.is_active and not a.is_group;
  if not found then raise exception 'Valid mapped Accounts Receivable posting account is required.'; end if;
  -- Do not absorb an account used by any setup/document other than its one opening journal.
  for v_fk in select con.conrelid::regclass table_name,att.attname column_name
    from pg_constraint con
    join pg_attribute att on att.attrelid=con.conrelid and att.attnum=con.conkey[1]
    where con.contype='f' and con.confrelid='public.chart_of_accounts'::regclass
      and array_length(con.conkey,1)=1 and con.conrelid not in
        ('public.journal_lines'::regclass,'public.ledgers'::regclass)
  loop
    execute format('select exists(select 1 from %s where %I=$1)',v_fk.table_name,v_fk.column_name)
      into v_used using p_account_id;
    if v_used then raise exception 'Account is referenced by % and cannot be safely replaced.',v_fk.table_name; end if;
  end loop;
  select count(*), min(jl.entry_id::text)::uuid, coalesce(sum(jl.debit),0),
         coalesce(sum(jl.credit),0)
    into v_cnt,v_opening,v_debit,v_credit
    from public.journal_lines jl
    where jl.account_id=p_account_id and jl.company_id=v_company;
  if v_cnt<>1 or v_opening is null or v_debit<>0 or v_credit<=0 then
    raise exception 'Account must contain exactly one Credit Opening Balance and no other journal lines.';
  end if;
  if not exists (
    select 1 from public.journal_entries j
    where j.id=v_opening and j.company_id=v_company and j.business_unit_id=v_unit
      and j.operating_location_id=v_loc and j.status='posted'
      and lower(coalesce(j.trans_type,'')) in ('opening balance','opening_balance')
      and (exists(select 1 from public.opening_balance_batches b
                    where b.journal_entry_id=j.id and b.company_id=v_company and b.business_unit_id=v_unit)
        or exists(select 1 from public.cutover_opening_balance_batches b
                    where b.journal_entry_id=j.id and b.company_id=v_company and b.business_unit_id=v_unit))
  ) then raise exception 'Opening journal is not a posted opening batch in the active workspace.'; end if;
  if exists(select 1 from public.journal_lines l
            where l.account_id=p_account_id and (l.party_id is not null or l.party_type is not null)) then
    raise exception 'Party-linked opening line needs a separate party correction.';
  end if;
  select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)
    into v_ledger_count,v_debit,v_amount from public.ledgers
    where account_id=p_account_id and company_id=v_company;
  if v_ledger_count<>1 or v_debit<>0 or v_amount<>v_credit or
      exists(select 1 from public.ledgers where account_id=p_account_id
               and (journal_entry_id is distinct from v_opening
                   or business_unit_id is distinct from v_unit
                   or operating_location_id is distinct from v_loc)) then
    raise exception 'GL history does not exclusively match the original opening credit.';
  end if;
  if p_preview then
    return jsonb_build_object('eligible',true,'old_account',v_old.code||' - '||v_old.name,
       'customer',v_name,'opening_credit',v_credit,'ar_account',v_ar.code||' - '||v_ar.name,
       'original_opening_journal',v_opening,
       'note','Customer will be linked to A/R. Existing posted opening is immutable; a compensating correction clears this wrong account.');
  end if;
  if length(btrim(coalesce(p_reason,'')))<10 then
    raise exception 'Correction reason must contain at least 10 characters.';
  end if;
  perform public.assert_module_permission('accounting','post');
  insert into public.customers(user_id,company_id,name,account_id,is_active,created_by)
  values(v_user,v_company,v_name,v_ar.id,true,v_actor) returning id into v_party;
  v_code:=public.next_document_number('manual_journal','JE-');
  insert into public.journal_entries
    (user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,
     description,status,party_name,trans_type,source_module,source_document_type,currency_code,exchange_rate)
  values(v_user,v_company,v_unit,v_loc,v_code,current_date,
    'Owner opening credit correction: '||v_old.code||' → '||v_name,
    'draft',v_name,'Opening Credit Correction','accounting','owner_customer_opening_credit',
    (select base_currency_code from public.companies where id=v_company),1)
  returning id into v_correction;
  insert into public.journal_lines
    (user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,
     debit,credit)
  values(v_user,v_company,v_unit,v_loc,v_correction,v_old.id,v_old.code||' - '||v_old.name,v_credit,0);
  insert into public.journal_lines
    (user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,
     debit,credit,party_type,party_id,party_name)
  values(v_user,v_company,v_unit,v_loc,v_correction,v_ar.id,v_ar.code||' - '||v_ar.name,
     0,v_credit,'customer',v_party,v_name) returning id into v_ar_line;
  v_post:=public.post_journal_entry(v_correction);
  if coalesce((v_post->>'success')::boolean,false) is false then
     raise exception 'Journal posting did not confirm success.'; end if;
  update public.chart_of_accounts set is_active=false
    where id=v_old.id and company_id=v_company;
  insert into public.owner_customer_opening_credits
    (company_id,business_unit_id,operating_location_id,original_account_id,
     original_opening_journal_id,correction_journal_id,correction_ar_line_id,
     customer_id,opening_credit,created_by)
  values(v_company,v_unit,v_loc,v_old.id,v_opening,v_correction,v_ar_line,
     v_party,v_credit,v_actor);
  insert into public.owner_posted_control_events
    (company_id,business_unit_id,document_type,document_id,action_type,
     reason,performed_by,metadata)
  values(v_company,v_unit,'chart_of_accounts',v_old.id,'correct',
      btrim(p_reason),v_actor,
      jsonb_build_object('operation','customer_opening_credit_reclassification',
      'customer_id',v_party,'customer_name',v_name,'original_journal_id',v_opening,
      'correction_journal_id',v_correction,'amount',v_credit,
      'original_posted_evidence_preserved',true));
  return jsonb_build_object('success',true,'customer_id',v_party,
    'correction_journal_id',v_correction,'opening_credit',v_credit,
    'wrong_account_inactive',true,'original_posted_evidence_preserved',true);
end
$function$;
revoke all on function public.owner_correct_customer_opening_credit(uuid,text,text,boolean)
  from public,anon;
grant execute on function public.owner_correct_customer_opening_credit(uuid,text,text,boolean)
  to authenticated;

-- Apply only owner-authenticated opening credits. Existing receipt allocation stays unchanged.
create or replace function public.auto_apply_owner_customer_opening_credit()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $function$
declare
 v_credit record;
 v_total numeric;
 v_used numeric;
 v_available numeric;
 v_allocated numeric;
 v_amount numeric;
 v_base text;
 v_returns numeric;
begin
 if new.status<>'posted' or old.status='posted' or new.customer_id is null
     or coalesce(new.total,0)<=0 then return new; end if;
 select c.base_currency_code into v_base from public.companies c where c.id=new.company_id;
 if coalesce(new.currency_code,v_base) is distinct from v_base then
   -- Never auto-apply base-currency credit to a foreign-currency invoice.
   return new;
 end if;
 select coalesce(sum(n.total),0) into v_returns from public.return_notes n
 where n.sales_order_id=new.id and n.company_id=new.company_id
       and n.business_unit_id=new.business_unit_id
       and n.note_type='sales_credit' and n.status='posted';
 select coalesce(sum(a.amount),0) into v_allocated
 from public.invoice_payment_allocations a
 where a.sales_order_id=new.id and a.company_id=new.company_id
   and a.business_unit_id=new.business_unit_id;
 v_total:=greatest(round(new.total-v_returns-v_allocated,2),0);
 if v_total<=0 then return new; end if;
 for v_credit in select * from public.owner_customer_opening_credits c
   where c.company_id=new.company_id and c.business_unit_id=new.business_unit_id
   and c.operating_location_id=new.operating_location_id
   and c.customer_id=new.customer_id order by c.created_at,c.id for update
 loop
   select coalesce(sum(a.amount),0) into v_used
   from public.invoice_payment_allocations a
   where a.journal_entry_id=v_credit.correction_journal_id
     and a.company_id=v_credit.company_id and a.business_unit_id=v_credit.business_unit_id;
   v_available:=greatest(round(v_credit.opening_credit-v_used,2),0);
   v_amount:=least(v_available,v_total);
   if v_amount>0 then
     insert into public.invoice_payment_allocations
       (user_id,company_id,business_unit_id,operating_location_id,
        sales_order_id,journal_entry_id,journal_line_id,customer_id,
        allocation_date,amount,reference,notes)
     values(new.user_id,new.company_id,new.business_unit_id,new.operating_location_id,
        new.id,v_credit.correction_journal_id,v_credit.correction_ar_line_id,new.customer_id,
        current_date,v_amount,'OPENING-CREDIT-'||left(v_credit.id::text,8),
        'Applied customer opening credit; no cash/bank receipt created.');
     v_total:=round(v_total-v_amount,2);
   end if;
   exit when v_total<=0;
 end loop;
 return new;
end
$function$;
drop trigger if exists zzzzzz_apply_owner_customer_opening_credit on public.sales_orders;
create trigger zzzzzz_apply_owner_customer_opening_credit
after update of status on public.sales_orders
for each row when (new.status='posted' and old.status is distinct from new.status)
execute function public.auto_apply_owner_customer_opening_credit();
revoke all on function public.auto_apply_owner_customer_opening_credit() from public,anon,authenticated;
