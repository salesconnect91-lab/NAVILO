-- Forward only: positive rate corrections use the Trip's already-posted revenue account
-- (company vehicle or supplier Service Revenue). Negative credits remain on existing note path.
-- No original posted journal or invoice is edited.
BEGIN;
CREATE OR REPLACE FUNCTION public.transport_adjust_rate(p_trip_id uuid, p_side text, p_new_rate numeric, p_reason text, p_date date DEFAULT CURRENT_DATE, p_rent_id uuid DEFAULT NULL::uuid, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.transport_trips%rowtype;x public.transport_trip_supplier_rents%rowtype;old_rate numeric;diff numeric;
 evidence jsonb:='[]';r jsonb;d uuid;source record;remaining numeric;available numeric;cost uuid;party uuid;original_order uuid;
 with_tax boolean;aid uuid;v_original_revenue uuid;v_revenue_count integer;
begin
 perform public.transport_finance_assert('adjustment');t:=public.transport_financial_trip(p_trip_id);
 if p_side not in ('customer','supplier') or p_new_rate is null or p_new_rate<0 or p_date is null or nullif(btrim(p_reason),'') is null
 then raise exception 'Side, non-negative revised rate, date and correction reason required'; end if;
 if p_side='customer' then
 select d.sales_order_id,d.customer_id into original_order,party from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id
 where l.trip_id=t.id and not l.is_adjustment;
 old_rate:=t.customer_rate;
 else
 select * into x from public.transport_trip_supplier_rents where id=p_rent_id and trip_id=t.id for update;
 if not found then raise exception 'Same-Trip supplier rent required'; end if;
 old_rate:=x.amount;party:=x.supplier_id;
 select d.purchase_order_id into original_order from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id where l.rent_id=x.id and not l.is_adjustment;
 end if;
 if original_order is null then raise exception 'Posted billing required; unposted values use audited Trip Edit/finalization'; end if;
 select coalesce(sum(difference),0)+old_rate into old_rate from public.transport_rate_adjustments where trip_id=t.id and side=p_side and rent_id is not distinct from p_rent_id;
 diff:=round(p_new_rate-old_rate,2);if diff=0 then raise exception 'Revised rate is unchanged'; end if;
 if diff>0 then
 -- Validate original AR and revenue accounts against the posted document's
 -- actual line/charge mappings. Mixed company/supplier invoices legitimately
 -- contain more than one Revenue COA and cannot be compared to one default map.
 if p_side='customer' and exists(
  select 1 from public.journal_lines l
  join public.transport_customer_documents d on d.journal_entry_id=l.entry_id
  join public.sales_orders o on o.id=d.sales_order_id
  where o.id=original_order and
   ((l.party_type='customer' and l.account_id is distinct from public.fx_mapping_account(o.user_id,o.company_id,'accounts_receivable','asset'))
    or (l.credit>0 and exists(select 1 from public.chart_of_accounts a where a.id=l.account_id and a.company_id=o.company_id and a.type='revenue')
      and not exists(select 1 from public.sales_service_lines s
       where s.order_id=o.id and coalesce(s.revenue_account_id,public.fx_mapping_account(o.user_id,o.company_id,'service_revenue','revenue'))=l.account_id)
      and not exists(select 1 from public.sales_order_charges ch where ch.order_id=o.id and ch.account_id=l.account_id)))
 ) then raise exception 'Original accounting mappings changed; reconcile posted invoice before rate correction';end if;
 if p_side='supplier' and exists(select 1 from public.journal_lines l join public.transport_supplier_documents d on d.journal_entry_id=l.entry_id join public.purchase_orders o on o.id=d.purchase_order_id
 where o.id=original_order and l.party_type='supplier' and l.account_id is distinct from public.fx_mapping_account(o.user_id,o.company_id,'accounts_payable','liability'))
 then raise exception 'Original AP mapping changed; canonical accounting review required';end if;
 if p_side='customer' then select tax_percent>0 into with_tax from public.sales_orders where id=original_order;
 else select tax_percent>0 into with_tax from public.purchase_orders where id=original_order;
 select cost_account_id into cost from public.purchase_service_lines where order_id=original_order order by id limit 1;end if;
 if p_side='customer' then insert into public.transport_billing_adjustment_gate select txid_current(),p_side,party,t.company_id,t.business_unit_id,payment_mode,case when payment_mode='Credit' then public.fixed_tax_rate_on(t.company_id,'sales',p_date) else 0 end from public.sales_orders where id=original_order;else insert into public.transport_billing_adjustment_gate select txid_current(),p_side,party,t.company_id,t.business_unit_id,case when tax_percent>0 then 'Credit' else 'Cash' end,case when tax_percent>0 then public.fixed_tax_rate_on(t.company_id,'purchase',p_date) else 0 end from public.purchase_orders where id=original_order;end if;
if p_side='customer' then
  -- The Trip's own base line is authoritative in a grouped mixed-fleet invoice.
  select coalesce(sl.revenue_account_id,public.fx_mapping_account(o.user_id,o.company_id,'service_revenue','revenue'))
  into v_original_revenue
  from public.sales_service_lines sl
  join public.sales_orders o on o.id=sl.order_id
  where sl.order_id=original_order and sl.source_module='transport' and sl.source_id=t.id
  order by sl.id limit 1;
  if v_original_revenue is null then
    select count(distinct coalesce(sl.revenue_account_id,public.fx_mapping_account(o.user_id,o.company_id,'service_revenue','revenue'))),
      min(coalesce(sl.revenue_account_id,public.fx_mapping_account(o.user_id,o.company_id,'service_revenue','revenue')))
    into v_revenue_count,v_original_revenue
    from public.sales_service_lines sl join public.sales_orders o on o.id=sl.order_id
    where sl.order_id=original_order;
    if v_revenue_count<>1 then raise exception 'Trip rate correction revenue account is ambiguous; review original invoice';end if;
  end if;
  r:=public.transport_create_charged_service_document_accounted(
    'customer',party,p_date,diff,with_tax,null,v_original_revenue,
    'Rate adjustment '||t.trip_no||': '||p_reason,p_reference,null,null,null);
 else
  r:=public.transport_create_service_document(p_side,party,p_date,diff,with_tax,cost,
    'Rate adjustment '||t.trip_no||': '||p_reason,p_reference);
 end if;
 delete from public.transport_billing_adjustment_gate where transaction_id=txid_current();
 if p_side='customer' then
 insert into public.transport_customer_documents(company_id,business_unit_id,operating_location_id,customer_id,document_kind,sales_order_id,journal_entry_id,created_by)
 values(t.company_id,t.business_unit_id,public.current_operating_location_id(),party,'adjustment',(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_customer_document_trips(company_id,business_unit_id,document_id,trip_id,rate_snapshot,vat_snapshot,is_adjustment)
 values(t.company_id,t.business_unit_id,d,t.id,diff,(r->>'vat')::numeric,true);
 else
 insert into public.transport_supplier_documents(company_id,business_unit_id,operating_location_id,supplier_id,purchase_order_id,journal_entry_id,created_by)
 values(t.company_id,t.business_unit_id,public.current_operating_location_id(),party,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_supplier_document_rents(company_id,business_unit_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot,is_adjustment)
 values(t.company_id,t.business_unit_id,d,x.id,t.id,diff,(r->>'vat')::numeric,true);end if;
 evidence:=jsonb_build_array(r);
 else
 remaining:=-diff;
 -- Credit newest uncredited documents first, including prior positive adjustments.
 for source in
 select d.sales_order_id oid,l.is_adjustment,d.created_at from public.transport_customer_documents d join public.transport_customer_document_trips l on l.document_id=d.id where p_side='customer' and l.trip_id=t.id
 union all
 select d.purchase_order_id,l.is_adjustment,d.created_at from public.transport_supplier_documents d join public.transport_supplier_document_rents l on l.document_id=d.id where p_side='supplier' and l.rent_id=x.id
 order by is_adjustment desc,created_at desc,oid
 loop
 if p_side='customer' then select sum(amount) into available from public.sales_service_lines where order_id=source.oid;
 else select sum(amount) into available from public.purchase_service_lines where order_id=source.oid;end if;
 available:=available-coalesce((select sum(net_amount) from public.transport_service_note_lines where order_id=source.oid and side=p_side),0);
 if available>0 and remaining>0 then
 r:=public.transport_post_service_note(p_side,source.oid,least(available,remaining),p_date,p_reason);
 evidence:=evidence||jsonb_build_array(r);remaining:=remaining-least(available,remaining);end if;
 end loop;
 if remaining>0.005 then raise exception 'Correction exceeds posted uncredited financial evidence'; end if;
 end if;
 insert into public.transport_rate_adjustments(company_id,business_unit_id,trip_id,rent_id,side,old_value,new_value,reason,reference,accounting_evidence,created_by)
 values(t.company_id,t.business_unit_id,t.id,p_rent_id,p_side,old_rate,round(p_new_rate,2),btrim(p_reason),p_reference,evidence,auth.uid()) returning id into aid;
 perform public.transport_financial_audit(t.id,'rate_adjustment',jsonb_build_object('adjustment_id',aid,'side',p_side,'rent_id',p_rent_id,'old_value',old_rate,'new_value',p_new_rate,'difference',diff,'reason',p_reason,'reference',p_reference,'accounting_evidence',evidence));
 return jsonb_build_object('success',true,'adjustment_id',aid,'old_value',old_rate,'new_value',p_new_rate,'difference',diff,'accounting_evidence',evidence);
end $function$
;
COMMIT;
