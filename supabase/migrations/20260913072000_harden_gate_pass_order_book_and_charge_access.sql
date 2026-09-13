-- Harden remaining direct-table write surfaces and fix consolidated fulfillment type mismatch.

create or replace function public.capture_consolidated_order_fulfillment()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare r record; v_doc_type text; v_doc_no text; v_doc_date date;
begin
  if new.status<>'posted' or old.status='posted' then return new; end if;
  if tg_table_name='consolidated_sales_invoices' then
    v_doc_type:='consolidated_sales_invoice'; v_doc_no:=new.invoice_no; v_doc_date:=new.invoice_date;
    for r in select order_book_commitment_id commitment_id,sum(qty) qty,max(unit_price) rate from public.consolidated_sales_invoice_lines where invoice_id=new.id and order_book_commitment_id is not null group by order_book_commitment_id loop
      insert into public.order_book_fulfillments(company_id,user_id,business_unit_id,commitment_id,document_type,document_id,document_no,document_date,qty,rate)
      values(new.company_id,new.user_id,new.business_unit_id,r.commitment_id,v_doc_type,new.id,v_doc_no,v_doc_date,r.qty,r.rate)
      on conflict (company_id,business_unit_id,document_type,document_id,commitment_id) do update set qty=excluded.qty,rate=excluded.rate,document_no=excluded.document_no,document_date=excluded.document_date;
      perform public.refresh_order_book_commitment(r.commitment_id);
    end loop;
  else
    v_doc_type:='consolidated_purchase_invoice'; v_doc_no:=new.invoice_no; v_doc_date:=new.invoice_date;
    for r in select order_book_commitment_id commitment_id,sum(qty) qty,max(unit_cost) rate from public.consolidated_purchase_invoice_lines where invoice_id=new.id and order_book_commitment_id is not null group by order_book_commitment_id loop
      insert into public.order_book_fulfillments(company_id,user_id,business_unit_id,commitment_id,document_type,document_id,document_no,document_date,qty,rate)
      values(new.company_id,new.user_id,new.business_unit_id,r.commitment_id,v_doc_type,new.id,v_doc_no,v_doc_date,r.qty,r.rate)
      on conflict (company_id,business_unit_id,document_type,document_id,commitment_id) do update set qty=excluded.qty,rate=excluded.rate,document_no=excluded.document_no,document_date=excluded.document_date;
      perform public.refresh_order_book_commitment(r.commitment_id);
    end loop;
  end if;
  return new;
end
$function$;

drop policy if exists ob_fulfillments_select on public.order_book_fulfillments;
drop policy if exists ob_fulfillments_insert on public.order_book_fulfillments;
create policy ob_fulfillments_select on public.order_book_fulfillments
for select to authenticated
using (
  company_id=public.current_company_id()
  and business_unit_id=public.current_business_unit_id()
  and case
    when document_type in ('sales_invoice','consolidated_sales_invoice') then public.has_module_permission(company_id,'sales','view')
    when document_type in ('purchase_invoice','consolidated_purchase_invoice') then public.has_module_permission(company_id,'purchase','view')
    else false
  end
);
create policy ob_fulfillments_insert on public.order_book_fulfillments
for insert to authenticated
with check (
  company_id=public.current_company_id()
  and business_unit_id=public.current_business_unit_id()
  and case
    when document_type in ('sales_invoice','consolidated_sales_invoice') then public.has_module_permission(company_id,'sales','post')
    when document_type in ('purchase_invoice','consolidated_purchase_invoice') then public.has_module_permission(company_id,'purchase','post')
    else false
  end
);

drop policy if exists purchase_order_charges_select on public.purchase_order_charges;
drop policy if exists purchase_order_charges_insert on public.purchase_order_charges;
drop policy if exists purchase_order_charges_update on public.purchase_order_charges;
drop policy if exists purchase_order_charges_delete on public.purchase_order_charges;
create policy purchase_order_charges_select on public.purchase_order_charges for select to authenticated
using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'purchase','view'));
create policy purchase_order_charges_insert on public.purchase_order_charges for insert to authenticated
with check (user_id=public.legacy_data_user_id() and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and (public.has_module_permission(company_id,'purchase','create') or public.has_module_permission(company_id,'purchase','edit')));
create policy purchase_order_charges_update on public.purchase_order_charges for update to authenticated
using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'purchase','edit'))
with check (user_id=public.legacy_data_user_id() and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'purchase','edit'));
create policy purchase_order_charges_delete on public.purchase_order_charges for delete to authenticated
using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'purchase','delete'));

drop policy if exists gate_pass_lines_select on public.gate_pass_lines;
drop policy if exists gate_pass_lines_insert on public.gate_pass_lines;
drop policy if exists gate_pass_lines_update on public.gate_pass_lines;
drop policy if exists gate_pass_lines_delete on public.gate_pass_lines;
create policy gate_pass_lines_select on public.gate_pass_lines for select to authenticated
using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'production','view'));
create policy gate_pass_lines_insert on public.gate_pass_lines for insert to authenticated
with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'production','create'));
create policy gate_pass_lines_update on public.gate_pass_lines for update to authenticated
using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'production','edit'))
with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'production','edit'));
create policy gate_pass_lines_delete on public.gate_pass_lines for delete to authenticated
using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,'production','delete'));

drop policy if exists gate_pass_loaders_select on public.gate_pass_loaders;
drop policy if exists gate_pass_loaders_insert on public.gate_pass_loaders;
drop policy if exists gate_pass_loaders_update on public.gate_pass_loaders;
create policy gate_pass_loaders_select on public.gate_pass_loaders for select to authenticated
using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and (public.has_module_permission(company_id,'production','view') or public.has_module_permission(company_id,'settings','view')));
create policy gate_pass_loaders_insert on public.gate_pass_loaders for insert to authenticated
with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and (public.has_module_permission(company_id,'production','create') or public.has_module_permission(company_id,'settings','edit')));
create policy gate_pass_loaders_update on public.gate_pass_loaders for update to authenticated
using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and (public.has_module_permission(company_id,'production','edit') or public.has_module_permission(company_id,'settings','edit')))
with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and (public.has_module_permission(company_id,'production','edit') or public.has_module_permission(company_id,'settings','edit')));

drop policy if exists gate_pass_loading_instructions_select on public.gate_pass_loading_instructions;
drop policy if exists gate_pass_loading_instructions_insert on public.gate_pass_loading_instructions;
drop policy if exists gate_pass_loading_instructions_update on public.gate_pass_loading_instructions;
create policy gate_pass_loading_instructions_select on public.gate_pass_loading_instructions for select to authenticated
using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and (public.has_module_permission(company_id,'production','view') or public.has_module_permission(company_id,'settings','view')));
create policy gate_pass_loading_instructions_insert on public.gate_pass_loading_instructions for insert to authenticated
with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and (public.has_module_permission(company_id,'production','create') or public.has_module_permission(company_id,'settings','edit')));
create policy gate_pass_loading_instructions_update on public.gate_pass_loading_instructions for update to authenticated
using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and (public.has_module_permission(company_id,'production','edit') or public.has_module_permission(company_id,'settings','edit')))
with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and (public.has_module_permission(company_id,'production','edit') or public.has_module_permission(company_id,'settings','edit')));
