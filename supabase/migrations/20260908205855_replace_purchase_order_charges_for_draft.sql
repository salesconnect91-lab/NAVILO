create or replace function public.replace_purchase_order_charges(
  p_order_id uuid,
  p_charges jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_uid uuid := public.legacy_data_user_id();
  v_company uuid := public.current_company_id();
  v_bu uuid := public.current_business_unit_id();
  v_order public.purchase_orders%rowtype;
  v_row jsonb; v_master record; v_amount numeric; v_qty numeric; v_rate numeric; v_tax numeric;
  v_direct numeric:=0; v_direct_tax numeric:=0; v_linked numeric:=0; v_charge_total numeric:=0; v_charge_tax numeric:=0; v_total numeric:=0;
begin
  if auth.uid() is null or v_uid is null or v_company is null or v_bu is null then raise exception 'Authentication, active company and business unit are required.'; end if;
  perform public.assert_module_permission('purchase','edit');
  select * into v_order from public.purchase_orders where id=p_order_id and user_id=v_uid and company_id=v_company and business_unit_id=v_bu for update;
  if not found then raise exception 'Purchase Invoice not found in active business unit.'; end if;
  if v_order.status <> 'draft' then raise exception 'Only a draft Purchase Invoice can change charges.'; end if;
  if jsonb_typeof(coalesce(p_charges,'[]'::jsonb)) <> 'array' then raise exception 'Charges payload must be an array.'; end if;
  delete from public.purchase_order_charges where order_id=p_order_id and company_id=v_company and business_unit_id=v_bu;
  for v_row in select value from jsonb_array_elements(coalesce(p_charges,'[]'::jsonb)) loop
    v_amount:=greatest(coalesce(nullif(v_row->>'amount','')::numeric,0),0); if v_amount<=0 then continue; end if;
    select cm.charge_key,cm.charge_name,cm.tax_applicable,coalesce(cm.purchase_treatment,'landed_cost') as purchase_treatment,cm.cost_account_id into v_master
    from public.charge_master cm where cm.user_id=v_uid and cm.company_id=v_company and cm.charge_key=nullif(v_row->>'charge_key','') and cm.is_active and cm.applies_to in ('purchase','both') limit 1;
    if not found then raise exception 'Purchase charge % is not active in Charge Master.',coalesce(v_row->>'charge_key','(blank)'); end if;
    v_qty:=nullif(v_row->>'quantity','')::numeric; v_rate:=nullif(v_row->>'rate','')::numeric;
    v_tax:=case when v_order.invoice_type='Tax Invoice' and coalesce(v_master.tax_applicable,false) then coalesce(v_order.tax_percent,0) else 0 end;
    insert into public.purchase_order_charges(user_id,company_id,business_unit_id,order_id,charge_key,charge_label,amount,tax_percent,treatment,cost_account_id,quantity,rate)
    values(v_uid,v_company,v_bu,p_order_id,v_master.charge_key,v_master.charge_name,round(v_amount,2),v_tax,v_master.purchase_treatment,v_master.cost_account_id,v_qty,v_rate);
  end loop;
  select coalesce(sum(line_total),0),coalesce(sum(case when v_order.invoice_type='Tax Invoice' then line_total*coalesce(tax_percent,0)/100 else 0 end),0)
    into v_direct,v_direct_tax from public.purchase_order_lines where order_id=p_order_id and user_id=v_uid and company_id=v_company and business_unit_id=v_bu and source_consolidated_purchase_invoice_id is null;
  select coalesce(sum(ci.total),0) into v_linked from public.purchase_order_consolidated_invoices l join public.consolidated_purchase_invoices ci on ci.id=l.consolidated_invoice_id
    where l.purchase_order_id=p_order_id and l.company_id=v_company and l.business_unit_id=v_bu;
  select coalesce(sum(amount),0),coalesce(sum(case when v_order.invoice_type='Tax Invoice' then amount*tax_percent/100 else 0 end),0)
    into v_charge_total,v_charge_tax from public.purchase_order_charges where order_id=p_order_id and company_id=v_company and business_unit_id=v_bu;
  v_total:=round(v_direct+v_direct_tax+v_linked+v_charge_total+v_charge_tax,2);
  update public.purchase_orders set loading_charge=0,unloading_charge=0,cutting_charge=0,transport_charge=0,labour_charge=0,handling_charge=0,other_charge=0,total=v_total,updated_at=now(),updated_by=auth.uid()
    where id=p_order_id and company_id=v_company and business_unit_id=v_bu and status='draft';
  return jsonb_build_object('success',true,'order_id',p_order_id,'charges_total',round(v_charge_total,2),'charge_tax',round(v_charge_tax,2),'total',v_total);
end
$function$;
revoke all on function public.replace_purchase_order_charges(uuid,jsonb) from public;
grant execute on function public.replace_purchase_order_charges(uuid,jsonb) to authenticated;