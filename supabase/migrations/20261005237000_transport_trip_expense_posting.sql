-- Canonical Transport trip expense posting.
-- Depends on 20261005236000_transport_expense_import_idempotency.sql.
create or replace function public.transport_post_trip_expense(
  p_trip_id uuid,
  p_expense_date date,
  p_expense_type text,
  p_amount numeric,
  p_payment_method text,
  p_source_reference text,
  p_description text default null,
  p_supplier_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  v_company uuid:=public.current_company_id();
  v_unit uuid:=public.current_business_unit_id();
  v_location uuid:=public.current_operating_location_id();
  v_user uuid:=public.legacy_data_user_id();
  v_method text:=lower(btrim(coalesce(p_payment_method,'')));
  v_ref text:=btrim(coalesce(p_source_reference,''));
  v_trip_no text; v_expense_id uuid; v_entry public.journal_entries%rowtype;
  v_expense_account uuid; v_credit_account uuid; v_supplier_name text;
begin
  perform public.assert_module_permission('transport','edit');
  perform public.assert_module_permission('accounting','create');
  perform public.assert_module_permission('accounting','post');
  if v_company is null or v_unit is null or v_location is null then raise exception 'Active company, business unit and branch/location are required.'; end if;
  if p_expense_date is null then raise exception 'Expense date is required.'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'Expense amount must be greater than zero.'; end if;
  if nullif(btrim(coalesce(p_expense_type,'')),'') is null then raise exception 'Expense type is required.'; end if;
  if v_ref='' then raise exception 'Source reference is required.'; end if;
  if v_method not in ('cash','bank','payable') then raise exception 'Payment method must be Cash, Bank or Payable.'; end if;

  select t.trip_no into v_trip_no from public.transport_trips t
   where t.id=p_trip_id and t.company_id=v_company and t.business_unit_id=v_unit for update;
  if not found then raise exception 'Transport trip not found in the active company/business unit.'; end if;

  if exists(select 1 from public.transport_trip_expenses e where e.company_id=v_company and e.business_unit_id=v_unit and lower(btrim(e.source_reference))=lower(v_ref)) then
    raise exception 'Transport expense source reference already exists: %',v_ref;
  end if;

  if not exists(select 1 from public.transport_vehicle_expense_types et where et.company_id=v_company and et.business_unit_id=v_unit and et.is_active=true and lower(btrim(et.name))=lower(btrim(p_expense_type))) then
    raise exception 'Active Transport expense type not found: %',p_expense_type;
  end if;

  select am.account_id into v_expense_account from public.account_mappings am join public.chart_of_accounts c on c.id=am.account_id and c.company_id=v_company
   where am.user_id=v_user and am.company_id=v_company and am.mapping_key='transport_expense' and c.is_active and not c.is_group and c.type='expense' limit 1;
  if v_expense_account is null then raise exception 'Transport Expense mapping is missing or invalid.'; end if;

  if v_method='payable' then
    if p_supplier_id is null then raise exception 'Supplier is required for Payable expenses.'; end if;
    select s.name,s.account_id into v_supplier_name,v_credit_account from public.suppliers s where s.id=p_supplier_id and s.company_id=v_company;
    if not found then raise exception 'Supplier not found in the active company.'; end if;
    if v_credit_account is distinct from (select am.account_id from public.account_mappings am where am.user_id=v_user and am.company_id=v_company and am.mapping_key='accounts_payable' limit 1) then raise exception 'Supplier/AP mapping mismatch.'; end if;
  else
    select am.account_id into v_credit_account from public.account_mappings am join public.chart_of_accounts c on c.id=am.account_id and c.company_id=v_company
     where am.user_id=v_user and am.company_id=v_company and am.mapping_key=v_method and c.is_active and not c.is_group and c.type='asset' limit 1;
    if v_credit_account is null then raise exception '% mapping is missing or invalid.',initcap(v_method); end if;
  end if;

  v_entry:=public.create_manual_journal_entry(p_expense_date,concat('Transport ',p_expense_type,' expense · Trip ',v_trip_no,' · ',v_ref));
  update public.journal_entries set source_module='transport',source_document_type='trip_expense' where id=v_entry.id;

  insert into public.transport_trip_expenses(company_id,business_unit_id,trip_id,expense_date,expense_type,amount,description,journal_entry_id,created_by,source_reference)
  values(v_company,v_unit,p_trip_id,p_expense_date,btrim(p_expense_type),round(p_amount,2),nullif(btrim(coalesce(p_description,'')),''),v_entry.id,auth.uid(),v_ref)
  returning id into v_expense_id;

  update public.journal_entries set source_document_id=v_expense_id where id=v_entry.id;

  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account,account_id,debit,credit,base_debit,base_credit,party_type,party_id,party_name)
  select v_user,v_company,v_unit,v_location,v_entry.id,c.name,c.id,round(p_amount,2),0,round(p_amount,2),0,null,null,null from public.chart_of_accounts c where c.id=v_expense_account;
  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account,account_id,debit,credit,base_debit,base_credit,party_type,party_id,party_name)
  select v_user,v_company,v_unit,v_location,v_entry.id,c.name,c.id,0,round(p_amount,2),0,round(p_amount,2),
    case when v_method='payable' then 'supplier' end,case when v_method='payable' then p_supplier_id end,case when v_method='payable' then v_supplier_name end
  from public.chart_of_accounts c where c.id=v_credit_account;

  perform public.post_journal_entry(v_entry.id);
  return jsonb_build_object('success',true,'expense_id',v_expense_id,'journal_entry_id',v_entry.id,'trip_no',v_trip_no,'source_reference',v_ref,'status','posted');
end$$;
revoke all on function public.transport_post_trip_expense(uuid,date,text,numeric,text,text,text,uuid) from public;
grant execute on function public.transport_post_trip_expense(uuid,date,text,numeric,text,text,text,uuid) to authenticated;
