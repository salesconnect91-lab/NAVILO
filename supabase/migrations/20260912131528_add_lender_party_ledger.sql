create table if not exists public.loan_parties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  company_id uuid not null,
  business_unit_id uuid,
  name text not null,
  phone text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loan_parties_company_name_idx on public.loan_parties(company_id,name);

create table if not exists public.loan_party_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  company_id uuid not null,
  business_unit_id uuid,
  lender_id uuid not null references public.loan_parties(id),
  journal_entry_id uuid references public.journal_entries(id),
  transaction_date date not null,
  transaction_type text not null check (transaction_type in ('loan_received','loan_repayment')),
  amount numeric not null check (amount > 0),
  reference text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists loan_party_tx_lender_date_idx on public.loan_party_transactions(lender_id,transaction_date,created_at);

alter table public.loan_parties enable row level security;
alter table public.loan_party_transactions enable row level security;

do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='loan_parties' and policyname='loan_parties_user_scope') then
  create policy loan_parties_user_scope on public.loan_parties for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
 end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='loan_party_transactions' and policyname='loan_party_transactions_user_scope') then
  create policy loan_party_transactions_user_scope on public.loan_party_transactions for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
 end if;
end $$;

grant select,insert,update on public.loan_parties to authenticated;
grant select,insert on public.loan_party_transactions to authenticated;

create or replace function public.create_loan_party(p_name text, p_phone text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_company uuid; v_bu uuid; v_id uuid;
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 select company_id,business_unit_id into v_company,v_bu from public.user_context limit 1;
 if v_company is null then raise exception 'Active company required'; end if;
 if nullif(btrim(p_name),'') is null then raise exception 'Lender name is required'; end if;
 insert into public.loan_parties(user_id,company_id,business_unit_id,name,phone,notes)
 values(v_uid,v_company,v_bu,btrim(p_name),nullif(btrim(p_phone),''),nullif(btrim(p_notes),'')) returning id into v_id;
 return v_id;
end $$;
grant execute on function public.create_loan_party(text,text,text) to authenticated;

create or replace function public.record_loan_party_transaction(p_lender_id uuid,p_journal_entry_id uuid,p_transaction_date date,p_transaction_type text,p_amount numeric,p_reference text default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_company uuid; v_bu uuid; v_id uuid;
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 select company_id,business_unit_id into v_company,v_bu from public.user_context limit 1;
 if v_company is null then raise exception 'Active company required'; end if;
 if p_transaction_type not in ('loan_received','loan_repayment') then raise exception 'Invalid loan transaction type'; end if;
 if coalesce(p_amount,0)<=0 then raise exception 'Amount must be greater than zero'; end if;
 if not exists(select 1 from public.loan_parties l where l.id=p_lender_id and l.company_id=v_company and l.user_id=v_uid and l.is_active) then raise exception 'Invalid lender'; end if;
 insert into public.loan_party_transactions(user_id,company_id,business_unit_id,lender_id,journal_entry_id,transaction_date,transaction_type,amount,reference,notes)
 values(v_uid,v_company,v_bu,p_lender_id,p_journal_entry_id,p_transaction_date,p_transaction_type,p_amount,nullif(btrim(p_reference),''),nullif(btrim(p_notes),'')) returning id into v_id;
 return v_id;
end $$;
grant execute on function public.record_loan_party_transaction(uuid,uuid,date,text,numeric,text,text) to authenticated;

