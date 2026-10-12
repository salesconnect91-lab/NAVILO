-- Retain the existing page-first reader for entirely native-unposted books.
-- Read linked IDs from the already joined payment projection once, and keep
-- its status/nullable fields consistent with the filtered authoritative reader.
begin;
do $page$
declare d text;
begin
 d:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 if position('opening_read boolean' in d)=0 or position('hp.payment_date historical_payment_date,' in d)=0 then raise exception 'Unexpected linked Register page body';end if;
 d:=replace(d,'if not opening_read and cv and sv and p_option_key is null','if cv and sv and p_option_key is null');
 d:=replace(d,' -- Unposted operational filter values',E' if opening_read then perform set_config(''work_mem'',''64MB'',true);end if;\n -- Unposted operational filter values');
 d:=replace(d,'hp.payment_date historical_payment_date,','hp.payment_date historical_payment_date,hp.opening_customer_document_id,hp.opening_supplier_document_id,');
 d:=replace(d,'case when (cv and coalesce(t.customer_rate_state,''pending'')=''finalized'')',
 $status$case when hp.opening_customer_document_id is not null and hp.opening_supplier_document_id is not null and coalesce(t.owner_rent,0)>0 and coalesce(a.n,0)=0
  then case when coalesce(hp.customer_remaining_effective,0)<=0.005 and coalesce(hp.supplier_remaining_effective,0)<=0.005 then 'settled' else 'locked' end
  when (cv and coalesce(t.customer_rate_state,'pending')='finalized')$status$);
 d:=replace(d,'exists(select 1 from public.transport_opening_invoice_lines ol where ol.trip_id=t.id and ol.side=''customer'')','x.opening_customer_document_id is not null');
 d:=replace(d,'exists(select 1 from public.transport_opening_invoice_lines ol where ol.trip_id=t.id and ol.side=''supplier'')','x.opening_supplier_document_id is not null');
 d:=replace(d,'(select ol.document_id from public.transport_opening_invoice_lines ol where ol.trip_id=t.id and ol.side=''customer'')','x.opening_customer_document_id');
 d:=replace(d,'(select ol.document_id from public.transport_opening_invoice_lines ol where ol.trip_id=t.id and ol.side=''supplier'')','x.opening_supplier_document_id');
 d:=replace(d,'''remaining_with_us'',x.historical_supplier_remaining,','''remaining_with_us'',null,');
 execute d;
end $page$;
notify pgrst,'reload schema';
commit;
