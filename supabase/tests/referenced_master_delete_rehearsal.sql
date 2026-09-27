-- Isolated local Supabase only. All fixture rows roll back.
\set ON_ERROR_STOP on
begin;
do $test$
declare
  v_user uuid := gen_random_uuid();
  v_company uuid;
  v_other_company uuid;
  v_bu uuid;
  v_location uuid;
  v_customer uuid;
  v_supplier uuid;
  v_item uuid;
  v_warehouse uuid;
  v_godown uuid;
  v_account uuid;
  v_charge uuid;
  v_unused uuid;
  v_order uuid;
  v_purchase uuid;
  v_code text := substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_before integer;
  v_after integer;
  v_table text;
  v_id uuid;
begin
  -- The catalog check covers all historical FK paths, including ones that
  -- cannot be exercised by a single small fixture.
  if exists (
    select 1 from pg_constraint c join pg_class p on p.oid=c.confrelid
    join pg_namespace n on n.oid=p.relnamespace
    where c.contype='f' and n.nspname='public'
      and p.relname=any(array['customers','suppliers','items','categories','uom',
        'warehouses','godowns','transporters','employees','charge_master',
        'chart_of_accounts','business_units','branches','operating_locations','service_parties','tax_rates'])
      and c.confdeltype in ('c','n','d')
  ) then raise exception 'Master FK still permits cascade/set-null/set-default'; end if;

  insert into auth.users(id,role,email,created_at,updated_at)
    values(v_user,'authenticated','delete-guard-'||v_code||'@navilo.test',now(),now());
  insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
    values(v_user,v_user,'delete-guard-'||v_code||'@navilo.test','admin','user',true);
  insert into public.companies(name,code,status)
    values('Delete guard rehearsal','DG'||v_code,'active') returning id into v_company;
  insert into public.companies(name,code,status)
    values('Delete guard second tenant','DO'||v_code,'active') returning id into v_other_company;
  select id into strict v_bu from public.business_units where company_id=v_company and is_default;
  insert into public.company_memberships(company_id,user_id,role,is_active)
    values(v_company,v_user,'company_owner',true);
  insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
    values(v_company,v_bu,v_user,'company_owner',true)
    on conflict(business_unit_id,user_id) do update set role='company_owner',is_active=true;
  update public.user_profiles set last_company_id=v_company,last_business_unit_id=v_bu where id=v_user;

  insert into public.operating_locations(company_id,business_unit_id,code,name,is_active)
    values(v_company,v_bu,'DG-'||v_code,'Delete guard location',true)
    returning id into v_location;
  insert into public.operating_location_memberships(company_id,business_unit_id,operating_location_id,user_id,role,is_active)
    values(v_company,v_bu,v_location,v_user,'company_owner',true);
  update public.user_profiles set locked_operating_location_id=v_location where id=v_user;
  perform set_config('request.jwt.claim.sub',v_user::text,true);

  insert into public.customers(user_id,company_id,name)
    values(v_user,v_company,'Referenced customer') returning id into v_customer;
  insert into public.suppliers(user_id,company_id,name)
    values(v_user,v_company,'Referenced supplier') returning id into v_supplier;
  insert into public.warehouses(company_id,name)
    values(v_company,'Referenced warehouse') returning id into v_warehouse;
  insert into public.godowns(company_id,name,warehouse_id)
    values(v_company,'Referenced godown',v_warehouse) returning id into v_godown;
  insert into public.items(user_id,company_id,sku,name,cost,price,warehouse_id)
    values(v_user,v_company,'DG-'||v_code,'Referenced item',1,2,v_warehouse)
    returning id into v_item;
  insert into public.chart_of_accounts(user_id,company_id,code,name,type)
    values(v_user,v_company,'DG'||v_code,'Referenced account','asset') returning id into v_account;
  update public.customers set account_id=v_account where id=v_customer;
  insert into public.charge_master(user_id,company_id,charge_key,charge_name,applies_to,is_active)
    values(v_user,v_company,'dg-'||v_code,'Referenced charge','sales',true) returning id into v_charge;

  alter table public.sales_orders disable trigger trg_assign_sales_order_number;
  insert into public.sales_orders(user_id,company_id,business_unit_id,order_no,customer_id,status)
    values(v_user,v_company,v_bu,'DG-S-'||v_code,v_customer,'draft') returning id into v_order;
  alter table public.sales_orders enable trigger trg_assign_sales_order_number;
  insert into public.sales_order_lines(user_id,company_id,business_unit_id,order_id,item_id,godown_id,qty,unit_price)
    values(v_user,v_company,v_bu,v_order,v_item,v_godown,1,2);
  insert into public.purchase_orders(user_id,company_id,business_unit_id,order_no,supplier_id,status)
    values(v_user,v_company,v_bu,'DG-P-'||v_code,v_supplier,'draft') returning id into v_purchase;
  insert into public.sales_order_charges(user_id,company_id,business_unit_id,order_id,charge_key,charge_label,amount)
    values(v_user,v_company,v_bu,v_order,'dg-'||v_code,'Referenced charge',1);

  select count(*) into v_before from public.sales_orders where id=v_order;
  for v_table,v_id in select * from (values
    ('customers',v_customer),('suppliers',v_supplier),('items',v_item),
    ('warehouses',v_warehouse),('godowns',v_godown),
    ('chart_of_accounts',v_account),('charge_master',v_charge),
    ('business_units',v_bu)) x(t,id)
  loop
    begin
      execute format('delete from public.%I where id=$1',v_table) using v_id;
      raise exception 'Delete unexpectedly succeeded for %',v_table;
    exception
      when foreign_key_violation then null;
      when raise_exception then
        if SQLERRM like 'Delete unexpectedly succeeded for %' then
          raise;
        end if;
    end;
  end loop;
  select count(*) into v_after from public.sales_orders where id=v_order;
  if v_before<>v_after or v_after<>1 then raise exception 'Historical order changed'; end if;
  update public.customers set is_active=false where id=v_customer;
  if not exists (select 1 from public.sales_orders where id=v_order and customer_id=v_customer)
    then raise exception 'Deactivation lost customer history'; end if;

  insert into public.customers(user_id,company_id,name)
    values(v_user,v_company,'Unused customer') returning id into v_unused;
  delete from public.customers where id=v_unused;
  if exists(select 1 from public.customers where id=v_unused)
    then raise exception 'Unused customer remained'; end if;
  if exists(select 1 from public.customers where company_id=v_other_company and id=v_customer)
    then raise exception 'Cross-company customer visibility leaked'; end if;
  raise notice 'PASS: referenced masters blocked, unused master deleted, history retained';
end $test$;
rollback;
