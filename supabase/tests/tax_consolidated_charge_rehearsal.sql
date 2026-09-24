-- Local isolated Supabase only. Four real stock postings and all fixture rows roll back.
begin;
do $$
declare
  v_user uuid:=gen_random_uuid(); v_company uuid; v_bu uuid; v_loc uuid;
  v_warehouse uuid; v_godown uuid; v_item uuid; v_supplier uuid; v_customer uuid;
  v_code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_context text; v_taxed boolean; v_rate numeric; v_id uuid; v_result jsonb;
  v_bad boolean; v_expected numeric;
begin
  insert into auth.users(id,role,email,created_at,updated_at)
  values(v_user,'authenticated','tax-consolidated-'||v_code||'@navilo.test',now(),now());
  insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
  values(v_user,v_user,'tax-consolidated-'||v_code||'@navilo.test','admin','user',true);
  insert into public.companies(name,code,status) values('Consolidated tax rehearsal','TC'||v_code,'active') returning id into v_company;
  select id into strict v_bu from public.business_units where company_id=v_company and is_default;
  insert into public.company_memberships(company_id,user_id,role,is_active)
  values(v_company,v_user,'company_owner',true);
  insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
  values(v_company,v_bu,v_user,'company_owner',true)
  on conflict(business_unit_id,user_id) do update set role='company_owner',is_active=true;
  insert into public.business_unit_modules(business_unit_id,company_id,module_key,enabled)
  select v_bu,v_company,module_key,true from
    (values ('sales'),('purchase'),('inventory'),('accounting'),('master'),('settings')) m(module_key)
  on conflict(business_unit_id,module_key) do update set enabled=true;
  insert into public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
  values(v_company,v_bu,'TC-BR','Tax rehearsal branch','branch',true) returning id into v_loc;
  insert into public.operating_location_memberships
    (company_id,business_unit_id,operating_location_id,user_id,role,is_active)
  values(v_company,v_bu,v_loc,v_user,'company_owner',true);
  update public.user_profiles set last_company_id=v_company,last_business_unit_id=v_bu where id=v_user;
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  insert into public.warehouses(company_id,name) values(v_company,'Consolidated tax warehouse') returning id into v_warehouse;
  insert into public.godowns(company_id,name,warehouse_id)
  values(v_company,'Consolidated tax godown',v_warehouse) returning id into v_godown;
  insert into public.items(user_id,company_id,sku,name,cost,price,warehouse_id)
  values(v_user,v_company,'TC-'||v_code,'Consolidated tax item',100,100,v_warehouse) returning id into v_item;
  insert into public.suppliers(user_id,company_id,name)
  values(v_user,v_company,'Consolidated tax supplier') returning id into v_supplier;
  insert into public.customers(user_id,company_id,name)
  values(v_user,v_company,'Consolidated tax customer') returning id into v_customer;
  insert into public.charge_master(user_id,company_id,charge_key,charge_name,applies_to,
    tax_applicable,is_active)
  values(v_user,v_company,'consolidated-'||v_code,'Consolidated taxable charge','both',true,true);
  insert into public.company_tax_events(company_id,effective_from,tax_mode)
  values(v_company,current_date,'non_tax');
  insert into public.company_tax_events(company_id,effective_from,tax_mode,authority_code)
  values(v_company,current_date+1,'tax_registered','REHEARSAL');
  insert into public.tax_rates(user_id,company_id,name,rate,applies_to,is_fixed,is_active,effective_from)
  values(v_user,v_company,'Consolidated 7%',7,'both',true,true,current_date+1),
    (v_user,v_company,'Consolidated 12%',12,'both',true,true,current_date+2);

  -- Both purchase postings bring in stock; both sales postings dispatch it.
  foreach v_context in array array['purchase','sales'] loop
    foreach v_taxed in array array[false,true] loop
      v_rate:=case when v_taxed then 7 else 0 end;
      v_expected:=case when v_taxed then 117.7 else 110 end;
      if v_context='purchase' then
        insert into public.consolidated_purchase_invoices(user_id,company_id,business_unit_id,
          invoice_no,invoice_date,supplier_id,invoice_type,tax_percent,subtotal,item_tax,
          charges_total,charge_tax,total,status)
        values(v_user,v_company,v_bu,'TC-P-'||v_code||case when v_taxed then '-T' else '-N' end,
          current_date+case when v_taxed then 1 else 0 end,v_supplier,
          case when v_taxed then 'Tax Invoice' else 'Purchase Invoice' end,v_rate,
          100,v_rate,10,v_rate/10,v_expected,'draft') returning id into v_id;
        insert into public.consolidated_purchase_invoice_lines(user_id,company_id,business_unit_id,
          invoice_id,item_id,godown_id,qty,unit_cost,line_total,tax_percent)
        values(v_user,v_company,v_bu,v_id,v_item,v_godown,1,100,100,v_rate);
      else
        insert into public.consolidated_sales_invoices(user_id,company_id,business_unit_id,
          invoice_no,invoice_date,customer_id,invoice_type,tax_percent,subtotal,item_tax,
          charges_total,charge_tax,total,status)
        values(v_user,v_company,v_bu,'TC-S-'||v_code||case when v_taxed then '-T' else '-N' end,
          current_date+case when v_taxed then 1 else 0 end,v_customer,
          case when v_taxed then 'Tax Invoice' else 'Sale Invoice' end,v_rate,
          100,v_rate,10,v_rate/10,v_expected,'draft') returning id into v_id;
        insert into public.consolidated_sales_invoice_lines(user_id,company_id,business_unit_id,
          invoice_id,item_id,godown_id,qty,unit_price,line_total,tax_percent)
        values(v_user,v_company,v_bu,v_id,v_item,v_godown,1,100,100,v_rate);
      end if;

      v_bad:=false;
      begin
        if v_context='purchase' then
          insert into public.consolidated_purchase_invoice_charges(user_id,company_id,business_unit_id,
            invoice_id,charge_key,amount,tax_percent)
          values(v_user,v_company,v_bu,v_id,'consolidated-'||v_code,10,case when v_taxed then 12 else 7 end);
        else
          insert into public.consolidated_sales_invoice_charges(user_id,company_id,business_unit_id,
            invoice_id,charge_key,amount,tax_percent)
          values(v_user,v_company,v_bu,v_id,'consolidated-'||v_code,10,case when v_taxed then 12 else 7 end);
        end if;
      exception when raise_exception then
        if position('Consolidated invoice' in sqlerrm)=0 and
           position('Non-tax invoices' in sqlerrm)=0 then raise; end if;
        v_bad:=true;
      end;
      if not v_bad then raise exception '% consolidated charge accepted a wrong tax rate',v_context; end if;
      if v_context='purchase' then
        insert into public.consolidated_purchase_invoice_charges(user_id,company_id,business_unit_id,
          invoice_id,charge_key,amount,tax_percent)
        values(v_user,v_company,v_bu,v_id,'consolidated-'||v_code,10,v_rate);
        v_result:=public.post_consolidated_purchase_invoice(v_id);
      else
        insert into public.consolidated_sales_invoice_charges(user_id,company_id,business_unit_id,
          invoice_id,charge_key,amount,tax_percent)
        values(v_user,v_company,v_bu,v_id,'consolidated-'||v_code,10,v_rate);
        if v_taxed then
          update public.consolidated_sales_invoices set item_tax=0 where id=v_id;
          v_bad:=false;
          begin
            perform public.post_consolidated_sales_invoice(v_id);
          exception when raise_exception then
            if position('totals must match saved lines and charges' in sqlerrm)=0 then raise; end if;
            v_bad:=true;
          end;
          if not v_bad then raise exception 'Sales posting accepted a stale item VAT total'; end if;
          update public.consolidated_sales_invoices set item_tax=v_rate where id=v_id;
        end if;
        v_result:=public.post_consolidated_sales_invoice(v_id);
      end if;
      if (v_result->>'total')::numeric<>v_expected then
        raise exception '% consolidated total mismatch: %',v_context,v_result;
      end if;
      if v_context='sales' then
        if not exists(select 1 from public.consolidated_sales_invoices where id=v_id and status='posted'
          and tax_percent=v_rate and item_tax=v_rate and charge_tax=v_rate/10 and total=v_expected) then
          raise exception 'Sales consolidated tax snapshot or totals changed';
        end if;
      elsif not exists(select 1 from public.consolidated_purchase_invoices where id=v_id and status='posted'
        and tax_percent=v_rate and item_tax=v_rate and charge_tax=v_rate/10 and total=v_expected) then
        raise exception 'Purchase consolidated tax snapshot or totals changed';
      end if;
    end loop;
  end loop;
  if public.fixed_tax_rate_on(v_company,'sales',current_date+2)<>12 or
     (select count(*) from public.consolidated_sales_invoices
      where company_id=v_company and status='posted' and
       ((invoice_date=current_date and tax_percent=0) or
        (invoice_date=current_date+1 and tax_percent=7)))<>2 or
     (select count(*) from public.consolidated_purchase_invoices
      where company_id=v_company and status='posted' and
       ((invoice_date=current_date and tax_percent=0) or
        (invoice_date=current_date+1 and tax_percent=7)))<>2 then
    raise exception 'Consolidated historical tax snapshots changed after later effective rate';
  end if;
  raise notice 'PASS: consolidated sales/purchase charges and item tax respect dated snapshots';
end $$;
rollback;
