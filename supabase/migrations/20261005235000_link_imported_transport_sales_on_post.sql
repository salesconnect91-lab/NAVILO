-- Link imported Transport service Sales invoices to Transport reporting after canonical posting.
-- No journal is created here; the canonical Sales posting journal remains the only accounting entry.
create or replace function public.transport_link_imported_sales_on_post()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare d uuid;j uuid;l record;
begin
 if new.status<>'posted' or old.status='posted' or new.document_kind<>'service' then return new; end if;
 if not exists(select 1 from public.sales_service_lines x where x.order_id=new.id and x.source_module='transport_trip' and x.source_id is not null) then return new; end if;
 select id into j from public.journal_entries
 where company_id=new.company_id and business_unit_id=new.business_unit_id and source_document_id=new.id
   and status='posted'
 order by created_at desc limit 1;
 if j is null then raise exception 'Posted Transport Sales invoice % has no canonical journal evidence',new.order_no; end if;
 insert into public.transport_customer_documents(company_id,business_unit_id,operating_location_id,customer_id,sales_order_id,paid_amount,created_by,document_kind,journal_entry_id)
 values(new.company_id,new.business_unit_id,new.operating_location_id,new.customer_id,new.id,0,coalesce(new.posted_by,new.created_by),'credit',j)
 on conflict(sales_order_id) do update set journal_entry_id=excluded.journal_entry_id
 returning id into d;
 for l in select x.source_id trip_id,x.amount,x.tax_percent from public.sales_service_lines x where x.order_id=new.id and x.source_module='transport_trip' and x.source_id is not null loop
   insert into public.transport_customer_document_trips(company_id,business_unit_id,operating_location_id,document_id,trip_id,rate_snapshot,vat_snapshot,is_adjustment)
   values(new.company_id,new.business_unit_id,new.operating_location_id,d,l.trip_id,l.amount,round(l.amount*coalesce(l.tax_percent,0)/100,2),false)
   on conflict(document_id,trip_id) do nothing;
 end loop;
 return new;
end $$;
drop trigger if exists zzzz_link_imported_transport_sales_on_post on public.sales_orders;
create trigger zzzz_link_imported_transport_sales_on_post after update of status on public.sales_orders
for each row when (new.status='posted' and old.status is distinct from new.status)
execute function public.transport_link_imported_sales_on_post();
