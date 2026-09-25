begin;

-- Realized FX settlement engine.
-- Source-currency allocations remain in document currency.
-- Journal debit/credit amounts are base currency.
-- Each source line carries its own locked conversion rate.

create or replace function public.fx_mapping_account(
  p_user_id uuid,p_company_id uuid,p_mapping_key text,p_expected_type text
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_account uuid;
begin
  select am.account_id into v_account
  from public.account_mappings am
  join public.chart_of_accounts coa on coa.id=am.account_id
  where am.user_id=p_user_id and am.company_id=p_company_id
    and am.mapping_key=p_mapping_key and coa.user_id=p_user_id
    and coa.company_id=p_company_id and coa.is_active and not coa.is_group
    and coa.type=p_expected_type
  limit 1;
  if v_account is null then
    raise exception 'Valid % mapping (%) is required.',p_mapping_key,p_expected_type;
  end if;
  return v_account;
end $$;
revoke all on function public.fx_mapping_account(uuid,uuid,text,text) from public,anon,authenticated;

create or replace function public.pay_supplier(
  p_supplier_id uuid,p_payment_date date,p_payment_account_id uuid,p_payment_method text,
  p_reference text,p_description text,p_notes text,p_purchase_order_id uuid,p_amount numeric
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid uuid:=public.legacy_data_user_id(); v_company uuid:=public.current_company_id();
  v_bu uuid:=public.current_business_unit_id(); v_location uuid:=public.current_operating_location_id();
  v_supplier public.suppliers%rowtype; v_order public.purchase_orders%rowtype;
  v_ap uuid; v_cash uuid; v_bank uuid; v_fx_gain uuid; v_fx_loss uuid;
  v_amount numeric:=round(coalesce(p_amount,0),2); v_paid numeric:=0; v_outstanding numeric:=0;
  v_date date:=coalesce(p_payment_date,current_date); v_journal uuid; v_ap_line uuid;
  v_entry_no text; v_next bigint; v_payment_text text; v_ap_text text; v_fx_text text;
  v_base text; v_currency text; v_invoice_rate numeric; v_settlement_rate numeric;
  v_ap_base numeric; v_cash_base numeric; v_fx numeric;
begin
  perform public.assert_module_permission('accounting','post');
  if v_uid is null or v_company is null or v_bu is null or v_location is null then
    raise exception 'Authentication, active company, business unit and branch/location are required.';
  end if;
  if p_supplier_id is null or p_purchase_order_id is null or p_payment_account_id is null then
    raise exception 'Supplier, Purchase Invoice and Payment Account are required.';
  end if;
  if v_amount<=0 then raise exception 'Payment amount must be greater than zero.'; end if;

  select * into v_supplier from public.suppliers
  where id=p_supplier_id and user_id=v_uid and company_id=v_company for update;
  if not found then raise exception 'Supplier not found in active company.'; end if;

  select * into v_order from public.purchase_orders
  where id=p_purchase_order_id and user_id=v_uid and company_id=v_company
    and business_unit_id=v_bu and operating_location_id=v_location and supplier_id=p_supplier_id
  for update;
  if not found then raise exception 'Purchase Invoice does not belong to selected supplier/active company, business unit and branch.'; end if;
  if v_order.status<>'posted' then raise exception 'Only posted Purchase Invoices can be paid.'; end if;

  select base_currency_code into v_base from public.companies where id=v_company;
  v_currency:=coalesce(nullif(v_order.currency_code,''),v_base);
  v_invoice_rate:=case when v_currency=v_base then 1 else v_order.exchange_rate end;
  if v_invoice_rate is null or v_invoice_rate<=0 then raise exception 'Purchase Invoice has no valid locked exchange rate.'; end if;
  v_settlement_rate:=case when v_currency=v_base then 1 else public.company_exchange_rate_on(v_company,v_currency,v_date) end;
  if v_settlement_rate is null or v_settlement_rate<=0 then raise exception 'No settlement-date exchange rate for % on %.',v_currency,v_date; end if;

  select account_id into v_ap from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='accounts_payable' limit 1;
  select account_id into v_cash from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='cash' limit 1;
  select account_id into v_bank from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='bank' limit 1;
  if v_ap is null then raise exception 'Accounts Payable mapping is missing.'; end if;
  if v_supplier.account_id is distinct from v_ap then raise exception 'Supplier is not linked to configured Accounts Payable account.'; end if;
  if p_payment_account_id is distinct from v_cash and p_payment_account_id is distinct from v_bank then raise exception 'Payment account must be configured Cash or Bank.'; end if;

  select code||' - '||name into v_payment_text from public.chart_of_accounts
  where id=p_payment_account_id and user_id=v_uid and company_id=v_company and is_active and not is_group;
  select code||' - '||name into v_ap_text from public.chart_of_accounts
  where id=v_ap and user_id=v_uid and company_id=v_company and is_active and not is_group;
  if v_payment_text is null or v_ap_text is null then raise exception 'Configured payment/AP account is invalid or inactive.'; end if;

  select round(coalesce(sum(amount),0),2) into v_paid from public.purchase_payment_allocations
  where user_id=v_uid and company_id=v_company and business_unit_id=v_bu
    and operating_location_id=v_location and purchase_order_id=v_order.id;
  v_outstanding:=greatest(round(coalesce(v_order.total,0),2)-v_paid,0);
  if v_amount>v_outstanding+0.005 then raise exception 'Payment exceeds Purchase Invoice outstanding balance. Outstanding: %, Payment: %.',v_outstanding,v_amount; end if;

  v_ap_base:=round(v_amount*v_invoice_rate,2);
  v_cash_base:=round(v_amount*v_settlement_rate,2);
  v_fx:=round(v_cash_base-v_ap_base,2);
  if v_fx>0 then v_fx_loss:=public.fx_mapping_account(v_uid,v_company,'fx_loss','expense');
  elsif v_fx<0 then v_fx_gain:=public.fx_mapping_account(v_uid,v_company,'fx_gain','revenue'); end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':'||v_bu::text||':'||v_location::text||':supplier_payment_number',0));
  select coalesce(max(nullif(substring(entry_no from '^SP-([0-9]+)$'),'')::bigint),0)+1 into v_next
  from public.journal_entries where user_id=v_uid and company_id=v_company and business_unit_id=v_bu
    and operating_location_id=v_location and entry_no~'^SP-[0-9]+$';
  v_entry_no:='SP-'||lpad(v_next::text,4,'0');

  insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,payment_mode,party_name,trans_type,currency_code,exchange_rate)
  values(v_uid,v_company,v_bu,v_location,v_entry_no,v_date,coalesce(nullif(btrim(p_description),''),'Supplier Payment - '||v_supplier.name),'draft',coalesce(nullif(btrim(p_payment_method),''),'Payment'),v_supplier.name,'Supplier Payment',v_currency,v_settlement_rate)
  returning id into v_journal;

  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account,debit,credit,account_id,party_name,party_type,party_id,source_debit,source_credit,amount_basis,source_exchange_rate)
  values(v_uid,v_company,v_bu,v_location,v_journal,v_ap_text,v_ap_base,0,v_ap,v_supplier.name,'supplier',v_supplier.id,v_amount,0,'source_currency',v_invoice_rate)
  returning id into v_ap_line;

  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account,debit,credit,account_id,source_debit,source_credit,amount_basis,source_exchange_rate)
  values(v_uid,v_company,v_bu,v_location,v_journal,v_payment_text,0,v_cash_base,p_payment_account_id,0,v_amount,'source_currency',v_settlement_rate);

  if v_fx>0 then
    select code||' - '||name into v_fx_text from public.chart_of_accounts where id=v_fx_loss;
    insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account,debit,credit,account_id,amount_basis)
    values(v_uid,v_company,v_bu,v_location,v_journal,v_fx_text,v_fx,0,v_fx_loss,'base_currency');
  elsif v_fx<0 then
    select code||' - '||name into v_fx_text from public.chart_of_accounts where id=v_fx_gain;
    insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account,debit,credit,account_id,amount_basis)
    values(v_uid,v_company,v_bu,v_location,v_journal,v_fx_text,0,abs(v_fx),v_fx_gain,'base_currency');
  end if;

  perform public.post_journal_entry(v_journal);

  insert into public.purchase_payment_allocations(user_id,company_id,business_unit_id,operating_location_id,purchase_order_id,order_no,journal_entry_id,journal_line_id,supplier_id,supplier_name,amount,allocation_date,reference,notes)
  values(v_uid,v_company,v_bu,v_location,v_order.id,v_order.order_no,v_journal,v_ap_line,v_supplier.id,v_supplier.name,v_amount,v_date,nullif(btrim(p_reference),''),nullif(btrim(p_notes),''));

  v_paid:=round(v_paid+v_amount,2); v_outstanding:=greatest(round(coalesce(v_order.total,0),2)-v_paid,0);
  perform set_config('app.supplier_payment_update','1',true);
  update public.purchase_orders set paid_amount=v_paid,outstanding_amount=v_outstanding,
    payment_status=case when v_outstanding<=0.005 then 'paid' when v_paid>0 then 'partial' else 'unpaid' end
  where id=v_order.id and user_id=v_uid and company_id=v_company and business_unit_id=v_bu and operating_location_id=v_location;
  if not found then raise exception 'Purchase Invoice payment status could not be updated.'; end if;

  return jsonb_build_object('success',true,'entry_no',v_entry_no,'journal_entry_id',v_journal,
    'payment_amount',v_amount,'invoice_rate',v_invoice_rate,'settlement_rate',v_settlement_rate,
    'ap_base',v_ap_base,'cash_bank_base',v_cash_base,'fx_gain_base',greatest(-v_fx,0),
    'fx_loss_base',greatest(v_fx,0),'paid_amount',v_paid,'outstanding_amount',v_outstanding,
    'purchase_order_id',v_order.id,'supplier_id',v_supplier.id);
end $$;
revoke all on function public.pay_supplier(uuid,date,uuid,text,text,text,text,uuid,numeric) from public,anon;
grant execute on function public.pay_supplier(uuid,date,uuid,text,text,text,text,uuid,numeric) to authenticated;

-- Customer receipts can contain several allocations. For foreign currency,
-- require one currency/rate family per receipt so the cash line has one
-- settlement currency while each AR line retains its invoice rate.
create or replace function public.receive_customer_payment(
  p_customer_id uuid,p_payment_date date,p_payment_account_id uuid,p_payment_method text,
  p_reference text,p_description text,p_notes text,p_allocations jsonb,p_amount numeric default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid uuid:=public.legacy_data_user_id(); v_company uuid:=public.current_company_id();
  v_bu uuid:=public.current_business_unit_id(); v_loc uuid:=public.current_operating_location_id();
  v_customer public.customers%rowtype; v_invoice public.sales_orders%rowtype;
  v_ar uuid; v_fx_gain uuid; v_fx_loss uuid; v_amount numeric:=round(coalesce(p_amount,0),2);
  v_alloc numeric:=0; v_existing numeric; v_outstanding numeric; v_journal uuid;
  v_entry_no text; v_next bigint; v_payment_text text; v_ar_text text; v_fx_text text;
  v_base text; v_currency text; v_invoice_currency text; v_settlement_rate numeric;
  v_cash_base numeric; v_ar_base numeric:=0; v_fx numeric; r record; v_ar_line uuid;
begin
  perform public.assert_module_permission('accounting','post');
  if v_uid is null or v_company is null or v_bu is null or v_loc is null then raise exception 'Authentication and active company, business unit and branch are required.'; end if;
  if p_customer_id is null or p_payment_account_id is null then raise exception 'Customer and payment account are required.'; end if;
  if p_allocations is null then p_allocations:='[]'::jsonb; end if;
  if jsonb_typeof(p_allocations)<>'array' then raise exception 'Payment allocations must be a JSON array.'; end if;

  select * into v_customer from public.customers where id=p_customer_id and user_id=v_uid and company_id=v_company for update;
  if not found then raise exception 'Customer not found in active company.'; end if;
  select base_currency_code into v_base from public.companies where id=v_company;
  select account_id into v_ar from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='accounts_receivable' limit 1;
  if v_ar is null then raise exception 'Accounts Receivable mapping is missing.'; end if;
  if v_customer.account_id is distinct from v_ar then raise exception 'Customer is not linked to configured Accounts Receivable account.'; end if;
  select code||' - '||name into v_payment_text from public.chart_of_accounts where id=p_payment_account_id and user_id=v_uid and company_id=v_company and is_active and not is_group;
  select code||' - '||name into v_ar_text from public.chart_of_accounts where id=v_ar and user_id=v_uid and company_id=v_company and is_active and not is_group;
  if v_payment_text is null or v_ar_text is null then raise exception 'Configured payment/AR account is invalid or inactive.'; end if;

  for r in select (x.value->>'sales_order_id')::uuid sales_order_id,round(sum((x.value->>'amount')::numeric),2) amount
    from jsonb_array_elements(p_allocations) x(value) where nullif(x.value->>'sales_order_id','') is not null
    group by (x.value->>'sales_order_id')::uuid order by 1
  loop
    if r.amount<=0 then raise exception 'Allocation amount must be greater than zero.'; end if;
    select * into v_invoice from public.sales_orders where id=r.sales_order_id and user_id=v_uid and company_id=v_company
      and business_unit_id=v_bu and operating_location_id=v_loc and customer_id=p_customer_id for update;
    if not found then raise exception 'Allocated invoice does not belong to selected customer/active branch.'; end if;
    if v_invoice.status<>'posted' then raise exception 'Only posted sales invoices can receive payment. Invoice: %',v_invoice.order_no; end if;
    v_invoice_currency:=coalesce(nullif(v_invoice.currency_code,''),v_base);
    if v_currency is null then v_currency:=v_invoice_currency;
    elsif v_currency<>v_invoice_currency then raise exception 'One receipt cannot settle invoices in multiple currencies.'; end if;
    if v_invoice_currency<>v_base and (v_invoice.exchange_rate is null or v_invoice.exchange_rate<=0) then raise exception 'Invoice % has no valid locked exchange rate.',v_invoice.order_no; end if;
    select coalesce(sum(a.amount),0) into v_existing from public.invoice_payment_allocations a
      where a.user_id=v_uid and a.company_id=v_company and a.business_unit_id=v_bu and a.sales_order_id=v_invoice.id;
    v_outstanding:=greatest(round(coalesce(v_invoice.total,0),2)-round(v_existing,2),0);
    if r.amount>v_outstanding+0.005 then raise exception 'Allocation for invoice % exceeds outstanding balance.',v_invoice.order_no; end if;
    v_alloc:=v_alloc+r.amount;
    v_ar_base:=v_ar_base+round(r.amount*case when v_invoice_currency=v_base then 1 else v_invoice.exchange_rate end,2);
  end loop;

  v_alloc:=round(v_alloc,2); if p_amount is null then v_amount:=v_alloc; end if;
  if v_amount<=0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if v_alloc>v_amount+0.005 then raise exception 'Allocated amount cannot exceed payment amount.'; end if;
  if v_currency is null then v_currency:=v_base; end if;
  if v_currency<>v_base and abs(v_amount-v_alloc)>0.005 then raise exception 'Unallocated foreign-currency customer advances require a dedicated FX advance workflow.'; end if;
  v_settlement_rate:=case when v_currency=v_base then 1 else public.company_exchange_rate_on(v_company,v_currency,coalesce(p_payment_date,current_date)) end;
  if v_settlement_rate is null or v_settlement_rate<=0 then raise exception 'No settlement-date exchange rate for %.',v_currency; end if;
  v_cash_base:=round(v_amount*v_settlement_rate,2); v_fx:=round(v_cash_base-v_ar_base,2);
  if v_fx>0 then v_fx_gain:=public.fx_mapping_account(v_uid,v_company,'fx_gain','revenue');
  elsif v_fx<0 then v_fx_loss:=public.fx_mapping_account(v_uid,v_company,'fx_loss','expense'); end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':'||v_bu::text||':'||v_loc::text||':customer_receipt_number',0));
  select coalesce(max(nullif(substring(entry_no from '^CR-([0-9]+)$'),'')::bigint),0)+1 into v_next
  from public.journal_entries where user_id=v_uid and company_id=v_company and business_unit_id=v_bu and operating_location_id=v_loc and entry_no~'^CR-[0-9]+$';
  v_entry_no:='CR-'||lpad(v_next::text,4,'0');

  insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,payment_mode,party_name,trans_type,source_module,source_document_type,currency_code,exchange_rate)
  values(v_uid,v_company,v_bu,v_loc,v_entry_no,coalesce(p_payment_date,current_date),coalesce(nullif(btrim(p_description),''),'Customer Receipt - '||v_customer.name),'draft',coalesce(nullif(btrim(p_payment_method),''),'Cash'),v_customer.name,'Customer Receipt','accounting','customer_receipt',v_currency,v_settlement_rate)
  returning id into v_journal;

  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,source_debit,source_credit,amount_basis,source_exchange_rate)
  values(v_uid,v_company,v_bu,v_loc,v_journal,p_payment_account_id,v_payment_text,v_cash_base,0,v_amount,0,'source_currency',v_settlement_rate);

  for r in select (x.value->>'sales_order_id')::uuid sales_order_id,round(sum((x.value->>'amount')::numeric),2) amount
    from jsonb_array_elements(p_allocations) x(value) where nullif(x.value->>'sales_order_id','') is not null
    group by (x.value->>'sales_order_id')::uuid order by 1
  loop
    select * into v_invoice from public.sales_orders where id=r.sales_order_id;
    insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name,source_debit,source_credit,amount_basis,source_exchange_rate)
    values(v_uid,v_company,v_bu,v_loc,v_journal,v_ar,v_ar_text,0,round(r.amount*case when v_currency=v_base then 1 else v_invoice.exchange_rate end,2),'customer',v_customer.id,v_customer.name,0,r.amount,'source_currency',case when v_currency=v_base then 1 else v_invoice.exchange_rate end)
    returning id into v_ar_line;
    insert into public.invoice_payment_allocations(user_id,company_id,business_unit_id,operating_location_id,sales_order_id,journal_entry_id,journal_line_id,customer_id,allocation_date,amount,reference,notes)
    values(v_uid,v_company,v_bu,v_loc,r.sales_order_id,v_journal,v_ar_line,v_customer.id,coalesce(p_payment_date,current_date),r.amount,nullif(btrim(p_reference),''),nullif(btrim(p_notes),''));
  end loop;

  if v_fx>0 then
    select code||' - '||name into v_fx_text from public.chart_of_accounts where id=v_fx_gain;
    insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,amount_basis)
    values(v_uid,v_company,v_bu,v_loc,v_journal,v_fx_gain,v_fx_text,0,v_fx,'base_currency');
  elsif v_fx<0 then
    select code||' - '||name into v_fx_text from public.chart_of_accounts where id=v_fx_loss;
    insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,amount_basis)
    values(v_uid,v_company,v_bu,v_loc,v_journal,v_fx_loss,v_fx_text,abs(v_fx),0,'base_currency');
  end if;

  perform public.post_journal_entry(v_journal);
  return jsonb_build_object('success',true,'entry_no',v_entry_no,'journal_entry_id',v_journal,'payment_amount',v_amount,
    'allocated_amount',v_alloc,'currency_code',v_currency,'settlement_rate',v_settlement_rate,
    'ar_base',v_ar_base,'cash_bank_base',v_cash_base,'fx_gain_base',greatest(v_fx,0),'fx_loss_base',greatest(-v_fx,0),'customer_id',v_customer.id);
end $$;

create or replace function public.receive_customer_payment(
  p_customer_id uuid,p_payment_date date,p_payment_account_id uuid,p_payment_method text,
  p_reference text,p_description text,p_notes text,p_allocations jsonb
) returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select public.receive_customer_payment($1,$2,$3,$4,$5,$6,$7,$8,null::numeric)
$$;

revoke all on function public.receive_customer_payment(uuid,date,uuid,text,text,text,text,jsonb,numeric) from public,anon;
revoke all on function public.receive_customer_payment(uuid,date,uuid,text,text,text,text,jsonb) from public,anon;
grant execute on function public.receive_customer_payment(uuid,date,uuid,text,text,text,text,jsonb,numeric) to authenticated;
grant execute on function public.receive_customer_payment(uuid,date,uuid,text,text,text,text,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
