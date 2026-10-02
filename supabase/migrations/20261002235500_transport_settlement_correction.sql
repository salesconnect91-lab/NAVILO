-- Controlled Transport settlement correction: never edit posted vouchers.
-- Reverse the original canonical receipt/payment, archive allocations via existing guards,
-- then post the corrected canonical settlement against the same Transport documents.
create or replace function public.transport_correct_settlement(
 p_journal_entry_id uuid,
 p_new_amount numeric,
 p_date date,
 p_account_id uuid,
 p_method text,
 p_reason text,
 p_reference text default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
 c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id();
 v public.journal_entries%rowtype; v_side text; v_party uuid; v_old numeric; v_alloc jsonb; v_rev jsonb; v_new jsonb;
begin
 perform public.transport_finance_assert('settlement');
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Correction reason is required'; end if;
 if p_new_amount is null or p_new_amount<=0 then raise exception 'Corrected amount must be greater than zero'; end if;
 select * into v from public.journal_entries where id=p_journal_entry_id and company_id=c and business_unit_id=b and operating_location_id=loc and status='posted' for update;
 if not found or v.trans_type not in ('Customer Receipt','Supplier Payment') then raise exception 'Posted customer receipt or supplier payment not found in active workspace'; end if;
 if exists(select 1 from public.journal_entries where reversal_of_entry_id=v.id and status='posted') then raise exception 'This settlement has already been reversed'; end if;
 if p_date<v.entry_date then raise exception 'Correction date cannot be earlier than original payment/receipt date'; end if;
 if v.trans_type='Customer Receipt' then
   v_side:='customer';
   select customer_id,round(sum(amount),2),jsonb_agg(jsonb_build_object('document_id',sales_order_id,'amount',round(amount*p_new_amount/nullif((select sum(x.amount) from public.invoice_payment_allocations x where x.journal_entry_id=v.id),0),2)) order by sales_order_id)
   into v_party,v_old,v_alloc from public.invoice_payment_allocations where journal_entry_id=v.id group by customer_id;
   if v_party is null then raise exception 'Transport customer receipt allocations not found'; end if;
   if not exists(select 1 from public.invoice_payment_allocations a join public.transport_customer_documents d on d.sales_order_id=a.sales_order_id where a.journal_entry_id=v.id) then raise exception 'Receipt is not attributed to Transport'; end if;
 else
   v_side:='supplier';
   select supplier_id,round(sum(amount),2),jsonb_agg(jsonb_build_object('document_id',purchase_order_id,'amount',round(amount*p_new_amount/nullif((select sum(x.amount) from public.purchase_payment_allocations x where x.journal_entry_id=v.id),0),2)) order by purchase_order_id)
   into v_party,v_old,v_alloc from public.purchase_payment_allocations where journal_entry_id=v.id group by supplier_id;
   if v_party is null then raise exception 'Transport supplier payment allocations not found'; end if;
   if not exists(select 1 from public.purchase_payment_allocations a where a.journal_entry_id=v.id and (exists(select 1 from public.transport_supplier_documents d where d.purchase_order_id=a.purchase_order_id) or exists(select 1 from public.transport_service_cost_links l where l.purchase_order_id=a.purchase_order_id))) then raise exception 'Payment is not attributed to Transport'; end if;
 end if;
 if abs(p_new_amount-v_old)<0.005 then raise exception 'Corrected amount is unchanged'; end if;
 v_rev:=public.reverse_payment_voucher(v.id,p_date,btrim(p_reason));
 v_new:=public.transport_settle_documents(v_side,v_party,p_date,p_account_id,p_method,v_alloc,null,coalesce(nullif(btrim(p_reference),''),'Correction of '||v.entry_no));
 insert into public.audit_logs(user_id,module,action,table_name,record_id,record_name,performed_by,performed_email,old_data,new_data,metadata)
 values(public.legacy_data_user_id(),'transport','CORRECT_SETTLEMENT','journal_entries',v.id,v.entry_no,auth.uid()::text,auth.jwt()->>'email',
 jsonb_build_object('amount',v_old,'date',v.entry_date,'reference',v.description),
 jsonb_build_object('amount',p_new_amount,'date',p_date,'reference',p_reference),
 jsonb_build_object('side',v_side,'reason',btrim(p_reason),'reversal',v_rev,'replacement',v_new));
 return jsonb_build_object('success',true,'side',v_side,'old_amount',v_old,'new_amount',p_new_amount,'reversal',v_rev,'replacement',v_new);
end $$;
