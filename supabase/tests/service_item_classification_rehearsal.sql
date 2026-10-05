-- Non-stock Service item classification regression.
begin;
do $$
declare
  c uuid;
  v_service uuid;
begin
  insert into public.companies(name,code,status)
  values('Service Item Test','SIT_'||substr(replace(gen_random_uuid()::text,'-',''),1,8),'active')
  returning id into c;

  insert into public.items(company_id,sku,name,type,grade,size,cost,price,is_stock_item)
  values(c,'SVC-TEST','Transport Freight','service','SHOULD CLEAR','SHOULD CLEAR',0,0,true)
  returning id into v_service;

  if not exists(
    select 1 from public.items
    where id=v_service and type='service' and is_stock_item=false
      and grade is null and size is null and warehouse_id is null and weight_per_piece is null
  ) then
    raise exception 'Service classification did not enforce non-stock semantics';
  end if;

  if exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='items'
      and column_name in ('revenue_account_id','expense_account_id','sales_account_id','purchase_account_id')
  ) then
    raise exception 'Service classification unexpectedly introduced item-level account mapping';
  end if;

  raise notice 'PASS: Service item is non-stock and no item-level COA mapping was introduced';
end $$;
rollback;
