-- Preserve canonical financial formulas, filtered totals and invoice filtering.
-- Ordinary pages need native invoice labels only for their selected Trip IDs.
do $migration$
declare
 definition text:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 old_page text:=$old$from chosen join register_source fr on fr.id=chosen.id$old$;
 new_page text:=$new$from chosen join register_source fr on fr.id=chosen.id
 left join lateral (
   select s.order_no
   from public.transport_customer_document_trips l
   join public.transport_customer_documents d on d.id=l.document_id
   join public.sales_orders s on s.id=d.sales_order_id
   where cv and not needs_invoice_cells and l.trip_id=chosen.id and not l.is_adjustment
   order by l.id limit 1
 ) ci_page on true
 left join lateral (
   select string_agg(distinct p.order_no, ', ' order by p.order_no) order_nos
   from public.transport_trip_supplier_rents r
   join public.transport_supplier_document_rents l on l.rent_id=r.id and not l.is_adjustment
   join public.transport_supplier_documents d on d.id=l.document_id
   join public.purchase_orders p on p.id=d.purchase_order_id
   join public.transport_active_journals j on j.id=d.journal_entry_id
   where sv and not needs_invoice_cells and r.trip_id=chosen.id
     and r.company_id=c and r.business_unit_id=b
 ) si_page on true$new$;
begin
 if position('needs_invoice_cells' in definition)>0 then
   raise notice 'Page invoice projection already installed'; return;
 end if;
 if position(old_page in definition)=0
 or position('where cv and not l.is_adjustment' in definition)=0
 or position('where sv and r.company_id=c and r.business_unit_id=b' in definition)=0
 or position('case when cv then nullif(chosen.invoice_no,'''') end' in definition)=0
 or position('case when sv then nullif(chosen.supplier_invoice_no,'''') end' in definition)=0
 then raise exception 'Register invoice projection changed; review before applying'; end if;
 definition:=replace(definition,'needs_text_cells boolean;', 'needs_text_cells boolean;needs_invoice_cells boolean;');
 definition:=replace(definition,' with register_source as materialized (',$assign$
 needs_invoice_cells:=coalesce(p_filters->>'snapshot','false')='true'
   or coalesce(p_option_key,'')=any(array['invoice_no','supplier_invoice_no'])
   or coalesce(p_sort,'')=any(array['invoice_no','supplier_invoice_no'])
   or btrim(coalesce(p_filters->>'search',''))<>''
   or coalesce(p_filters->'columns','{}'::jsonb) ?| array['invoice_no','supplier_invoice_no'];
 with register_source as materialized ($assign$);
 definition:=replace(definition,'where cv and not l.is_adjustment','where cv and needs_invoice_cells and not l.is_adjustment');
 definition:=replace(definition,'where sv and r.company_id=c and r.business_unit_id=b','where sv and needs_invoice_cells and r.company_id=c and r.business_unit_id=b');
 definition:=replace(definition,old_page,new_page);
 definition:=replace(definition,'case when cv then nullif(chosen.invoice_no,'''') end',
   'case when cv then nullif(coalesce(ci_page.order_no,chosen.invoice_no),'''') end');
 definition:=replace(definition,'case when sv then nullif(chosen.supplier_invoice_no,'''') end',
   'case when sv then nullif(coalesce(si_page.order_nos,chosen.supplier_invoice_no),'''') end');
 execute definition;
end $migration$;
notify pgrst,'reload schema';
