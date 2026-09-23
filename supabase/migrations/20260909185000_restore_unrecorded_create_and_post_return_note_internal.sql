-- This SECURITY DEFINER routine existed in production without a recorded creator.
-- Exact definition recovered read-only with pg_get_functiondef; later ACL and
-- hardening migrations remain authoritative.

CREATE OR REPLACE FUNCTION public.create_and_post_return_note_internal(p_note_type text, p_order_id uuid, p_note_date date, p_reason text, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := public.legacy_data_user_id();
  v_company uuid := public.current_company_id();
  v_note uuid; v_no text; v_seq integer;
  v_party uuid; v_party_name text;
  v_payment_mode text; v_payment_account uuid;
  v_sub numeric:=0; v_tax numeric:=0; v_total numeric:=0; v_cost numeric:=0;
  v_ar uuid; v_ap uuid; v_sales uuid; v_inventory uuid; v_cogs uuid; v_output_vat uuid; v_input_vat uuid; v_cash uuid; v_bank uuid;
  v_counter_account uuid; v_counter_text text;
  v_journal uuid; x jsonb; l record; v_qty numeric; v_prior numeric; v_wh uuid; v_cost_rate numeric;
begin
  if auth.uid() is null or v_uid is null or v_company is null or public.current_business_unit_id() is null then
    raise exception 'Authentication, active company and business unit are required.';
  end if;
  if p_note_type not in ('sales_credit','purchase_debit') then raise exception 'Invalid return note type.'; end if;
  if p_note_type='sales_credit' then
    perform public.assert_module_permission('sales','post');
  else
    perform public.assert_module_permission('purchase','post');
  end if;
  perform public.assert_module_permission('inventory','post');
  perform public.assert_module_permission('accounting','post');
  if p_order_id is null or p_note_date is null then raise exception 'Original invoice and note date are required.'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Return reason is required.'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'At least one return line is required.'; end if;

  if p_note_type='sales_credit' then
    select so.customer_id,c.name,lower(coalesce(so.payment_mode,'credit')),
           coalesce(so.payment_account_id,
             case when lower(coalesce(so.payment_mode,'credit'))='cash' then (select account_id from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='cash' limit 1)
                  when lower(coalesce(so.payment_mode,'credit'))='bank' then (select account_id from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='bank' limit 1)
             end)
      into v_party,v_party_name,v_payment_mode,v_payment_account
    from public.sales_orders so
    join public.customers c on c.id=so.customer_id and c.user_id=v_uid and c.company_id=v_company
    where so.id=p_order_id and so.user_id=v_uid and so.company_id=v_company and so.business_unit_id=public.current_business_unit_id() and so.status='posted'
    for update of so;
  else
    select po.supplier_id,s.name,'credit',null
      into v_party,v_party_name,v_payment_mode,v_payment_account
    from public.purchase_orders po
    join public.suppliers s on s.id=po.supplier_id and s.user_id=v_uid and s.company_id=v_company
    where po.id=p_order_id and po.user_id=v_uid and po.company_id=v_company and po.business_unit_id=public.current_business_unit_id() and po.status='posted'
    for update of po;
  end if;
  if v_party is null then raise exception 'Posted original invoice was not found in active company.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':'||p_note_type||':'||extract(year from p_note_date)::text,0));
  select coalesce(max(nullif(regexp_replace(note_no,'^.*-',''),'')::integer),0)+1 into v_seq
  from public.return_notes
  where user_id=v_uid and company_id=v_company and note_type=p_note_type and extract(year from note_date)=extract(year from p_note_date);
  v_no := (case when p_note_type='sales_credit' then 'CN-' else 'DN-' end)||to_char(p_note_date,'YYYY')||'-'||lpad(v_seq::text,4,'0');

  insert into public.return_notes(user_id,company_id,note_no,note_type,sales_order_id,purchase_order_id,party_type,party_id,party_name,note_date,reason,status,business_unit_id)
  values(v_uid,v_company,v_no,p_note_type,
         case when p_note_type='sales_credit' then p_order_id end,
         case when p_note_type='purchase_debit' then p_order_id end,
         case when p_note_type='sales_credit' then 'customer' else 'supplier' end,
         v_party,v_party_name,p_note_date,btrim(p_reason),'draft',public.current_business_unit_id())
  returning id into v_note;

  for x in select value from jsonb_array_elements(p_lines) loop
    v_qty := coalesce(nullif(x->>'qty','')::numeric,0);
    if v_qty<=0 then raise exception 'Every return quantity must be greater than zero.'; end if;
    if p_note_type='sales_credit' then
      select sol.id,sol.item_id,sol.godown_id,sol.qty,sol.unit_price as rate,sol.tax_percent,sol.unit_cost_at_posting,i.cost into l
      from public.sales_order_lines sol join public.items i on i.id=sol.item_id and i.company_id=v_company
      where sol.id=nullif(x->>'line_id','')::uuid and sol.order_id=p_order_id and sol.user_id=v_uid and sol.company_id=v_company and sol.business_unit_id=public.current_business_unit_id();
      if l.id is not null then v_cost_rate := coalesce(l.unit_cost_at_posting,greatest(coalesce(public.get_inventory_avg_cost(l.item_id),0),coalesce(l.cost,0),0)); end if;
    else
      select pol.id,pol.item_id,pol.godown_id,pol.qty,pol.unit_cost as rate,pol.tax_percent,pol.unit_cost as cost_rate into l
      from public.purchase_order_lines pol join public.items i on i.id=pol.item_id and i.company_id=v_company
      where pol.id=nullif(x->>'line_id','')::uuid and pol.order_id=p_order_id and pol.user_id=v_uid and pol.company_id=v_company and pol.business_unit_id=public.current_business_unit_id();
      if l.id is not null then v_cost_rate:=coalesce(l.cost_rate,0); end if;
    end if;
    if l.id is null or l.item_id is null or l.godown_id is null then raise exception 'Original invoice line, item or godown is missing.'; end if;
    select coalesce(sum(rnl.qty),0) into v_prior
    from public.return_note_lines rnl join public.return_notes rn on rn.id=rnl.note_id and rn.company_id=v_company
    where rnl.user_id=v_uid and rnl.company_id=v_company and rnl.original_line_id=l.id and rn.note_type=p_note_type and rn.status='posted';
    if v_prior+v_qty>l.qty+0.000001 then raise exception 'Return quantity exceeds remaining quantity for an invoice line.'; end if;
    select warehouse_id into v_wh from public.godowns where id=l.godown_id and company_id=v_company;
    if v_wh is null then raise exception 'Invoice line godown has no warehouse in active company.'; end if;
    insert into public.return_note_lines(user_id,company_id,note_id,original_line_id,item_id,godown_id,qty,unit_rate,tax_percent,line_subtotal,tax_amount,line_total,cost_rate,cost_total,business_unit_id)
    values(v_uid,v_company,v_note,l.id,l.item_id,l.godown_id,v_qty,l.rate,coalesce(l.tax_percent,0),round(v_qty*l.rate,2),round(v_qty*l.rate*coalesce(l.tax_percent,0)/100,2),round(v_qty*l.rate*(1+coalesce(l.tax_percent,0)/100),2),round(coalesce(v_cost_rate,0),4),round(v_qty*coalesce(v_cost_rate,0),2),public.current_business_unit_id());
    v_sub:=v_sub+round(v_qty*l.rate,2); v_tax:=v_tax+round(v_qty*l.rate*coalesce(l.tax_percent,0)/100,2); v_cost:=v_cost+round(v_qty*coalesce(v_cost_rate,0),2);
    perform public.apply_stock_movement(l.item_id,v_wh,l.godown_id,case when p_note_type='sales_credit' then 'sale_return' else 'purchase_return' end,v_qty,v_no);
  end loop;
  v_total:=round(v_sub+v_tax,2); if v_total<=0 then raise exception 'Return Note total must be greater than zero.'; end if;

  select account_id into v_ar from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='accounts_receivable' limit 1;
  select account_id into v_ap from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='accounts_payable' limit 1;
  select account_id into v_sales from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key in ('sales_revenue','sales') order by case mapping_key when 'sales_revenue' then 0 else 1 end limit 1;
  select account_id into v_inventory from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='inventory' limit 1;
  select account_id into v_cogs from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key in ('cogs','cost_of_goods_sold') order by case mapping_key when 'cogs' then 0 else 1 end limit 1;
  select account_id into v_output_vat from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='output_vat' limit 1;
  select account_id into v_input_vat from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='input_vat' limit 1;
  select account_id into v_cash from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='cash' limit 1;
  select account_id into v_bank from public.account_mappings where user_id=v_uid and company_id=v_company and mapping_key='bank' limit 1;
  if p_note_type='sales_credit' then
    if v_sales is null or v_inventory is null or v_cogs is null or (v_tax>0 and v_output_vat is null) then raise exception 'Sales return account mappings are incomplete.'; end if;
    if v_payment_mode='cash' then v_counter_account:=coalesce(v_payment_account,v_cash); elsif v_payment_mode='bank' then v_counter_account:=coalesce(v_payment_account,v_bank); else v_counter_account:=v_ar; end if;
    if v_counter_account is null then raise exception 'Sales return settlement account is not configured.'; end if;
  else
    if v_ap is null or v_inventory is null or (v_tax>0 and v_input_vat is null) then raise exception 'Purchase return account mappings are incomplete.'; end if; v_counter_account:=v_ap;
  end if;
  select code||' - '||name into v_counter_text from public.chart_of_accounts where id=v_counter_account and user_id=v_uid and company_id=v_company and is_active and not is_group;
  if v_counter_text is null then raise exception 'Return settlement account is invalid or inactive.'; end if;

  insert into public.journal_entries(user_id,company_id,business_unit_id,entry_no,entry_date,description,status,party_name,trans_type,payment_mode)
  values(v_uid,v_company,public.current_business_unit_id(),v_no,p_note_date,(case when p_note_type='sales_credit' then 'Sales Credit Note - ' else 'Purchase Debit Note - ' end)||v_party_name,'draft',v_party_name,case when p_note_type='sales_credit' then 'Sales Credit Note' else 'Purchase Debit Note' end,case when p_note_type='sales_credit' then initcap(v_payment_mode) else 'Credit' end)
  returning id into v_journal;

  if p_note_type='sales_credit' then
    insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account_id,account,debit,credit)
    select v_uid,v_company,public.current_business_unit_id(),v_journal,coa.id,coa.code||' - '||coa.name,v_sub,0 from public.chart_of_accounts coa where coa.id=v_sales and coa.company_id=v_company;
    if v_tax>0 then insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account_id,account,debit,credit) select v_uid,v_company,public.current_business_unit_id(),v_journal,coa.id,coa.code||' - '||coa.name,v_tax,0 from public.chart_of_accounts coa where coa.id=v_output_vat and coa.company_id=v_company; end if;
    if v_cost>0 then
      insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account_id,account,debit,credit) select v_uid,v_company,public.current_business_unit_id(),v_journal,coa.id,coa.code||' - '||coa.name,v_cost,0 from public.chart_of_accounts coa where coa.id=v_inventory and coa.company_id=v_company;
      insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account_id,account,debit,credit) select v_uid,v_company,public.current_business_unit_id(),v_journal,coa.id,coa.code||' - '||coa.name,0,v_cost from public.chart_of_accounts coa where coa.id=v_cogs and coa.company_id=v_company;
    end if;
    insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name)
    values(v_uid,v_company,public.current_business_unit_id(),v_journal,v_counter_account,v_counter_text,0,v_total,case when v_payment_mode not in ('cash','bank') then 'customer' end,case when v_payment_mode not in ('cash','bank') then v_party end,case when v_payment_mode not in ('cash','bank') then v_party_name end);
  else
    insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name) values(v_uid,v_company,public.current_business_unit_id(),v_journal,v_ap,v_counter_text,v_total,0,'supplier',v_party,v_party_name);
    insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account_id,account,debit,credit) select v_uid,v_company,public.current_business_unit_id(),v_journal,coa.id,coa.code||' - '||coa.name,0,v_sub from public.chart_of_accounts coa where coa.id=v_inventory and coa.company_id=v_company;
    if v_tax>0 then insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account_id,account,debit,credit) select v_uid,v_company,public.current_business_unit_id(),v_journal,coa.id,coa.code||' - '||coa.name,0,v_tax from public.chart_of_accounts coa where coa.id=v_input_vat and coa.company_id=v_company; end if;
  end if;
  perform public.post_journal_entry(v_journal);
  update public.return_notes set subtotal=round(v_sub,2),tax_total=round(v_tax,2),total=v_total,cost_total=round(v_cost,2),journal_entry_id=v_journal,status='posted',posted_at=now() where id=v_note and user_id=v_uid and company_id=v_company and business_unit_id=public.current_business_unit_id();
  if p_note_type='sales_credit' and v_payment_mode not in ('cash','bank') then
    update public.sales_orders set outstanding_amount=greatest(coalesce(outstanding_amount,0)-v_total,0),payment_status=case when greatest(coalesce(outstanding_amount,0)-v_total,0)<=0.005 then 'paid' when coalesce(paid_amount,0)=0 then 'unpaid' else 'partial' end where id=p_order_id and user_id=v_uid and company_id=v_company and business_unit_id=public.current_business_unit_id();
  elsif p_note_type='purchase_debit' then
    update public.purchase_orders set outstanding_amount=greatest(coalesce(outstanding_amount,0)-v_total,0),payment_status=case when greatest(coalesce(outstanding_amount,0)-v_total,0)<=0.005 then 'paid' when coalesce(paid_amount,0)=0 then 'unpaid' else 'partial' end where id=p_order_id and user_id=v_uid and company_id=v_company and business_unit_id=public.current_business_unit_id();
  end if;
  return jsonb_build_object('success',true,'note_id',v_note,'note_no',v_no,'journal_entry_id',v_journal,'subtotal',round(v_sub,2),'tax_total',round(v_tax,2),'cost_total',round(v_cost,2),'total',v_total,'settlement_mode',v_payment_mode);
end;
$function$

revoke all on function public.create_and_post_return_note_internal(text,uuid,date,text,jsonb) from public, anon;

