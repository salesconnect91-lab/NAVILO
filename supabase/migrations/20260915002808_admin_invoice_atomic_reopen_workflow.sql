create or replace function public.admin_reopen_posted_invoice(p_document_type text,p_document_id uuid,p_reason text,p_reversal_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
 v_company uuid:=public.current_company_id(); v_unit uuid:=public.current_business_unit_id(); v_no text; v_old jsonb; v_accounting jsonb; v_stock jsonb;
begin
 if v_company is null or v_unit is null then raise exception 'Active company and business unit are required.'; end if;
 perform public.assert_admin_posted_record_control(v_company);
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A correction reason is required.'; end if;
 perform public.admin_invoice_correction_preflight(p_document_type,p_document_id,p_reason);

 if lower(p_document_type)='sales' then
   select order_no,to_jsonb(s) into v_no,v_old from public.sales_orders s where id=p_document_id and company_id=v_company and business_unit_id=v_unit for update;
 elsif lower(p_document_type)='purchase' then
   select order_no,to_jsonb(p) into v_no,v_old from public.purchase_orders p where id=p_document_id and company_id=v_company and business_unit_id=v_unit for update;
 else raise exception 'Document type must be sales or purchase.'; end if;

 v_accounting:=public.create_admin_invoice_reversal_journal(p_document_type,p_document_id,p_reason,p_reversal_date);
 v_stock:=public.reverse_admin_invoice_stock(p_document_type,p_document_id,p_reason);

 perform set_config('app.maintenance_reset','1',true);
 if lower(p_document_type)='sales' then
   update public.sales_orders set status='draft',posted_by=null,posted_at=null,updated_by=auth.uid(),updated_at=now() where id=p_document_id and company_id=v_company and business_unit_id=v_unit;
 else
   update public.purchase_orders set status='draft',posted_by=null,posted_at=null,updated_by=auth.uid(),updated_at=now() where id=p_document_id and company_id=v_company and business_unit_id=v_unit;
 end if;
 perform set_config('app.maintenance_reset','0',true);

 perform public.log_admin_posted_action(v_company,case when lower(p_document_type)='sales' then 'sales' else 'purchase' end,case when lower(p_document_type)='sales' then 'sales_orders' else 'purchase_orders' end,p_document_id,v_no,'REOPEN_FOR_CORRECTION',p_reason,v_old,jsonb_build_object('status','draft','accounting_reversal',v_accounting,'stock_reversal',v_stock));
 return jsonb_build_object('success',true,'document_type',lower(p_document_type),'document_id',p_document_id,'document_no',v_no,'status','draft','accounting_reversal',v_accounting,'stock_reversal',v_stock,'history_preserved',true);
exception when others then
 perform set_config('app.maintenance_reset','0',true);
 raise;
end;
$$;
revoke all on function public.admin_reopen_posted_invoice(text,uuid,text,date) from public;
grant execute on function public.admin_reopen_posted_invoice(text,uuid,text,date) to authenticated;
comment on function public.admin_reopen_posted_invoice(text,uuid,text,date) is 'Atomic Admin-only Sales/Purchase posted invoice reopen workflow: validates traceability, creates accounting and stock reversals, preserves originals/audit history, then reopens document as draft.';

