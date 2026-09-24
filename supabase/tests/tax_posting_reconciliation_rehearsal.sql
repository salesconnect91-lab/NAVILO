-- Isolated local Supabase database only. Four real posting RPCs; every row rolls back.
begin;
do $$
declare
  v_user uuid := gen_random_uuid();
  v_company uuid;
  v_unit uuid;
  v_location uuid;
  v_warehouse uuid;
  v_godown uuid;
  v_item uuid;
  v_supplier uuid;
  v_customer uuid;
  v_order uuid;
  v_result jsonb;
  v_entry uuid;
  v_vat_account uuid;
  v_party_account uuid;
  v_revenue_account uuid;
  v_cogs_account uuid;
  v_cogs numeric;
  v_expected_vat numeric;
  v_expected_total numeric;
  v_total numeric;
  v_vat numeric;
  v_rate numeric;
  v_code text := substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_kind text;
  v_taxed boolean;
begin
  insert into auth.users(id,role,email,created_at,updated_at)
  values(v_user,'authenticated','tax-post-'||v_code||'@navilo.test',now(),now());
  insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
  values(v_user,v_user,'tax-post-'||v_code||'@navilo.test','admin','user',true);
  insert into public.companies(name,code,status)
  values('Tax posting rehearsal','TP'||v_code,'active') returning id into v_company;
  select id into strict v_unit from public.business_units where company_id=v_company and is_default;
  insert into public.company_memberships(company_id,user_id,role,is_active)
  values(v_company,v_user,'company_owner',true);
  insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
  values(v_company,v_unit,v_user,'company_owner',true)
  on conflict(business_unit_id,user_id) do update set role='company_owner',is_active=true;
  insert into public.business_unit_modules(business_unit_id,company_id,module_key,enabled)
  select v_unit,v_company,module_key,true from
    (values ('sales'),('purchase'),('inventory'),('accounting'),('master'),('settings')) m(module_key)
  on conflict(business_unit_id,module_key) do update set enabled=true;
  insert into public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
  values(v_company,v_unit,'TP-BR','Tax rehearsal branch','branch',true) returning id into v_location;
  insert into public.operating_location_memberships
    (company_id,business_unit_id,operating_location_id,user_id,role,is_active)
  values(v_company,v_unit,v_location,v_user,'company_owner',true);
  update public.user_profiles set last_company_id=v_company,last_business_unit_id=v_unit where id=v_user;
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  insert into public.company_settings(user_id,company_id,company_name,strn)
  values(v_user,v_company,'Tax posting rehearsal','REHEARSAL-STRN');
  perform public.initialize_default_coa();

  insert into public.warehouses(company_id,name)
  values(v_company,'Tax rehearsal warehouse') returning id into v_warehouse;
  insert into public.godowns(company_id,name,warehouse_id)
  values(v_company,'Tax rehearsal godown',v_warehouse) returning id into v_godown;
  insert into public.items(user_id,company_id,sku,name,cost,price,warehouse_id)
  values(v_user,v_company,'TAX-'||v_code,'Tax rehearsal item',0,100,v_warehouse) returning id into v_item;
  insert into public.suppliers(user_id,company_id,name,account_id,tax_registration_status,strn)
  select v_user,v_company,'Tax rehearsal supplier',account_id,'registered','REHEARSAL-SUPPLIER'
    from public.account_mappings where company_id=v_company and mapping_key='accounts_payable'
  returning id into v_supplier;
  insert into public.customers(user_id,company_id,name,account_id,tax_registration_status,strn)
  select v_user,v_company,'Tax rehearsal customer',account_id,'registered','REHEARSAL-CUSTOMER'
    from public.account_mappings where company_id=v_company and mapping_key='accounts_receivable'
  returning id into v_customer;
  if v_supplier is null or v_customer is null then raise exception 'Default accounting mappings missing'; end if;
  select account_id into v_revenue_account from public.account_mappings
    where company_id=v_company and mapping_key='sales_revenue';
  select account_id into v_cogs_account from public.account_mappings
    where company_id=v_company and mapping_key='cogs';
  insert into public.charge_master(user_id,company_id,charge_key,charge_name,
    applies_to,tax_applicable,revenue_account_id,is_active)
  values(v_user,v_company,'tax-rehearsal-'||v_code,'Tax rehearsal charge',
    'sales',true,v_revenue_account,true);

  insert into public.company_tax_events(company_id,effective_from,tax_mode)
  values(v_company,current_date,'non_tax');
  insert into public.company_tax_events(company_id,effective_from,tax_mode,authority_code)
  values(v_company,current_date+1,'tax_registered','REHEARSAL');
  insert into public.tax_rates(user_id,company_id,name,rate,applies_to,is_fixed,is_active,effective_from)
  values(v_user,v_company,'Tax posting 7%',7,'both',true,true,current_date+1);

  -- Purchase stock before each sale, using the actual posting functions.
  foreach v_kind in array array['purchase','sales'] loop
    foreach v_taxed in array array[false,true] loop
      v_rate := case when v_taxed then 7 else 0 end;
      v_expected_vat := case when v_kind='sales' and v_taxed then 7.7 else v_rate end;
      v_expected_total := case when v_kind='sales' and v_taxed then 110.7 else 100+v_rate end;
      if v_kind='purchase' then
        insert into public.purchase_orders(user_id,company_id,business_unit_id,order_no,supplier_id,
          order_date,status,invoice_type,tax_percent,supplier_invoice_no,supplier_invoice_date)
        values(v_user,v_company,v_unit,'TP-P-'||v_code||case when v_taxed then '-T' else '-N' end,
          v_supplier,current_date+case when v_taxed then 1 else 0 end,'draft',
          case when v_taxed then 'Tax Invoice' else 'Purchase Invoice' end,v_rate,
          'SRC-'||v_code||case when v_taxed then '-T' else '-N' end,
          current_date+case when v_taxed then 1 else 0 end)
        returning id into v_order;
        insert into public.purchase_order_lines(user_id,company_id,business_unit_id,order_id,item_id,
          godown_id,qty,unit_cost,line_total,tax_percent)
        values(v_user,v_company,v_unit,v_order,v_item,v_godown,1,100,100,v_rate);
        v_result := public.post_purchase_invoice(v_order);
        select account_id into v_vat_account from public.account_mappings
          where company_id=v_company and mapping_key='input_vat';
        select account_id into v_party_account from public.account_mappings
          where company_id=v_company and mapping_key='accounts_payable';
      else
        insert into public.sales_orders(user_id,company_id,business_unit_id,order_no,customer_id,
          order_date,status,invoice_type,tax_percent,payment_mode)
        values(v_user,v_company,v_unit,'TP-S-'||v_code||case when v_taxed then '-T' else '-N' end,
          v_customer,current_date+case when v_taxed then 1 else 0 end,'draft',
          case when v_taxed then 'Tax Invoice' else 'Sale Invoice' end,v_rate,'Credit')
        returning id into v_order;
        insert into public.sales_order_lines(user_id,company_id,business_unit_id,order_id,item_id,
          godown_id,qty,unit_price,line_total,tax_percent)
        values(v_user,v_company,v_unit,v_order,v_item,v_godown,1,100,100,v_rate);
        if v_taxed then
          insert into public.sales_order_charges(user_id,company_id,business_unit_id,
            order_id,charge_key,charge_label,amount,rate,tax_percent,account_id)
          values(v_user,v_company,v_unit,v_order,'tax-rehearsal-'||v_code,
            'Tax rehearsal charge',10,10,v_rate,v_revenue_account);
        end if;
        v_result := public.post_sales_invoice(v_order);
        select account_id into v_vat_account from public.account_mappings
          where company_id=v_company and mapping_key='output_vat';
        select account_id into v_party_account from public.account_mappings
          where company_id=v_company and mapping_key='accounts_receivable';
      end if;
      v_entry := (v_result->>'journal_entry_id')::uuid;
      if v_entry is null then
        select id into v_entry from public.journal_entries
        where company_id=v_company and entry_no=case when v_kind='purchase' then 'PUR-' else '' end||
          'TP-'||case when v_kind='purchase' then 'P-' else 'S-' end||v_code||case when v_taxed then '-T' else '-N' end;
      end if;
      select coalesce(sum(case when v_kind='purchase' then debit else credit end),0)
        into v_vat from public.journal_lines where entry_id=v_entry and account_id=v_vat_account;
      select coalesce(sum(case when v_kind='purchase' then credit else debit end),0)
        into v_total from public.journal_lines where entry_id=v_entry and account_id=v_party_account;
      if v_kind='sales' then
        select coalesce(sum(debit),0) into v_cogs from public.journal_lines
          where entry_id=v_entry and account_id=v_cogs_account;
        if v_cogs<>100 or public.get_inventory_avg_cost(v_item)<>100 then
          raise exception 'Sales posting lost weighted-average COGS: journal %, average %',
            v_cogs,public.get_inventory_avg_cost(v_item);
        end if;
      end if;
      if v_entry is null or v_vat<>v_expected_vat or
         (v_result->>'tax_total' is not null and (v_result->>'tax_total')::numeric<>v_expected_vat) or
         (v_kind='purchase' and (v_result->>'grand_total')::numeric<>v_expected_total) or
         (v_kind='sales' and (v_result->>'invoice_total')::numeric<>v_expected_total) or
         v_total<>v_expected_total or
         (select status from public.journal_entries where id=v_entry)<>'posted' then
        raise exception '% taxed=% posting VAT/journal mismatch: result %, VAT %, debit %',v_kind,v_taxed,v_result,v_vat,v_total;
      end if;
    end loop;
  end loop;

  -- Updating the configuration must not reprice or rewrite either posted invoice.
  insert into public.tax_rates(user_id,company_id,name,rate,applies_to,is_fixed,is_active,effective_from)
  values(v_user,v_company,'Tax posting 12%',12,'both',true,true,current_date+2);
  if public.fixed_tax_rate_on(v_company,'sales',current_date+2)<>12 or
     (select count(*) from public.sales_orders where company_id=v_company and status='posted'
       and ((order_date=current_date and invoice_type='Sale Invoice' and tax_percent=0) or
            (order_date=current_date+1 and invoice_type='Tax Invoice' and tax_percent=7)))<>2 or
     (select count(*) from public.purchase_orders where company_id=v_company and status='posted'
       and ((order_date=current_date and invoice_type='Purchase Invoice' and tax_percent=0) or
            (order_date=current_date+1 and invoice_type='Tax Invoice' and tax_percent=7)))<>2 then
    raise exception 'Posted historical tax snapshots changed after effective rate update';
  end if;
  raise notice 'PASS: four real postings reconcile VAT and totals; historical snapshots survive future tax rate';
end $$;
rollback;
