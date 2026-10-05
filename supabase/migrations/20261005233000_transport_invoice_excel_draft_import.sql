-- Canonical Transport customer invoice Excel import: draft only.
-- One existing Sales Invoice module remains authoritative. Import validates Trip + Vehicle
-- and creates service Sales drafts without posting AR/VAT journals.
create or replace function public.transport_import_customer_invoice_draft(
  p_invoice_no text,
  p_invoice_date date,
  p_customer_id uuid,
  p_with_tax boolean,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  loc uuid:=public.current_operating_location_id();
  u uuid:=auth.uid();
  base text;
  tax numeric;
  oid uuid;
  x jsonb;
  t public.transport_trips%rowtype;
  vehicle_no text;
  supplied_vehicle text;
  amount numeric;
  imported_count integer:=0;
begin
  perform public.assert_module_permission('sales','create');
  perform public.transport_finance_assert('billing');
  if nullif(btrim(p_invoice_no),'') is null or p_invoice_date is null or p_customer_id is null then
    raise exception 'Invoice No, Invoice Date and Customer are required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows)=0 then
    raise exception 'At least one invoice Trip row is required';
  end if;
  if not exists(select 1 from public.customers where id=p_customer_id and company_id=c) then
    raise exception 'Customer outside current company';
  end if;
  if exists(select 1 from public.sales_orders where company_id=c and business_unit_id=b and lower(btrim(order_no))=lower(btrim(p_invoice_no))) then
    raise exception 'Invoice No % already exists in current business unit',p_invoice_no;
  end if;
  select base_currency_code into base from public.companies where id=c;
  tax:=case when p_with_tax then public.fixed_tax_rate_on(c,'sales',p_invoice_date) else 0 end;
  if tax is null then raise exception 'Effective fixed VAT rate required'; end if;

  insert into public.sales_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,
    order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,payment_mode,created_by)
  values(coalesce(u,public.legacy_data_user_id()),c,b,loc,btrim(p_invoice_no),p_customer_id,p_invoice_date,'draft',
    case when p_with_tax then 'Tax Invoice' else 'Sale Invoice' end,tax,base,1,'service','Credit',u)
  returning id into oid;

  for x in select value from jsonb_array_elements(p_rows)
  loop
    if nullif(btrim(x->>'trip_no'),'') is null then raise exception 'Trip No is required'; end if;
    amount:=nullif(x->>'amount','')::numeric;
    if coalesce(amount,0)<=0 then raise exception 'Positive Amount required for Trip %',x->>'trip_no'; end if;

    select * into t from public.transport_trips
    where company_id=c and business_unit_id=b and lower(btrim(trip_no))=lower(btrim(x->>'trip_no'))
    for update;
    if not found then raise exception 'Trip % not found in current workspace',x->>'trip_no'; end if;
    if t.customer_id is distinct from p_customer_id then raise exception 'Trip % Customer does not match invoice Customer',t.trip_no; end if;
    if t.sales_order_id is not null or exists(select 1 from public.sales_service_lines where source_module='transport_trip' and source_id=t.id) then
      raise exception 'Trip % is already linked to a Sales Invoice',t.trip_no;
    end if;

    select v.vehicle_no into vehicle_no from public.transport_vehicles v
    where v.id=t.vehicle_id and v.company_id=c and v.business_unit_id=b;
    supplied_vehicle:=nullif(btrim(x->>'vehicle_no'),'');
    if supplied_vehicle is null then raise exception 'Vehicle No is required for Trip %',t.trip_no; end if;
    if vehicle_no is null or lower(btrim(vehicle_no))<>lower(supplied_vehicle) then
      raise exception 'Vehicle No % does not match Trip % vehicle %',supplied_vehicle,t.trip_no,coalesce(vehicle_no,'(blank)');
    end if;

    insert into public.sales_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,source_module,source_id,created_by)
    values(c,b,oid,coalesce(nullif(btrim(x->>'description'),''),public.transport_trip_service_description(t.id)),round(amount,2),tax,'transport_trip',t.id,u);
    update public.transport_trips set sales_order_id=oid,source_invoice_no=btrim(p_invoice_no),updated_by=u,updated_at=now() where id=t.id;
    imported_count:=imported_count+1;
  end loop;

  return jsonb_build_object('document_id',oid,'invoice_no',btrim(p_invoice_no),'status','draft','trip_count',imported_count);
exception when others then
  raise;
end $$;
revoke all on function public.transport_import_customer_invoice_draft(text,date,uuid,boolean,jsonb) from public,anon;
grant execute on function public.transport_import_customer_invoice_draft(text,date,uuid,boolean,jsonb) to authenticated;
