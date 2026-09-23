create or replace function public.repair_invoice_outstanding_from_posted_activity(p_sales_order_id uuid default null, p_purchase_order_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
 v_so public.sales_orders%rowtype; v_po public.purchase_orders%rowtype;
 v_returns numeric:=0; v_paid numeric:=0; v_net numeric:=0; v_out numeric:=0; v_status text;
begin
 if p_sales_order_id is not null then
   select * into v_so from public.sales_orders where id=p_sales_order_id for update;
   if not found then raise exception 'Sales invoice not found.'; end if;
   select round(coalesce(sum(total),0),2) into v_returns from public.return_notes where sales_order_id=v_so.id and company_id=v_so.company_id and business_unit_id=v_so.business_unit_id and note_type='sales_credit' and status='posted';
   select round(coalesce(sum(amount),0),2) into v_paid from public.invoice_payment_allocations where sales_order_id=v_so.id and company_id=v_so.company_id and business_unit_id=v_so.business_unit_id;
   v_net:=greatest(round(coalesce(v_so.total,0)-v_returns,2),0); v_out:=greatest(round(v_net-v_paid,2),0);
   v_status:=case when v_net<=0.005 then case when v_paid>0.005 then 'overpaid' else 'paid' end when v_paid<=0.005 then 'unpaid' when v_paid<v_net-0.005 then 'partial' when v_paid>v_net+0.005 then 'overpaid' else 'paid' end;
   perform set_config('app.customer_payment_update','1',true);
   update public.sales_orders set paid_amount=v_paid,outstanding_amount=v_out,payment_status=v_status where id=v_so.id;
   return jsonb_build_object('document_type','sales_invoice','document_id',v_so.id,'total',v_so.total,'returns',v_returns,'paid',v_paid,'outstanding',v_out,'payment_status',v_status);
 elsif p_purchase_order_id is not null then
   select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
   if not found then raise exception 'Purchase invoice not found.'; end if;
   select round(coalesce(sum(total),0),2) into v_returns from public.return_notes where purchase_order_id=v_po.id and company_id=v_po.company_id and business_unit_id=v_po.business_unit_id and note_type='purchase_debit' and status='posted';
   select round(coalesce(sum(amount),0),2) into v_paid from public.purchase_payment_allocations where purchase_order_id=v_po.id and company_id=v_po.company_id and business_unit_id=v_po.business_unit_id;
   v_net:=greatest(round(coalesce(v_po.total,0)-v_returns,2),0); v_out:=greatest(round(v_net-v_paid,2),0);
   v_status:=case when v_net<=0.005 then case when v_paid>0.005 then 'overpaid' else 'paid' end when v_paid<=0.005 then 'unpaid' when v_paid<v_net-0.005 then 'partial' when v_paid>v_net+0.005 then 'overpaid' else 'paid' end;
   perform set_config('app.supplier_payment_update','1',true);
   update public.purchase_orders set paid_amount=v_paid,outstanding_amount=v_out,payment_status=v_status where id=v_po.id;
   return jsonb_build_object('document_type','purchase_invoice','document_id',v_po.id,'total',v_po.total,'returns',v_returns,'paid',v_paid,'outstanding',v_out,'payment_status',v_status);
 else raise exception 'Sales or purchase invoice id is required.'; end if;
end
$function$;

