create or replace function public.post_purchase_discount_adjustment()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_own numeric:=0; v_linked numeric:=0; v_discount numeric:=0;
  v_disc_ac uuid; v_ap uuid; v_supplier_ac uuid; v_supplier_name text; v_je uuid; v_no text;
begin
  if NEW.status<>'posted' or OLD.status='posted' then return NEW; end if;
  select coalesce(max(discount_amount),0) into v_own
    from public.commercial_invoice_discounts
   where company_id=NEW.company_id and business_unit_id=NEW.business_unit_id
     and document_type='purchase_main' and document_no=NEW.order_no;
  select coalesce(sum(d.discount_amount),0) into v_linked
    from public.purchase_order_consolidated_invoices l
    join public.consolidated_purchase_invoices h on h.id=l.consolidated_invoice_id
    join public.commercial_invoice_discounts d
      on d.company_id=NEW.company_id and d.business_unit_id=NEW.business_unit_id
     and d.document_type='purchase_consolidated' and d.document_no=h.invoice_no
   where l.purchase_order_id=NEW.id and l.company_id=NEW.company_id and l.business_unit_id=NEW.business_unit_id;
  v_discount:=round(coalesce(v_own,0)+coalesce(v_linked,0),2);
  if v_discount<=0 then return NEW; end if;
  perform public.ensure_commercial_discount_accounts();
  select account_id into v_disc_ac from public.account_mappings where company_id=NEW.company_id and mapping_key='purchase_discount_received' limit 1;
  select account_id into v_ap from public.account_mappings where company_id=NEW.company_id and mapping_key='accounts_payable' limit 1;
  if NEW.supplier_id is not null then
    select name,account_id into v_supplier_name,v_supplier_ac from public.suppliers where id=NEW.supplier_id and company_id=NEW.company_id;
  end if;
  v_ap:=coalesce(v_supplier_ac,v_ap);
  if v_disc_ac is null or v_ap is null then raise exception 'Discount Received or Accounts Payable mapping is missing.'; end if;
  v_no:='DISC-P-'||NEW.order_no;
  if exists(select 1 from public.journal_entries where company_id=NEW.company_id and business_unit_id=NEW.business_unit_id and entry_no=v_no) then return NEW; end if;
  insert into public.journal_entries(user_id,company_id,business_unit_id,entry_no,entry_date,description,status,party_name,trans_type)
  values(NEW.user_id,NEW.company_id,NEW.business_unit_id,v_no,NEW.order_date,'Discount Received — Purchase Invoice '||NEW.order_no,'draft',v_supplier_name,'Purchase Discount') returning id into v_je;
  insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit,party_name,party_type,party_id)
  select NEW.user_id,NEW.company_id,NEW.business_unit_id,v_je,code||' - '||name,id,v_discount,0,v_supplier_name,'supplier',NEW.supplier_id from public.chart_of_accounts where id=v_ap;
  insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit)
  select NEW.user_id,NEW.company_id,NEW.business_unit_id,v_je,code||' - '||name,id,0,v_discount from public.chart_of_accounts where id=v_disc_ac;
  perform public.post_journal_entry(v_je);
  return NEW;
end
$$;

create or replace function public.post_sales_discount_adjustment()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_own numeric:=0; v_linked numeric:=0; v_discount numeric:=0;
  v_disc_ac uuid; v_ar uuid; v_customer_ac uuid; v_customer_name text; v_je uuid; v_no text;
begin
  if NEW.status<>'posted' or OLD.status='posted' then return NEW; end if;
  select coalesce(max(discount_amount),0) into v_own
    from public.commercial_invoice_discounts
   where company_id=NEW.company_id and business_unit_id=NEW.business_unit_id
     and document_type='sales_main' and document_no=NEW.order_no;
  select coalesce(sum(d.discount_amount),0) into v_linked
    from public.sales_order_hawala_invoices l
    join public.consolidated_sales_invoices h on h.id=l.hawala_invoice_id
    join public.commercial_invoice_discounts d
      on d.company_id=NEW.company_id and d.business_unit_id=NEW.business_unit_id
     and d.document_type='sales_consolidated' and d.document_no=h.invoice_no
   where l.sales_order_id=NEW.id and l.company_id=NEW.company_id and l.business_unit_id=NEW.business_unit_id;
  v_discount:=round(coalesce(v_own,0)+coalesce(v_linked,0),2);
  if v_discount<=0 then return NEW; end if;
  perform public.ensure_commercial_discount_accounts();
  select account_id into v_disc_ac from public.account_mappings where company_id=NEW.company_id and mapping_key='sales_discount_allowed' limit 1;
  select account_id into v_ar from public.account_mappings where company_id=NEW.company_id and mapping_key='accounts_receivable' limit 1;
  if NEW.customer_id is not null then
    select name,account_id into v_customer_name,v_customer_ac from public.customers where id=NEW.customer_id and company_id=NEW.company_id;
  end if;
  v_ar:=coalesce(v_customer_ac,v_ar);
  if v_disc_ac is null or v_ar is null then raise exception 'Discount Allowed or Accounts Receivable mapping is missing.'; end if;
  v_no:='DISC-S-'||NEW.order_no;
  if exists(select 1 from public.journal_entries where company_id=NEW.company_id and business_unit_id=NEW.business_unit_id and entry_no=v_no) then return NEW; end if;
  insert into public.journal_entries(user_id,company_id,business_unit_id,entry_no,entry_date,description,status,party_name,trans_type)
  values(NEW.user_id,NEW.company_id,NEW.business_unit_id,v_no,NEW.order_date,'Discount Allowed — Sales Invoice '||NEW.order_no,'draft',v_customer_name,'Sales Discount') returning id into v_je;
  insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit)
  select NEW.user_id,NEW.company_id,NEW.business_unit_id,v_je,code||' - '||name,id,v_discount,0 from public.chart_of_accounts where id=v_disc_ac;
  insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit,party_name,party_type,party_id)
  select NEW.user_id,NEW.company_id,NEW.business_unit_id,v_je,code||' - '||name,id,0,v_discount,v_customer_name,'customer',NEW.customer_id from public.chart_of_accounts where id=v_ar;
  perform public.post_journal_entry(v_je);
  update public.sales_orders
     set outstanding_amount=greatest(coalesce(total,0)-coalesce(paid_amount,0),0),
         payment_status=case when coalesce(paid_amount,0)>=coalesce(total,0) then 'paid' when coalesce(paid_amount,0)>0 then 'partial' else 'unpaid' end
   where id=NEW.id;
  return NEW;
end
$$;
