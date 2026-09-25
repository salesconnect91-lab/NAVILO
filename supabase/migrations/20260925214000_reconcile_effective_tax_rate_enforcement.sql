begin;
create or replace function public.enforce_document_tax_rate()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_context text:=case when tg_table_name='sales_orders' then 'sales' else 'purchase' end; v_rate numeric; v_doc_date date:=coalesce(new.order_date,current_date);
begin
 if new.company_id<>public.current_company_id() or new.business_unit_id<>public.current_business_unit_id() then raise exception 'Document does not match the active company/business unit.'; end if;
 if new.invoice_type='Tax Invoice' then
  select tr.rate into v_rate from public.tax_rates tr where tr.company_id=new.company_id and tr.is_active and tr.is_fixed and tr.applies_to in(v_context,'both')
   and coalesce(tr.effective_from,'0001-01-01'::date)<=v_doc_date and (tr.effective_to is null or tr.effective_to>=v_doc_date)
   order by coalesce(tr.effective_from,'0001-01-01'::date) desc,tr.created_at desc limit 1;
  if v_rate is null then raise exception 'No effective fixed tax rate is configured for % on %.',v_context,v_doc_date; end if;
  if round(coalesce(new.tax_percent,0),4)<>round(v_rate,4) then raise exception 'The configured effective tax rate is %%%.',v_rate; end if;
 elsif coalesce(new.tax_percent,0)<>0 then raise exception 'Non-tax documents cannot contain VAT/tax.'; end if; return new;
end $$;
create or replace function public.enforce_document_line_tax_rate()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_context text:=case when tg_table_name='sales_order_lines' then 'sales' else 'purchase' end; v_invoice_type text;v_company_id uuid;v_unit_id uuid;v_doc_date date;v_rate numeric;
begin
 if v_context='sales' then select invoice_type,company_id,business_unit_id,order_date into v_invoice_type,v_company_id,v_unit_id,v_doc_date from public.sales_orders where id=new.order_id;
 else select invoice_type,company_id,business_unit_id,order_date into v_invoice_type,v_company_id,v_unit_id,v_doc_date from public.purchase_orders where id=new.order_id; end if;
 if v_company_id is null or v_company_id<>public.current_company_id() or v_unit_id<>public.current_business_unit_id() or new.company_id<>v_company_id or new.business_unit_id<>v_unit_id then raise exception 'Document line does not belong to the active company/business unit.'; end if;
 if v_invoice_type='Tax Invoice' then
  select tr.rate into v_rate from public.tax_rates tr where tr.company_id=v_company_id and tr.is_active and tr.is_fixed and tr.applies_to in(v_context,'both')
   and coalesce(tr.effective_from,'0001-01-01'::date)<=coalesce(v_doc_date,current_date) and (tr.effective_to is null or tr.effective_to>=coalesce(v_doc_date,current_date))
   order by coalesce(tr.effective_from,'0001-01-01'::date) desc,tr.created_at desc limit 1;
  if v_rate is null then raise exception 'No effective fixed tax rate is configured for % on %.',v_context,coalesce(v_doc_date,current_date); end if;
  if round(coalesce(new.tax_percent,0),4)<>round(v_rate,4) then raise exception 'The configured effective tax rate is %%%.',v_rate; end if;
 elsif coalesce(new.tax_percent,0)<>0 then raise exception 'Non-tax document lines cannot contain VAT/tax.'; end if; return new;
end $$;
revoke all on function public.enforce_document_tax_rate() from public,anon,authenticated;
revoke all on function public.enforce_document_line_tax_rate() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;