-- Require and stamp durable source identity during atomic Transport invoice import.
create or replace function public.transport_import_customer_invoice_batch(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g record; cid uuid; result jsonb; invoices integer:=0; trips integer:=0; oid uuid;
begin
 perform public.assert_module_permission('sales','create'); perform public.transport_finance_assert('billing');
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'Invoice rows are required'; end if;
 if jsonb_array_length(p_rows)>500 then raise exception 'Maximum 500 invoice rows per file'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x where nullif(btrim(x->>'source_company'),'') is null or nullif(btrim(x->>'source_invoice_id'),'') is null) then raise exception 'Source Company and Source Invoice ID are required for every invoice row'; end if;
 if exists(select 1 from (select lower(btrim(x->>'trip_no')) k,count(*) n from jsonb_array_elements(p_rows) x group by 1 having count(*)>1) d) then raise exception 'A Trip No appears more than once in the invoice file'; end if;
 for g in
  select lower(btrim(x->>'source_company')) source_company,lower(btrim(x->>'source_invoice_id')) source_invoice_id,
         min(btrim(x->>'invoice_no')) invoice_no,min((x->>'invoice_date')::date) invoice_date,lower(btrim(x->>'customer')) customer_name,(x->>'vat')::boolean vat,
         jsonb_agg(jsonb_build_object('trip_no',x->>'trip_no','vehicle_no',x->>'vehicle_no','amount',x->>'amount','description',x->>'description')) rows,
         count(distinct lower(btrim(x->>'invoice_no'))) nc,count(distinct x->>'invoice_date') dc,count(distinct lower(btrim(x->>'customer'))) cc,count(distinct x->>'vat') vc
  from jsonb_array_elements(p_rows) x group by lower(btrim(x->>'source_company')),lower(btrim(x->>'source_invoice_id')),(x->>'vat')::boolean
 loop
  if g.nc<>1 or g.dc<>1 or g.cc<>1 or g.vc<>1 then raise exception 'Source invoice %/% has inconsistent Invoice No, Date, Customer or VAT',g.source_company,g.source_invoice_id; end if;
  if exists(select 1 from public.sales_orders s where s.company_id=public.current_company_id() and s.business_unit_id=public.current_business_unit_id() and lower(btrim(s.transport_source_company))=g.source_company and lower(btrim(s.transport_source_invoice_id))=g.source_invoice_id) then raise exception 'Source invoice %/% already imported',g.source_company,g.source_invoice_id; end if;
  select c.id into cid from public.customers c where c.company_id=public.current_company_id() and lower(btrim(c.name))=g.customer_name limit 1;
  if cid is null then raise exception 'Customer not found: %',g.customer_name; end if;
  result:=public.transport_import_customer_invoice_draft(g.invoice_no,g.invoice_date,cid,g.vat,g.rows); oid:=(result->>'document_id')::uuid;
  update public.sales_orders set transport_source_company=g.source_company,transport_source_invoice_id=g.source_invoice_id where id=oid;
  invoices:=invoices+1; trips:=trips+coalesce((result->>'trip_count')::integer,0);
 end loop;
 return jsonb_build_object('success',true,'invoices',invoices,'trip_rows',trips);
end$$;
