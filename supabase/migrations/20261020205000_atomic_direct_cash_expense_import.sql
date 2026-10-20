-- PREPARED MIGRATION ONLY. Apply in production ONLY after explicit schema approval.
-- Supplier-less Office/Yard/General direct-cash expense batches.
-- Posting delegates to the existing, audited General Cash/Bank posting function.
-- The batch is one PostgreSQL transaction: any error rolls back ALL vouchers.
begin;
create table if not exists public.accounting_direct_cash_expense_import_keys(
 company_id uuid not null references public.companies(id),
 business_unit_id uuid not null,
 source_reference text not null,
 journal_entry_id uuid unique references public.journal_entries(id),
 expense_area text not null check (expense_area in ('office','yard','general')),
 created_at timestamptz not null default now(),
 constraint accounting_direct_cash_expense_import_keys_pk
  primary key(company_id,business_unit_id,source_reference)
);
alter table public.accounting_direct_cash_expense_import_keys enable row level security;
revoke all on public.accounting_direct_cash_expense_import_keys from anon,authenticated;
comment on table public.accounting_direct_cash_expense_import_keys is
 'Idempotency evidence for atomic supplier-less cash expense imports. Never delete after posting.';
create or replace function public.accounting_import_direct_cash_expenses(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
 v_company uuid := public.current_company_id();
 v_bu uuid := public.current_business_unit_id();
 v_uid uuid := public.legacy_data_user_id();
 v_row jsonb;
 v_count integer;
 v_index integer := 0;
 v_date date;
 v_area text;
 v_amount numeric(18,2);
 v_expense uuid;
 v_cash uuid;
 v_ref text;
 v_payee text;
 v_description text;
 v_result jsonb;
 v_entry uuid;
 v_result_rows jsonb := '[]'::jsonb;
begin
 perform public.assert_module_permission('accounting','post');
 if v_company is null or v_bu is null or v_uid is null then
  raise exception 'Active company, business unit and logged-in user are required.';
 end if;
 if jsonb_typeof(p_rows) <> 'array' then
  raise exception 'Expense rows must be an array.';
 end if;
 v_count := jsonb_array_length(p_rows);
 if v_count < 1 or v_count > 100 then
  raise exception 'Expense import must contain 1–100 rows.';
 end if;
 for v_row in select value from jsonb_array_elements(p_rows) loop
  v_index := v_index + 1;
  if jsonb_typeof(v_row)<>'object' then
   raise exception 'Row %: invalid expense data.',v_index;
  end if;
  if coalesce(v_row->>'transaction_date','') !~ '^\d{4}-\d{2}-\d{2}$' then
   raise exception 'Row %: date must be YYYY-MM-DD.',v_index;
  end if;
  begin
   v_date := (v_row->>'transaction_date')::date;
  exception when others then
   raise exception 'Row %: invalid date.',v_index;
  end;
  v_area := lower(trim(coalesce(v_row->>'expense_area','')));
  if v_area not in ('office','yard','general') then
   raise exception 'Row %: only Office/Yard/General supported; use Vehicle Expense for vehicle allocations.',v_index;
  end if;
  if coalesce(v_row->>'amount','') !~ '^\d{1,11}(\.\d{1,2})?$' then
   raise exception 'Row %: invalid SAR amount.',v_index;
  end if;
  v_amount := (v_row->>'amount')::numeric;
  if v_amount <= 0 then raise exception 'Row %: amount must be positive.',v_index; end if;
  v_ref := lower(trim(coalesce(v_row->>'source_reference','')));
  if length(v_ref)<1 or length(v_ref)>100 then
   raise exception 'Row %: unique source reference required (max 100 chars).',v_index;
  end if;
  v_payee := left(nullif(trim(coalesce(v_row->>'paid_to','')),'')::text,180);
  v_description := left(trim(coalesce(v_row->>'description','')),500);
  if v_description='' then raise exception 'Row %: description required.',v_index; end if;
  begin
   v_expense := (v_row->>'expense_account_id')::uuid;
   v_cash := (v_row->>'cash_bank_account_id')::uuid;
  exception when others then
   raise exception 'Row %: select valid Expense GL and Cash/Bank accounts.',v_index;
  end;
  -- Independent company-account check even though posting RPC validates again.
  if not exists(select 1 from public.chart_of_accounts a
    where a.id=v_expense and a.company_id=v_company and a.user_id=v_uid
     and a.type='expense' and a.is_active and not a.is_group and a.allow_manual_entries
     and coalesce(a.detail_type,'') not in ('COGS','Salaries'))
  then raise exception 'Row %: selected Expense GL is not eligible.',v_index;end if;
  if not exists(select 1 from public.chart_of_accounts a
    where a.id=v_cash and a.company_id=v_company and a.user_id=v_uid
     and a.type='asset' and a.is_active and not a.is_group and a.allow_manual_entries
     and a.detail_type in ('Cash on Hand','Bank Account'))
  then raise exception 'Row %: selected Cash/Bank account is not eligible.',v_index;end if;
  -- Reserve reference FIRST in the same transaction. A retry never double-posts.
  insert into public.accounting_direct_cash_expense_import_keys
   (company_id,business_unit_id,source_reference,expense_area)
  values (v_company,v_bu,v_ref,v_area);
  -- This is the canonical source voucher and canonical debit/credit posting.
  v_result := public.post_general_cash_bank_transaction(
    p_transaction_date=>v_date,p_transaction_type=>'expense_payment',
    p_counter_account_id=>v_expense,p_cash_bank_account_id=>v_cash,
    p_amount=>v_amount,p_party_name=>v_payee,p_reference=>v_ref,
    p_notes=>concat('Area: ',initcap(v_area),' | ',v_description)
  );
  if coalesce((v_result->>'success')::boolean,false) is not true
    or nullif(v_result->>'journal_entry_id','') is null then
   raise exception 'Row %: posting did not return a confirmed journal.',v_index;
  end if;
  v_entry := (v_result->>'journal_entry_id')::uuid;
  update public.accounting_direct_cash_expense_import_keys
    set journal_entry_id=v_entry where company_id=v_company
    and business_unit_id=v_bu and source_reference=v_ref;
  v_result_rows := v_result_rows || jsonb_build_array(jsonb_build_object(
    'source_reference',v_ref,'journal_entry_id',v_entry,'entry_no',v_result->>'entry_no'));
 end loop;
 return jsonb_build_object('success',true,'posted_count',v_count,'entries',v_result_rows,
  'company_id',v_company,'business_unit_id',v_bu);
exception
 when unique_violation then
  raise exception 'Duplicate Source Reference or already imported expense. Entire batch rolled back; verify previous Cash Expense vouchers before retrying.';
end;
$$;
-- A read-only capability check for frontend rollout. Posting buttons stay disabled
-- until the migration has been explicitly approved and deployed.
create or replace function public.accounting_direct_cash_expense_import_ready()
returns boolean language sql stable security invoker set search_path=public,pg_temp
as 'select true';
revoke all on function public.accounting_direct_cash_expense_import_ready() from public,anon;
grant execute on function public.accounting_direct_cash_expense_import_ready() to authenticated;
revoke all on function public.accounting_import_direct_cash_expenses(jsonb) from public,anon;
grant execute on function public.accounting_import_direct_cash_expenses(jsonb) to authenticated;
comment on function public.accounting_import_direct_cash_expenses(jsonb) is
 'Atomic direct-cash Office/Yard/General expense import with unique reference guard. Creates posted vouchers only; no supplier payable or direct manual JE.';
commit;
