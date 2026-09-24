create or replace function public.reverse_admin_invoice_stock(p_document_type text,p_document_id uuid,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
 v_company uuid:=public.current_company_id(); v_unit uuid:=public.current_business_unit_id();
 v_doc_no text; v_m record; v_new numeric; v_count integer:=0; v_reverse_type text;
begin
 if v_company is null or v_unit is null then raise exception 'Active company and business unit are required.'; end if;
 perform public.assert_admin_posted_record_control(v_company);
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A correction reason is required.'; end if;
 perform public.admin_invoice_correction_preflight(p_document_type,p_document_id,p_reason);
 if lower(p_document_type)='sales' then select order_no into v_doc_no from public.sales_orders where id=p_document_id and company_id=v_company and business_unit_id=v_unit; v_reverse_type:='sale_return';
 elsif lower(p_document_type)='purchase' then select order_no into v_doc_no from public.purchase_orders where id=p_document_id and company_id=v_company and business_unit_id=v_unit; v_reverse_type:='purchase_return';
 else raise exception 'Document type must be sales or purchase.'; end if;

 for v_m in select * from public.stock_movements where company_id=v_company and business_unit_id=v_unit and source_id=p_document_id and source_type=case when lower(p_document_type)='sales' then 'sales_invoice' else 'purchase_invoice' end order by created_at,id
 loop
   if exists(select 1 from public.stock_movements x where x.company_id=v_company and x.business_unit_id=v_unit and x.source_id=p_document_id and x.source_type='admin_invoice_correction' and x.reference='CORR-STOCK-'||v_m.id::text) then raise exception 'Stock movement % has already been reversed for correction.',v_m.id; end if;
   v_new:=public.apply_stock_movement(v_m.item_id,v_m.warehouse_id,v_m.godown_id,v_reverse_type,v_m.qty,'CORR-STOCK-'||v_m.id::text);
   update public.stock_movements set source_type='admin_invoice_correction',source_id=p_document_id,reason=btrim(p_reason),remarks='Reversal of source stock movement '||v_m.id::text where id=(select id from public.stock_movements where company_id=v_company and business_unit_id=v_unit and item_id=v_m.item_id and warehouse_id=v_m.warehouse_id and godown_id=v_m.godown_id and type=v_reverse_type and reference='CORR-STOCK-'||v_m.id::text order by created_at desc,id desc limit 1);
   v_count:=v_count+1;
 end loop;
 if v_count=0 then raise exception 'No directly linked invoice stock movements were found.'; end if;
 perform public.log_admin_posted_action(v_company,case when lower(p_document_type)='sales' then 'sales' else 'purchase' end,'stock_movements',p_document_id,v_doc_no,'STOCK_REVERSAL_CREATED',p_reason,jsonb_build_object('source_document_id',p_document_id),jsonb_build_object('reversal_movement_count',v_count,'reversal_type',v_reverse_type));
 return jsonb_build_object('success',true,'document_id',p_document_id,'document_no',v_doc_no,'reversal_movement_count',v_count,'reversal_type',v_reverse_type,'history_preserved',true);
end;
$$;
revoke all on function public.reverse_admin_invoice_stock(text,uuid,text) from public;
grant execute on function public.reverse_admin_invoice_stock(text,uuid,text) to authenticated;
comment on function public.reverse_admin_invoice_stock(text,uuid,text) is 'Admin-only physical stock reversal stage for traceable posted Sales/Purchase correction. Creates opposite immutable movements and preserves original movement history.';

