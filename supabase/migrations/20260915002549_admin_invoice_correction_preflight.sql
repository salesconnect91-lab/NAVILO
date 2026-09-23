create or replace function public.admin_invoice_correction_preflight(p_document_type text,p_document_id uuid,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
 v_company uuid:=public.current_company_id();
 v_unit uuid:=public.current_business_unit_id();
 v_status text; v_no text; v_paid numeric; v_source_journal uuid; v_stock_count integer; v_discount_count integer;
begin
 if v_company is null or v_unit is null then raise exception 'Active company and business unit are required.'; end if;
 perform public.assert_admin_posted_record_control(v_company);
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A correction reason is required.'; end if;
 if lower(p_document_type)='sales' then
   select status,order_no,coalesce(paid_amount,0) into v_status,v_no,v_paid from public.sales_orders where id=p_document_id and company_id=v_company and business_unit_id=v_unit for update;
   if not found then raise exception 'Sales invoice was not found in the active business unit.'; end if;
   if v_status<>'posted' then raise exception 'Only a posted Sales Invoice can enter correction workflow.'; end if;
   select id into v_source_journal from public.journal_entries where company_id=v_company and business_unit_id=v_unit and source_document_id=p_document_id and source_document_type='sales_invoice' and status='posted' order by created_at limit 1;
   select count(*) into v_stock_count from public.stock_movements where company_id=v_company and business_unit_id=v_unit and source_id=p_document_id and source_type='sales_invoice';
   select count(*) into v_discount_count from public.journal_entries where company_id=v_company and business_unit_id=v_unit and entry_no='DISC-S-'||v_no and status='posted';
 elsif lower(p_document_type)='purchase' then
   select status,order_no,coalesce(paid_amount,0) into v_status,v_no,v_paid from public.purchase_orders where id=p_document_id and company_id=v_company and business_unit_id=v_unit for update;
   if not found then raise exception 'Purchase invoice was not found in the active business unit.'; end if;
   if v_status<>'posted' then raise exception 'Only a posted Purchase Invoice can enter correction workflow.'; end if;
   select id into v_source_journal from public.journal_entries where company_id=v_company and business_unit_id=v_unit and source_document_id=p_document_id and source_document_type='purchase_invoice' and status='posted' order by created_at limit 1;
   select count(*) into v_stock_count from public.stock_movements where company_id=v_company and business_unit_id=v_unit and source_id=p_document_id and source_type='purchase_invoice';
   select count(*) into v_discount_count from public.journal_entries where company_id=v_company and business_unit_id=v_unit and entry_no='DISC-P-'||v_no and status='posted';
 else raise exception 'Document type must be sales or purchase.'; end if;
 if v_paid>0 then raise exception 'This invoice has payments applied. Reverse or unlink the payment before correcting the posted invoice.'; end if;
 if v_source_journal is null then raise exception 'Direct source journal linkage is missing. This historical invoice cannot be reopened automatically.'; end if;
 if v_stock_count=0 then raise exception 'Direct stock source linkage is missing. This invoice cannot be reopened automatically.'; end if;
 perform public.log_admin_posted_action(v_company,case when lower(p_document_type)='sales' then 'sales' else 'purchase' end,case when lower(p_document_type)='sales' then 'sales_orders' else 'purchase_orders' end,p_document_id,v_no,'CORRECTION_PREFLIGHT',p_reason,jsonb_build_object('status',v_status,'paid_amount',v_paid),jsonb_build_object('eligible',true,'journal_entry_id',v_source_journal,'stock_movement_count',v_stock_count,'discount_adjustment_count',v_discount_count));
 return jsonb_build_object('eligible',true,'document_type',lower(p_document_type),'document_id',p_document_id,'document_no',v_no,'journal_entry_id',v_source_journal,'stock_movement_count',v_stock_count,'discount_adjustment_count',v_discount_count,'history_preserved',true);
end;
$$;
revoke all on function public.admin_invoice_correction_preflight(text,uuid,text) from public;
grant execute on function public.admin_invoice_correction_preflight(text,uuid,text) to authenticated;
comment on function public.admin_invoice_correction_preflight(text,uuid,text) is 'Admin-only safety gate for posted Sales/Purchase correction. Requires direct journal/stock traceability, no applied payment, mandatory reason, and writes permanent audit history.';

