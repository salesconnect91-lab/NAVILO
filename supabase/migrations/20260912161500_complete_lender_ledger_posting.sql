-- Lender master + lender-wise loan ledger, scoped to active company/business unit.
-- Production migration applied through Supabase on 2026-09-12.

create table if not exists public.loan_parties (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  company_id uuid not null, business_unit_id uuid, name text not null, phone text, notes text,
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.loan_party_transactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  company_id uuid not null, business_unit_id uuid, lender_id uuid not null references public.loan_parties(id),
  journal_entry_id uuid references public.journal_entries(id), transaction_date date not null,
  transaction_type text not null check (transaction_type in ('loan_received','loan_repayment')),
  amount numeric not null check (amount>0), reference text, notes text, created_at timestamptz not null default now()
);
create index if not exists loan_parties_company_name_idx on public.loan_parties(company_id,name);
create index if not exists loan_party_tx_lender_date_idx on public.loan_party_transactions(lender_id,transaction_date,created_at);
alter table public.loan_parties enable row level security;
alter table public.loan_party_transactions enable row level security;

drop policy if exists loan_parties_user_scope on public.loan_parties;
drop policy if exists loan_parties_company_bu_scope on public.loan_parties;
create policy loan_parties_company_bu_scope on public.loan_parties for all to authenticated
using (user_id=auth.uid() and company_id=public.current_company_id() and (business_unit_id is null or business_unit_id=public.current_business_unit_id()))
with check (user_id=auth.uid() and company_id=public.current_company_id() and (business_unit_id is null or business_unit_id=public.current_business_unit_id()));

drop policy if exists loan_party_transactions_user_scope on public.loan_party_transactions;
drop policy if exists loan_party_transactions_company_bu_scope on public.loan_party_transactions;
create policy loan_party_transactions_company_bu_scope on public.loan_party_transactions for all to authenticated
using (user_id=auth.uid() and company_id=public.current_company_id() and (business_unit_id is null or business_unit_id=public.current_business_unit_id()))
with check (user_id=auth.uid() and company_id=public.current_company_id() and (business_unit_id is null or business_unit_id=public.current_business_unit_id()));

grant select,insert,update on public.loan_parties to authenticated;
grant select,insert on public.loan_party_transactions to authenticated;

create or replace function public.create_loan_party(p_name text, p_phone text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_company uuid:=public.current_company_id(); v_bu uuid:=public.current_business_unit_id(); v_id uuid;
begin
 perform public.assert_module_permission('accounting','create');
 if v_uid is null or v_company is null or v_bu is null then raise exception 'Authentication and active company/business unit are required.'; end if;
 if nullif(btrim(p_name),'') is null then raise exception 'Lender name is required.'; end if;
 select id into v_id from public.loan_parties where user_id=v_uid and company_id=v_company and business_unit_id=v_bu and lower(name)=lower(btrim(p_name)) and is_active limit 1;
 if v_id is not null then return v_id; end if;
 insert into public.loan_parties(user_id,company_id,business_unit_id,name,phone,notes) values(v_uid,v_company,v_bu,btrim(p_name),nullif(btrim(p_phone),''),nullif(btrim(p_notes),'')) returning id into v_id;
 return v_id;
end $$;

create or replace function public.post_loan_party_transaction(p_lender_id uuid,p_transaction_type text,p_transaction_date date,p_cash_bank_account_id uuid,p_amount numeric,p_reference text default null,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_company uuid:=public.current_company_id(); v_bu uuid:=public.current_business_unit_id(); v_lender public.loan_parties%rowtype; v_loan_account uuid; v_post jsonb; v_outstanding numeric:=0;
begin
 perform public.assert_module_permission('accounting','post');
 if v_uid is null or v_company is null or v_bu is null then raise exception 'Authentication and active company/business unit are required.'; end if;
 if p_transaction_type not in ('loan_received','loan_repayment') then raise exception 'Invalid loan transaction type.'; end if;
 if coalesce(p_amount,0)<=0 then raise exception 'Amount must be greater than zero.'; end if;
 if p_transaction_date is null then raise exception 'Transaction date is required.'; end if;
 select * into v_lender from public.loan_parties where id=p_lender_id and user_id=v_uid and company_id=v_company and business_unit_id=v_bu and is_active for update;
 if not found then raise exception 'Select a valid active lender.'; end if;
 select id into v_loan_account from public.chart_of_accounts where user_id=public.legacy_data_user_id() and company_id=v_company and type='liability' and is_active and not is_group and allow_manual_entries and (detail_type='Loan Payable' or lower(name)='loan payable') order by code limit 1;
 if v_loan_account is null then raise exception 'Loan Payable account is not configured.'; end if;
 if p_transaction_type='loan_repayment' then
  select coalesce(sum(case when transaction_type='loan_received' then amount else -amount end),0) into v_outstanding from public.loan_party_transactions where lender_id=p_lender_id and company_id=v_company and business_unit_id=v_bu;
  if p_amount > v_outstanding + 0.005 then raise exception 'Repayment cannot exceed lender outstanding balance of %.', round(v_outstanding,2); end if;
 end if;
 v_post:=public.post_general_cash_bank_transaction(p_transaction_date,p_transaction_type,v_loan_account,p_cash_bank_account_id,p_amount,v_lender.name,p_reference,p_notes);
 insert into public.loan_party_transactions(user_id,company_id,business_unit_id,lender_id,journal_entry_id,transaction_date,transaction_type,amount,reference,notes) values(v_uid,v_company,v_bu,p_lender_id,(v_post->>'journal_entry_id')::uuid,p_transaction_date,p_transaction_type,round(p_amount,2),nullif(btrim(p_reference),''),nullif(btrim(p_notes),''));
 return v_post || jsonb_build_object('lender_id',v_lender.id,'lender_name',v_lender.name);
end $$;

revoke execute on function public.create_loan_party(text,text,text) from public,anon;
revoke execute on function public.post_loan_party_transaction(uuid,text,date,uuid,numeric,text,text) from public,anon;
grant execute on function public.create_loan_party(text,text,text) to authenticated;
grant execute on function public.post_loan_party_transaction(uuid,text,date,uuid,numeric,text,text) to authenticated;
