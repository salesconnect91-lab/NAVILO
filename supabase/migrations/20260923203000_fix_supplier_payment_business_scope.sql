begin;

create or replace function public.pay_supplier(
  p_supplier_id uuid,p_payment_date date,p_payment_account_id uuid,p_payment_method text,p_reference text,p_description text,p_notes text,p_purchase_order_id uuid,p_amount numeric
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid uuid:=public.legacy_data_user_id();
  v_company uuid:=public.current_company_id();
  v_bu uuid:=public.current_business_unit_id();
  v_location uuid:=public.current_operating_location_id();
  v_supplier public.suppliers%rowtype; v_order public.purchase_orders%rowtype;
  v_ap uuid; v_cash uuid; v_bank uuid; v_amount numeric:=round(coalesce(p_amount,0),2); v_paid numeric:=0; v_outstanding numeric:=0;
  v_date date:=coalesce(p_payment_date,current_date); v_journal uuid; v_ap_line uuid; v_entry_no text; v_next bigint; v_payment_text text; v_ap_text text;
begin
  perform public.assert_module_permission('accounting','post');
  if v_uid is null or v_company is null or v_bu is null or v_location is null then
    raise exception 'Authentication, active company, business unit and branch/location are required.';
  end if;
  if p_supplier_id is null or p_purchase_order_id is null or p_payment_account_id is null then raise exception 'Supplier, Purchase Invoice and Payment Account are required.'; end if;
  if v_amount<=0 then raise exception 'Payment amount must be greater than zero.'; end if;

  select * into v_supplier
  from public.suppliers
  where id=p_supplier_id and user_id=v_uid and company_id=v_company
  for update;
  if not found then raise exception 'Supplier not found in active company.'; end if;

  select * into v_order
  from public.purchase_orders
  where id=p_purchase_order_id
    and user_id=v_uid
    and company_id=v_company
    and business_unit_id=v_bu
    and operating_location_id=v_location
    and supplier_id=p_supplier_id
  for update;
  if not found then raise exception 'Purchase Invoice does not belong to selected supplier/active company, business unit and branch.'; end if;
  if v_order.status<>'posted' then raise exception 'Only posted Purchase Invoices can be paid.'; end if;

  select account_id into v_ap from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='accounts_payable' limit 1;
  select account_id into v_cash from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='cash' limit 1;
  select account_id into v_bank from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='bank' limit 1;
  if v_ap is null then raise exception 'Accounts Payable mapping is missing.'; end if;
  if v_supplier.account_id is distinct from v_ap then raise exception 'Supplier is not linked to configured Accounts Payable account.'; end if;
  if p_payment_account_id is distinct from v_cash and p_payment_account_id is distinct from v_bank then raise exception 'Payment account must be configured Cash or Bank.'; end if;

  select code||' - '||name into v_payment_text from public.chart_of_accounts where id=p_payment_account_id and user_id=v_uid and company_id=v_company and is_active and not is_group;
  select code||' - '||name into v_ap_text from public.chart_of_accounts where id=v_ap and user_id=v_uid and company_id=v_company and is_active and not is_group;
  if v_payment_text is null or v_ap_text is null then raise exception 'Configured payment/AP account is invalid or inactive.'; end if;

  select round(coalesce(sum(amount),0),2) into v_paid
  from public.purchase_payment_allocations
  where user_id=v_uid and company_id=v_company and business_unit_id=v_bu and operating_location_id=v_location and purchase_order_id=v_order.id;

  v_outstanding:=greatest(round(coalesce(v_order.total,0),2)-v_paid,0);
  if v_amount>v_outstanding+0.005 then raise exception 'Payment exceeds Purchase Invoice outstanding balance. Outstanding: %, Payment: %.',v_outstanding,v_amount; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':'||v_bu::text||':'||v_location::text||':supplier_payment_number',0));
  select coalesce(max(nullif(substring(entry_no from '^SP-([0-9]+)$'),'')::bigint),0)+1 into v_next
  from public.journal_entries
  where user_id=v_uid and company_id=v_company and business_unit_id=v_bu and operating_location_id=v_location and entry_no~'^SP-[0-9]+$';
  v_entry_no:='SP-'||lpad(v_next::text,4,'0');

  insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,payment_mode,party_name,trans_type)
  values(v_uid,v_company,v_bu,v_location,v_entry_no,v_date,coalesce(nullif(btrim(p_description),''),'Supplier Payment - '||v_supplier.name),'draft',coalesce(nullif(btrim(p_payment_method),''),'Payment'),v_supplier.name,'Supplier Payment')
  returning id into v_journal;

  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account,debit,credit,account_id,party_name,party_type,party_id)
  values(v_uid,v_company,v_bu,v_location,v_journal,v_ap_text,v_amount,0,v_ap,v_supplier.name,'supplier',v_supplier.id)
  returning id into v_ap_line;

  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account,debit,credit,account_id)
  values(v_uid,v_company,v_bu,v_location,v_journal,v_payment_text,0,v_amount,p_payment_account_id);

  perform public.post_journal_entry(v_journal);

  insert into public.purchase_payment_allocations(user_id,company_id,business_unit_id,operating_location_id,purchase_order_id,order_no,journal_entry_id,journal_line_id,supplier_id,supplier_name,amount,allocation_date,reference,notes)
  values(v_uid,v_company,v_bu,v_location,v_order.id,v_order.order_no,v_journal,v_ap_line,v_supplier.id,v_supplier.name,v_amount,v_date,nullif(btrim(p_reference),''),nullif(btrim(p_notes),''));

  v_paid:=round(v_paid+v_amount,2); v_outstanding:=greatest(round(coalesce(v_order.total,0),2)-v_paid,0);
  perform set_config('app.supplier_payment_update','1',true);
  update public.purchase_orders
  set paid_amount=v_paid,outstanding_amount=v_outstanding,payment_status=case when v_outstanding<=0.005 then 'paid' when v_paid>0 then 'partial' else 'unpaid' end
  where id=v_order.id and user_id=v_uid and company_id=v_company and business_unit_id=v_bu and operating_location_id=v_location;
  if not found then raise exception 'Purchase Invoice payment status could not be updated.'; end if;

  return jsonb_build_object('success',true,'entry_no',v_entry_no,'journal_entry_id',v_journal,'payment_amount',v_amount,'paid_amount',v_paid,'outstanding_amount',v_outstanding,'purchase_order_id',v_order.id,'supplier_id',v_supplier.id);
end;$$;

revoke all on function public.pay_supplier(uuid,date,uuid,text,text,text,text,uuid,numeric) from public,anon;
grant execute on function public.pay_supplier(uuid,date,uuid,text,text,text,text,uuid,numeric) to authenticated;

notify pgrst, 'reload schema';
commit;
