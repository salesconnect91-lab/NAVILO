-- Optional description is captured atomically before canonical invoice posting.
-- Existing posting RPCs and immutable historical service lines remain unchanged.
create or replace function public.transport_post_customer_bill_described(p_trip_id uuid,p_date date,p_with_tax boolean default false,p_invoice_no text default null,p_description text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;r jsonb;d uuid;
begin
 if length(coalesce(p_description,''))>2000 then raise exception 'Invoice description must be at most 2000 characters';end if;
 perform public.transport_finance_assert('billing');t:=public.transport_financial_trip(p_trip_id);
 if t.sales_order_id is not null then raise exception 'Trip already references a canonical Sales document; reconcile its existing posted linkage before billing';end if;
 if t.sale_type is null or t.customer_id is null or t.customer_rate<=0
 or exists(select 1 from public.transport_customer_document_trips where trip_id=t.id and not is_adjustment)
 then raise exception 'Unbilled Trip, Cash/Credit classification, customer and positive finalized rate required'; end if;
 r:=public.transport_create_numbered_service_document('customer',t.customer_id,p_date,t.customer_rate,p_with_tax,null,
 concat_ws(E'\n',nullif(btrim(p_description),''),public.transport_trip_service_description(t.id)),null,p_invoice_no);
 insert into public.transport_customer_documents(company_id,business_unit_id,operating_location_id,customer_id,document_kind,sales_order_id,journal_entry_id,created_by)
 values(t.company_id,t.business_unit_id,public.current_operating_location_id(),t.customer_id,
 case when t.sale_type='cash' then 'cash_hand_bill' else 'credit' end,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_customer_document_trips(company_id,business_unit_id,document_id,trip_id,rate_snapshot,vat_snapshot)
 values(t.company_id,t.business_unit_id,d,t.id,t.customer_rate,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'customer_bill_posted',r||jsonb_build_object('transport_document_id',d,'sale_type',t.sale_type));
 return r||jsonb_build_object('transport_document_id',d);
end $$;
revoke all on function public.transport_post_customer_bill_described(uuid,date,boolean,text,text) from public,anon;
grant execute on function public.transport_post_customer_bill_described(uuid,date,boolean,text,text) to authenticated;
create or replace function public.transport_post_supplier_bill_described(p_rent_id uuid,p_date date,p_cost_account_id uuid,p_with_tax boolean default false,p_reference text default null,p_invoice_no text default null,p_description text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare x public.transport_trip_supplier_rents%rowtype;t public.transport_trips%rowtype;r jsonb;d uuid;
begin
 if length(coalesce(p_description,''))>2000 then raise exception 'Invoice description must be at most 2000 characters';end if;
 perform public.transport_finance_assert('rent');
 select * into x from public.transport_trip_supplier_rents where id=p_rent_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Finalized supplier rent required'; end if;t:=public.transport_financial_trip(x.trip_id);
 if exists(select 1 from public.transport_supplier_document_rents where rent_id=x.id and not is_adjustment) then raise exception 'Supplier rent already billed'; end if;
 r:=public.transport_create_numbered_service_document('supplier',x.supplier_id,p_date,x.amount,p_with_tax,p_cost_account_id,concat_ws(E'\n',nullif(btrim(p_description),''),public.transport_trip_service_description(t.id)||' · Supplier rent'),p_reference,p_invoice_no);
 insert into public.transport_supplier_documents(company_id,business_unit_id,operating_location_id,supplier_id,purchase_order_id,journal_entry_id,created_by)
 values(x.company_id,x.business_unit_id,public.current_operating_location_id(),x.supplier_id,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_supplier_document_rents(company_id,business_unit_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot)
 values(x.company_id,x.business_unit_id,d,x.id,t.id,x.amount,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'supplier_bill_posted',r||jsonb_build_object('rent_id',x.id,'transport_document_id',d));return r;
end $$;
revoke all on function public.transport_post_supplier_bill_described(uuid,date,uuid,boolean,text,text,text) from public,anon;
grant execute on function public.transport_post_supplier_bill_described(uuid,date,uuid,boolean,text,text,text) to authenticated;
