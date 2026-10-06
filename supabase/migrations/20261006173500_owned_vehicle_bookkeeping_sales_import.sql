-- Bookkeeping-mode owned-vehicle Sales import.
-- Creates canonical draft Sales service invoices without Transport Trips and attributes posted revenue to the vehicle.
create or replace function public.transport_preview_owned_vehicle_sales_batch(p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); x jsonb; out_rows jsonb:='[]'::jsonb; cid uuid; vid uuid; reason text; st text;
begin
 perform public.assert_module_permission('sales','create');
 if c is null or b is null then raise exception 'Active Company and Business Unit required'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Rows are required'; end if;
 if jsonb_array_length(p_rows)>500 then raise exception 'Maximum 500 rows per file'; end if;
 for x in select value from jsonb_array_elements(p_rows) loop
  reason:=null; st:='New'; cid:=null; vid:=null;
  if nullif(btrim(x->>'source_reference'),'') is null or nullif(btrim(x->>'invoice_no'),'') is null or nullif(btrim(x->>'invoice_date'),'') is null
     or nullif(btrim(x->>'customer'),'') is null or nullif(btrim(x->>'vehicle_no'),'') is null or coalesce(nullif(x->>'amount','')::numeric,0)<=0
  then st:='Error'; reason:='Source Reference, Invoice No, Date, Customer, Vehicle No and positive Amount are required';
  else
   select id into cid from public.customers where company_id=c and lower(btrim(name))=lower(btrim(x->>'customer')) limit 1;
   if cid is null then st:='Error'; reason:='Customer not found in current company'; end if;
   select id into vid from public.transport_vehicles
    where company_id=c and business_unit_id=b and lower(btrim(vehicle_no))=lower(btrim(x->>'vehicle_no'))
      and is_active is true limit 1;
   if st='New' and vid is null then st:='Error'; reason:='Active Vehicle not found in current Transport workspace'; end if;
   if st='New' and not exists(select 1 from public.transport_vehicles v where v.id=vid and lower(coalesce(v.ownership_type,v.owner_type,'')) in ('company','company_owned','owned','self'))
     then st:='Error'; reason:='Vehicle is not marked Company owned'; end if;
   if st='New' and exists(select 1 from public.sales_orders s where s.company_id=c and s.business_unit_id=b and
       (lower(btrim(s.transport_source_company))=lower(btrim(c::text)) and lower(btrim(s.transport_source_invoice_id))=lower(btrim(x->>'source_reference'))
        or lower(btrim(s.order_no))=lower(btrim(x->>'invoice_no'))))
     then st:='Duplicate'; reason:='Source Reference or Invoice No already exists'; end if;
  end if;
  out_rows:=out_rows||jsonb_build_array(x||jsonb_build_object('import_status',st,'import_reason',coalesce(reason,'')));
 end loop;
 return jsonb_build_object('rows',out_rows);
end$$;
revoke all on function public.transport_preview_owned_vehicle_sales_batch(jsonb) from public;
grant execute on function public.transport_preview_owned_vehicle_sales_batch(jsonb) to authenticated;

create or replace function public.transport_import_owned_vehicle_sales_batch(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id(); u uuid:=auth.uid(); base text;
 g record; cid uuid; oid uuid; vid uuid; tax numeric; invoices integer:=0; line_count integer:=0; x jsonb; amt numeric;
begin
 perform public.assert_module_permission('sales','create'); perform public.transport_finance_assert('billing');
 if c is null or b is null or loc is null then raise exception 'Active Company, Business Unit and branch required'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'Invoice rows are required'; end if;
 if jsonb_array_length(p_rows)>500 then raise exception 'Maximum 500 rows per file'; end if;
 if exists(select 1 from (select lower(btrim(x->>'source_reference')) k,count(*) from jsonb_array_elements(p_rows) x group by 1 having count(*)>1) d)
   then raise exception 'Source Reference appears more than once in the file'; end if;
 select base_currency_code into base from public.companies where id=c;
 for g in
  select lower(btrim(x->>'invoice_no')) ino,min(btrim(x->>'invoice_no')) invoice_no,min((x->>'invoice_date')::date) invoice_date,
         lower(btrim(x->>'customer')) customer_name,(x->>'vat')::boolean vat,
         count(distinct x->>'invoice_date') dc,count(distinct lower(btrim(x->>'customer'))) cc,count(distinct x->>'vat') vc,
         jsonb_agg(x) rows
  from jsonb_array_elements(p_rows) x
  group by lower(btrim(x->>'invoice_no')),lower(btrim(x->>'customer')),(x->>'vat')::boolean
 loop
  if g.dc<>1 or g.cc<>1 or g.vc<>1 then raise exception 'Invoice % has inconsistent Date, Customer or VAT',g.invoice_no; end if;
  if exists(select 1 from public.sales_orders where company_id=c and business_unit_id=b and lower(btrim(order_no))=g.ino) then raise exception 'Invoice No % already exists',g.invoice_no; end if;
  select id into cid from public.customers where company_id=c and lower(btrim(name))=g.customer_name limit 1;
  if cid is null then raise exception 'Customer not found: %',g.customer_name; end if;
  tax:=case when g.vat then public.fixed_tax_rate_on(c,'sales',g.invoice_date) else 0 end;
  if tax is null then raise exception 'Effective fixed VAT rate required'; end if;
  insert into public.sales_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,payment_mode,created_by,
    transport_source_company,transport_source_invoice_id)
  values(coalesce(u,public.legacy_data_user_id()),c,b,loc,g.invoice_no,cid,g.invoice_date,'draft',case when g.vat then 'Tax Invoice' else 'Sale Invoice' end,tax,base,1,'service','Credit',u,c::text,'owned-vehicle:'||g.ino)
  returning id into oid;
  for x in select value from jsonb_array_elements(g.rows) loop
   amt:=nullif(x->>'amount','')::numeric; if coalesce(amt,0)<=0 then raise exception 'Positive Amount required'; end if;
   if exists(select 1 from public.sales_orders s where s.company_id=c and s.business_unit_id=b and lower(btrim(s.transport_source_company))=lower(c::text)
      and lower(btrim(s.transport_source_invoice_id))=lower(btrim(x->>'source_reference'))) then raise exception 'Source Reference already imported: %',x->>'source_reference'; end if;
   select id into vid from public.transport_vehicles v where v.company_id=c and v.business_unit_id=b and v.is_active is true
      and lower(btrim(v.vehicle_no))=lower(btrim(x->>'vehicle_no')) limit 1;
   if vid is null then raise exception 'Active Vehicle not found: %',x->>'vehicle_no'; end if;
   if not exists(select 1 from public.transport_vehicles v where v.id=vid and lower(coalesce(v.ownership_type,v.owner_type,'')) in ('company','company_owned','owned','self'))
      then raise exception 'Vehicle % is not marked Company owned',x->>'vehicle_no'; end if;
   insert into public.sales_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,source_module,source_id,created_by)
   values(c,b,oid,coalesce(nullif(btrim(x->>'description'),''),'Transport service · Vehicle '||btrim(x->>'vehicle_no')),round(amt,2),tax,'transport_vehicle_bookkeeping',vid,u);
   line_count:=line_count+1;
  end loop;
  -- Keep invoice-level durable identity while line source references remain protected by unique invoice number + atomic file validation.
  update public.sales_orders set transport_source_invoice_id='owned-vehicle:'||g.ino where id=oid;
  invoices:=invoices+1;
 end loop;
 return jsonb_build_object('success',true,'invoices',invoices,'lines',line_count);
end$$;
revoke all on function public.transport_import_owned_vehicle_sales_batch(jsonb) from public;
grant execute on function public.transport_import_owned_vehicle_sales_batch(jsonb) to authenticated;

create or replace view public.transport_vehicle_bookkeeping_contributions as
select ('vehicle-bookkeeping:'||m.event_id||':'||l.id::text) event_id,
 m.company_id,m.business_unit_id,m.operating_location_id,null::uuid trip_id,''::text trip_no,
 v.id account_id,v.vehicle_no account_name,m.event_date,m.entry_no,m.event_type,'Revenue'::text category,''::text expense_accounts,
 case when m.event_type in ('credit_note','reversal_bill') then -l.amount
      when m.event_type in ('bill','reversal_credit_note') then l.amount else 0::numeric end revenue,
 0::numeric cost
from public.transport_party_movements m
join public.sales_service_lines l on m.side='customer' and l.order_id=m.order_id and l.source_module='transport_vehicle_bookkeeping'
join public.transport_vehicles v on v.id=l.source_id and v.company_id=m.company_id and v.business_unit_id=m.business_unit_id
where m.event_type in ('bill','credit_note','reversal_bill','reversal_credit_note');

create or replace function public.transport_account_report_page(p_kind text,p_limit integer default 1000,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if not (public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')) then raise exception 'Both Transport financial view permissions required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active Company/Business Unit/branch required';end if;
 if p_kind='driver' and not public.has_module_permission(c,'accounting','view') then raise exception 'Accounting view permission required for payroll detail';end if;
 if p_kind='driver' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select * from public.transport_driver_account_movements where company_id=c and business_unit_id=b and operating_location_id=loc order by event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 elsif p_kind='vehicle' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select * from public.transport_vehicle_account_movements where company_id=c and business_unit_id=b and operating_location_id=loc order by event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 elsif p_kind='contributions' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
    select * from (
      select * from public.transport_vehicle_contributions where company_id=c and business_unit_id=b and operating_location_id=loc and (category<>'Driver pay' or public.has_module_permission(c,'accounting','view'))
      union all
      select * from public.transport_vehicle_bookkeeping_contributions where company_id=c and business_unit_id=b and operating_location_id=loc
    ) z order by event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)
  ) q;
 else raise exception 'Invalid account report kind';end if;
 return answer;
end$$;
revoke all on function public.transport_account_report_page(text,integer,integer) from public;
grant execute on function public.transport_account_report_page(text,integer,integer) to authenticated;
