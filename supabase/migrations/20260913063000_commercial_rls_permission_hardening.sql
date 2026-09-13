-- Commercial tenant-permission hardening.

-- Branch membership management: users can read their own assignment, while only
-- platform/company access administrators can manage assignments inside current company.
drop policy if exists operating_location_memberships_access on public.operating_location_memberships;
drop policy if exists operating_location_memberships_select on public.operating_location_memberships;
drop policy if exists operating_location_memberships_insert on public.operating_location_memberships;
drop policy if exists operating_location_memberships_update on public.operating_location_memberships;
drop policy if exists operating_location_memberships_delete on public.operating_location_memberships;
create policy operating_location_memberships_select on public.operating_location_memberships for select to authenticated using (public.is_platform_owner() or user_id=auth.uid() or public.can_manage_company_access(company_id));
create policy operating_location_memberships_insert on public.operating_location_memberships for insert to authenticated with check (
  public.can_manage_company_access(company_id) and company_id=public.current_company_id()
  and exists(select 1 from public.operating_locations l where l.id=operating_location_id and l.company_id=operating_location_memberships.company_id and l.business_unit_id is not distinct from operating_location_memberships.business_unit_id and l.is_active)
  and exists(select 1 from public.company_memberships m where m.company_id=operating_location_memberships.company_id and m.user_id=operating_location_memberships.user_id and m.is_active)
);
create policy operating_location_memberships_update on public.operating_location_memberships for update to authenticated using (public.can_manage_company_access(company_id)) with check (
  public.can_manage_company_access(company_id) and company_id=public.current_company_id()
  and exists(select 1 from public.operating_locations l where l.id=operating_location_id and l.company_id=operating_location_memberships.company_id and l.business_unit_id is not distinct from operating_location_memberships.business_unit_id)
  and exists(select 1 from public.company_memberships m where m.company_id=operating_location_memberships.company_id and m.user_id=operating_location_memberships.user_id)
);
create policy operating_location_memberships_delete on public.operating_location_memberships for delete to authenticated using (public.can_manage_company_access(company_id));

-- Salary profile is sensitive accounting data, not a generic current-company table.
drop policy if exists employee_salary_profiles_modify on public.employee_salary_profiles;
drop policy if exists employee_salary_profiles_select on public.employee_salary_profiles;
drop policy if exists employee_salary_profiles_insert on public.employee_salary_profiles;
drop policy if exists employee_salary_profiles_update on public.employee_salary_profiles;
drop policy if exists employee_salary_profiles_delete on public.employee_salary_profiles;
create policy employee_salary_profiles_select on public.employee_salary_profiles for select to authenticated using (company_id=public.current_company_id() and public.has_module_permission(company_id,'accounting','view'));
create policy employee_salary_profiles_insert on public.employee_salary_profiles for insert to authenticated with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'accounting','post'));
create policy employee_salary_profiles_update on public.employee_salary_profiles for update to authenticated using (company_id=public.current_company_id() and public.has_module_permission(company_id,'accounting','post')) with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'accounting','post'));
create policy employee_salary_profiles_delete on public.employee_salary_profiles for delete to authenticated using (company_id=public.current_company_id() and public.has_module_permission(company_id,'accounting','delete'));

-- Lender data is company/BU shared. Stable legacy owner id is the canonical data owner;
-- application users are controlled through accounting module permissions.
create or replace function public.create_loan_party(p_name text,p_phone text default null::text,p_notes text default null::text)
returns uuid language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_uid uuid:=public.legacy_data_user_id(); v_company uuid:=public.current_company_id(); v_bu uuid:=public.current_business_unit_id(); v_id uuid;
begin
  perform public.assert_module_permission('accounting','create');
  if auth.uid() is null or v_uid is null or v_company is null or v_bu is null then raise exception 'Authentication and active company/business unit are required.'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'Lender name is required.'; end if;
  select id into v_id from public.loan_parties where user_id=v_uid and company_id=v_company and business_unit_id=v_bu and lower(name)=lower(btrim(p_name)) and is_active limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.loan_parties(user_id,company_id,business_unit_id,name,phone,notes) values(v_uid,v_company,v_bu,btrim(p_name),nullif(btrim(p_phone),''),nullif(btrim(p_notes),'')) returning id into v_id;
  return v_id;
end $function$;

create or replace function public.post_loan_party_transaction(p_lender_id uuid,p_transaction_type text,p_transaction_date date,p_cash_bank_account_id uuid,p_amount numeric,p_reference text default null::text,p_notes text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_uid uuid:=public.legacy_data_user_id(); v_company uuid:=public.current_company_id(); v_bu uuid:=public.current_business_unit_id(); v_lender public.loan_parties%rowtype; v_loan_account uuid; v_post jsonb; v_outstanding numeric:=0;
begin
  perform public.assert_module_permission('accounting','post');
  if auth.uid() is null or v_uid is null or v_company is null or v_bu is null then raise exception 'Authentication and active company/business unit are required.'; end if;
  if p_transaction_type not in ('loan_received','loan_repayment') then raise exception 'Invalid loan transaction type.'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'Amount must be greater than zero.'; end if;
  if p_transaction_date is null then raise exception 'Transaction date is required.'; end if;
  select * into v_lender from public.loan_parties where id=p_lender_id and user_id=v_uid and company_id=v_company and business_unit_id=v_bu and is_active for update;
  if not found then raise exception 'Select a valid active lender.'; end if;
  select id into v_loan_account from public.chart_of_accounts where user_id=v_uid and company_id=v_company and type='liability' and is_active and not is_group and allow_manual_entries and (detail_type='Loan Payable' or lower(name)='loan payable') order by code limit 1;
  if v_loan_account is null then raise exception 'Loan Payable account is not configured.'; end if;
  if p_transaction_type='loan_repayment' then
    select coalesce(sum(case when transaction_type='loan_received' then amount else -amount end),0) into v_outstanding from public.loan_party_transactions where lender_id=p_lender_id and company_id=v_company and business_unit_id=v_bu;
    if p_amount>v_outstanding+0.005 then raise exception 'Repayment cannot exceed lender outstanding balance of %.',round(v_outstanding,2); end if;
  end if;
  v_post:=public.post_general_cash_bank_transaction(p_transaction_date,p_transaction_type,v_loan_account,p_cash_bank_account_id,p_amount,v_lender.name,p_reference,p_notes);
  insert into public.loan_party_transactions(user_id,company_id,business_unit_id,lender_id,journal_entry_id,transaction_date,transaction_type,amount,reference,notes) values(v_uid,v_company,v_bu,p_lender_id,(v_post->>'journal_entry_id')::uuid,p_transaction_date,p_transaction_type,round(p_amount,2),nullif(btrim(p_reference),''),nullif(btrim(p_notes),''));
  return v_post||jsonb_build_object('lender_id',v_lender.id,'lender_name',v_lender.name);
end $function$;

drop policy if exists loan_parties_company_bu_scope on public.loan_parties;
drop policy if exists loan_parties_select on public.loan_parties;
drop policy if exists loan_parties_insert on public.loan_parties;
drop policy if exists loan_parties_update on public.loan_parties;
drop policy if exists loan_parties_delete on public.loan_parties;
create policy loan_parties_select on public.loan_parties for select to authenticated using (user_id=public.legacy_data_user_id() and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'accounting','view'));
create policy loan_parties_insert on public.loan_parties for insert to authenticated with check (user_id=public.legacy_data_user_id() and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'accounting','create'));
create policy loan_parties_update on public.loan_parties for update to authenticated using (user_id=public.legacy_data_user_id() and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'accounting','edit')) with check (user_id=public.legacy_data_user_id() and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'accounting','edit'));
create policy loan_parties_delete on public.loan_parties for delete to authenticated using (user_id=public.legacy_data_user_id() and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'accounting','delete'));

drop policy if exists loan_party_transactions_company_bu_scope on public.loan_party_transactions;
drop policy if exists loan_party_transactions_select on public.loan_party_transactions;
drop policy if exists loan_party_transactions_insert on public.loan_party_transactions;
drop policy if exists loan_party_transactions_update on public.loan_party_transactions;
drop policy if exists loan_party_transactions_delete on public.loan_party_transactions;
create policy loan_party_transactions_select on public.loan_party_transactions for select to authenticated using (user_id=public.legacy_data_user_id() and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'accounting','view'));
create policy loan_party_transactions_insert on public.loan_party_transactions for insert to authenticated with check (user_id=public.legacy_data_user_id() and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'accounting','post'));
create policy loan_party_transactions_update on public.loan_party_transactions for update to authenticated using (user_id=public.legacy_data_user_id() and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'accounting','edit')) with check (user_id=public.legacy_data_user_id() and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'accounting','edit'));
create policy loan_party_transactions_delete on public.loan_party_transactions for delete to authenticated using (user_id=public.legacy_data_user_id() and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'accounting','delete'));
