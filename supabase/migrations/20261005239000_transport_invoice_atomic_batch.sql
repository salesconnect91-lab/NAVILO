-- Atomic whole-file Transport Sales invoice import.
create or replace function public.transport_import_customer_invoice_batch(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; g record; cid uuid; result jsonb; invoices integer:=0; trips integer:=0;
begin
 perform public.assert_module_permission('sales','create'); perform public.transport_finance_assert('billing');
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'Invoice rows are required'; end if;
 if jsonb_array_length(p_rows)>500 then raise exception 'Maximum 500 invoice rows per file'; end if;
 if exists(select 1 from (select lower(btrim(x->>'trip_no')) k,count(*) n from jsonb_array_elements(p_rows) x group by 1 having count(*)>1) d) then raise exception 'A Trip No appears more than once in the invoice file'; end if;
 for g in
  select lower(btrim(x->>'invoice_no')) ino,min(btrim(x->>'invoice_no')) invoice_no,min((x->>'invoice_date')::date) invoice_date,
         lower(btrim(x->>'customer')) customer_name,(x->>'vat')::boolean vat,jsonb_agg(jsonb_build_object('trip_no',x->>'trip_no','vehicle_no',x->>'vehicle_no','amount',x->>'amount','description',x->>'description')) rows,
         count(distinct x->>'invoice_date') dc,count(distinct lower(btrim(x->>'customer'))) cc,count(distinct x->>'vat') vc
  from jsonb_array_elements(p_rows) x group by lower(btrim(x->>'invoice_no')),lower(btrim(x->>'customer')),(x->>'vat')::boolean
 loop
  if g.dc<>1 or g.cc<>1 or g.vc<>1 then raise exception 'Invoice % has inconsistent Date, Customer or VAT',g.invoice_no; end if;
  select c.id into cid from public.customers c where c.company_id=public.current_company_id() and lower(btrim(c.name))=g.customer_name limit 1;
  if cid is null then raise exception 'Customer not found: %',g.customer_name; end if;
  result:=public.transport_import_customer_invoice_draft(g.invoice_no,g.invoice_date,cid,g.vat,g.rows);
  invoices:=invoices+1; trips:=trips+coalesce((result->>'trip_count')::integer,0);
 end loop;
 return jsonb_build_object('success',true,'invoices',invoices,'trip_rows',trips);
end$$;
revoke all on function public.transport_import_customer_invoice_batch(jsonb) from public;
grant execute on function public.transport_import_customer_invoice_batch(jsonb) to authenticated;
