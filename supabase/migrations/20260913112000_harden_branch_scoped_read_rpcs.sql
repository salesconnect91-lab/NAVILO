create or replace function public.get_accounting_integrity_summary()
returns table(check_key text,status text,amount numeric,details jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_company uuid:=public.current_company_id(); v_bu uuid:=public.current_business_unit_id(); v_loc uuid:=public.current_operating_location_id();
begin
 if auth.uid() is null or v_company is null or v_bu is null or v_loc is null then raise exception 'Authentication, active company, business unit and branch are required.'; end if;
 if not public.has_module_permission(v_company,'accounting','view') then raise exception 'Accounting view permission required.'; end if;
 return query
 with posted as (
  select je.id,coalesce(sum(jl.debit),0) debit,coalesce(sum(jl.credit),0) credit
  from public.journal_entries je join public.journal_lines jl on jl.entry_id=je.id
  where je.company_id=v_company and je.business_unit_id=v_bu and je.operating_location_id=v_loc and jl.operating_location_id=v_loc and je.status='posted'
  group by je.id
 ), imbal as (select count(*) cnt,coalesce(sum(abs(debit-credit)),0) diff from posted where abs(debit-credit)>=0.01),
 stock as (select coalesce(sum(ws.quantity*coalesce(ic.avg_cost,0)),0) value from public.warehouse_stock ws left join public.inventory_costs ic on ic.company_id=ws.company_id and ic.business_unit_id=ws.business_unit_id and ic.item_id=ws.item_id where ws.company_id=v_company and ws.business_unit_id=v_bu and ws.operating_location_id=v_loc),
 orph as (select count(*) cnt from public.journal_entries je where je.company_id=v_company and je.business_unit_id=v_bu and je.operating_location_id=v_loc and je.status='posted' and not exists(select 1 from public.journal_lines jl where jl.entry_id=je.id and jl.operating_location_id=v_loc))
 select 'journal_balance',case when imbal.cnt=0 then 'ok' else 'error' end,imbal.diff,jsonb_build_object('unbalanced_entries',imbal.cnt) from imbal
 union all select 'orphan_posted_journals',case when orph.cnt=0 then 'ok' else 'error' end,orph.cnt::numeric,jsonb_build_object('count',orph.cnt) from orph
 union all select 'stock_valuation','info',stock.value,jsonb_build_object('note','Inventory valuation based on current average cost') from stock;
end $$;

create or replace function public.get_available_consolidated_purchase_invoices(p_supplier_id uuid,p_order_id uuid default null)
returns table(id uuid,invoice_no text,invoice_date date,reference_name text,reference_no text,total numeric,linked_purchase_order_id uuid,invoice_type text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_company uuid:=public.current_company_id(); v_bu uuid:=public.current_business_unit_id(); v_loc uuid:=public.current_operating_location_id();
begin
 if auth.uid() is null or v_company is null or v_bu is null or v_loc is null then raise exception 'Authentication, active company, business unit and branch are required.'; end if;
 if not public.has_module_permission(v_company,'purchase','view') then raise exception 'Purchase view permission required.'; end if;
 return query select h.id,h.invoice_no,h.invoice_date,h.reference_name,h.reference_no,h.total,l.purchase_order_id,h.invoice_type
 from public.consolidated_purchase_invoices h
 left join public.purchase_order_consolidated_invoices l on l.consolidated_invoice_id=h.id and l.company_id=v_company and l.business_unit_id=v_bu and l.operating_location_id=v_loc
 left join public.purchase_orders po on po.id=p_order_id and po.company_id=v_company and po.business_unit_id=v_bu and po.operating_location_id=v_loc
 where h.company_id=v_company and h.business_unit_id=v_bu and h.operating_location_id=v_loc and h.status='posted' and h.supplier_id=p_supplier_id
 and (p_order_id is null or po.id is not null) and (p_order_id is null or coalesce(h.invoice_type,'Purchase Invoice')=coalesce(po.invoice_type,'Purchase Invoice')) and (l.purchase_order_id is null or l.purchase_order_id=p_order_id)
 order by h.invoice_date,h.invoice_no;
end $$;

create or replace function public.get_available_consolidated_purchase_invoices_v2(p_supplier_id uuid default null,p_order_id uuid default null)
returns table(id uuid,invoice_no text,invoice_date date,supplier_id uuid,supplier_name text,reference_name text,reference_no text,reference_notes text,subtotal numeric,item_tax numeric,charges_total numeric,charge_tax numeric,total numeric,linked_purchase_order_id uuid,invoice_type text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare co uuid:=public.current_company_id(); bu uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id();
begin
 if auth.uid() is null or co is null or bu is null or loc is null then raise exception 'Authentication, active company, business unit and branch are required.'; end if;
 if not public.has_module_permission(co,'purchase','view') then raise exception 'Purchase view permission required.'; end if;
 return query select h.id,h.invoice_no,h.invoice_date,h.supplier_id,s.name,h.reference_name,h.reference_no,h.reference_notes,h.subtotal,h.item_tax,h.charges_total,h.charge_tax,h.total,l.purchase_order_id,h.invoice_type
 from public.consolidated_purchase_invoices h join public.suppliers s on s.id=h.supplier_id and s.company_id=co
 left join public.purchase_order_consolidated_invoices l on l.consolidated_invoice_id=h.id and l.company_id=co and l.business_unit_id=bu and l.operating_location_id=loc
 where h.company_id=co and h.business_unit_id=bu and h.operating_location_id=loc and h.status='posted' and (p_supplier_id is null or h.supplier_id=p_supplier_id) and (l.id is null or (p_order_id is not null and l.purchase_order_id=p_order_id))
 order by h.invoice_date desc,h.invoice_no desc;
end $$;

create or replace function public.get_available_hawala_invoices(p_customer_id uuid,p_order_id uuid default null)
returns table(id uuid,invoice_no text,invoice_date date,reference_name text,reference_no text,reference_notes text,subtotal numeric,item_tax numeric,charges_total numeric,charge_tax numeric,total numeric,linked_sales_order_id uuid)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_user uuid:=public.legacy_data_user_id(); v_company uuid:=public.current_company_id(); v_bu uuid:=public.current_business_unit_id(); v_loc uuid:=public.current_operating_location_id();
begin
 if auth.uid() is null or v_company is null or v_bu is null or v_loc is null then raise exception 'Authentication, active company, business unit and branch are required.'; end if;
 if not public.has_module_permission(v_company,'sales','view') then raise exception 'Sales view permission required.'; end if;
 return query select h.id,h.invoice_no,h.invoice_date,h.reference_name,h.reference_no,h.reference_notes,h.subtotal,h.item_tax,h.charges_total,h.charge_tax,h.total,l.sales_order_id
 from public.consolidated_sales_invoices h left join public.sales_order_hawala_invoices l on l.hawala_invoice_id=h.id and l.user_id=v_user and l.company_id=v_company and l.business_unit_id=v_bu and l.operating_location_id=v_loc
 where h.user_id=v_user and h.company_id=v_company and h.business_unit_id=v_bu and h.operating_location_id=v_loc and h.customer_id=p_customer_id and h.status='posted' and (l.id is null or (p_order_id is not null and l.sales_order_id=p_order_id))
 order by h.invoice_date desc,h.invoice_no desc;
end $$;

create or replace function public.delete_consolidated_purchase_draft(p_invoice_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_invoice public.consolidated_purchase_invoices%rowtype; v_linked_count integer; v_loc uuid:=public.current_operating_location_id();
begin
 if auth.uid() is null or v_loc is null then raise exception 'Authentication and active branch are required.'; end if;
 select * into v_invoice from public.consolidated_purchase_invoices where id=p_invoice_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and operating_location_id=v_loc for update;
 if not found then raise exception 'Consolidated Purchase Invoice not found in active branch.'; end if;
 if v_invoice.status<>'draft' then raise exception 'Only draft Consolidated Purchase Invoices can be deleted.'; end if;
 if not public.has_module_permission(v_invoice.company_id,'purchase','delete') and not public.has_module_permission(v_invoice.company_id,'purchase','edit') then raise exception 'Purchase delete/edit permission is required.'; end if;
 select count(*) into v_linked_count from public.purchase_order_consolidated_invoices where consolidated_invoice_id=p_invoice_id and operating_location_id=v_loc;
 if v_linked_count>0 then raise exception 'This Consolidated Purchase Invoice is linked to a Main Purchase Invoice. Remove that link first.'; end if;
 delete from public.consolidated_purchase_invoices where id=p_invoice_id and operating_location_id=v_loc;
end $$;
