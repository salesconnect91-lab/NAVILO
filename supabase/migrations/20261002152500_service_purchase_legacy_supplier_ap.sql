create or replace function public.post_service_purchase_invoice_core(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.purchase_orders%rowtype;v_sub numeric;v_vat numeric;v_total numeric;v_ap uuid;v_tax uuid;
 v_name text;v_j uuid;v_cost uuid;r record;
begin
 perform public.assert_module_permission('purchase','post');
 select * into o from public.purchase_orders where id=p_order_id and company_id=public.current_company_id()
  and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id() for update;
 if not found or o.document_kind<>'service' or o.status='posted'
  or exists(select 1 from public.purchase_order_lines where order_id=o.id)
  or exists(select 1 from public.purchase_order_consolidated_invoices where purchase_order_id=o.id)
  or public.discount_amount_for('purchase_main',o.order_no)<>0
 then raise exception 'Eligible service Purchase document without inventory lines required'; end if;
 select coalesce(sum(amount),0),coalesce(sum(round(amount*tax_percent/100,2)),0)
 into v_sub,v_vat from public.purchase_service_lines where order_id=o.id;
 if v_sub<=0 or o.supplier_id is null then raise exception 'Supplier and positive service lines required'; end if;
 v_total:=round(v_sub+v_vat,2);
 v_ap:=public.fx_mapping_account(o.user_id,o.company_id,'accounts_payable','liability');
 if v_vat>0 then v_tax:=public.fx_mapping_account(o.user_id,o.company_id,'input_vat','asset'); end if;
 select name into v_name from public.suppliers where id=o.supplier_id and company_id=o.company_id
  and user_id=o.user_id and (account_id=v_ap or account_id is null);
 if v_name is null then raise exception 'Supplier/AP mapping mismatch'; end if;
 for r in select cost_account_id,sum(amount) amount from public.purchase_service_lines where order_id=o.id group by cost_account_id loop
  if not exists(select 1 from public.chart_of_accounts a where a.id=r.cost_account_id and a.company_id=o.company_id and a.type='expense' and a.is_active and not a.is_group)
  then raise exception 'Active service expense account required'; end if;
 end loop;
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,party_name,trans_type,source_module,source_document_type,source_document_id)
 values(o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,'PUR-'||o.order_no,o.order_date,'Service Purchase Invoice '||o.order_no,'draft',v_name,'Purchase','purchase','purchase_invoice',o.id) returning id into v_j;
 for r in select cost_account_id,sum(amount) amount from public.purchase_service_lines where order_id=o.id group by cost_account_id loop
  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit)
  select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,a.id,a.code||' - '||a.name,r.amount,0 from public.chart_of_accounts a where a.id=r.cost_account_id;
 end loop;
 if v_vat>0 then insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit)
  select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,a.id,a.code||' - '||a.name,v_vat,0 from public.chart_of_accounts a where a.id=v_tax; end if;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name)
 select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,a.id,a.code||' - '||a.name,0,v_total,'supplier',o.supplier_id,v_name from public.chart_of_accounts a where a.id=v_ap;
 perform public.post_journal_entry(v_j);
 update public.purchase_orders set status='posted',total=v_total,posted_at=now(),posted_by=auth.uid(),updated_at=now() where id=o.id and status<>'posted';
 return jsonb_build_object('success',true,'order_id',o.id,'journal_entry_id',v_j,'subtotal_excluding_vat',v_sub,'vat',v_vat,'grand_total',v_total,'status','posted');
end $$;