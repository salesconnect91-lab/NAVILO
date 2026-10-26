-- Draft work follows view/create/edit/delete grants; posting remains a separate permission.
BEGIN;
CREATE OR REPLACE FUNCTION navilo_private.transport_draft_invoice_allowed(p_side text,p_action text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $allow$
DECLARE c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();v boolean;
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR public.current_operating_location_id() IS NULL
 OR p_side IS NULL OR p_side NOT IN ('customer','supplier') OR p_action IS NULL OR p_action NOT IN ('view','create','edit','delete') THEN RETURN false;END IF;
 IF NOT public.has_module_permission(c,'transport','view') OR NOT public.transport_financial_read_allowed(p_side)
 OR NOT public.has_module_permission(c,CASE WHEN p_side='customer' THEN 'sales' ELSE 'purchase' END,p_action) THEN RETURN false;END IF;
 SELECT allowed INTO v FROM public.transport_financial_permissions WHERE company_id=c AND business_unit_id=b AND user_id=auth.uid()
 AND action=CASE WHEN p_side='customer' THEN 'billing' ELSE 'rent' END;
 RETURN coalesce(v,true);
END $allow$;
REVOKE ALL ON FUNCTION navilo_private.transport_draft_invoice_allowed(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION navilo_private.transport_draft_invoice_allowed(text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.transport_draft_invoice_allowed(p_side text,p_action text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$ SELECT navilo_private.transport_draft_invoice_allowed(p_side,p_action) $$;
REVOKE ALL ON FUNCTION public.transport_draft_invoice_allowed(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_draft_invoice_allowed(text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.transport_assert_draft_invoice_access(p_side text,p_action text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT public.transport_draft_invoice_allowed(p_side,p_action) THEN RAISE EXCEPTION 'Draft invoice % permission required for the active workspace',p_action;END IF;
END $$;
REVOKE ALL ON FUNCTION public.transport_assert_draft_invoice_access(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_assert_draft_invoice_access(text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.transport_draft_invoice_permissions() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$ SELECT jsonb_build_object(
 'customer',jsonb_build_object('edit',public.transport_draft_invoice_allowed('customer','edit'),'delete',public.transport_draft_invoice_allowed('customer','delete'),'post',public.transport_finance_allowed('billing') AND public.has_module_permission(public.current_company_id(),'sales','post') AND public.has_module_permission(public.current_company_id(),'accounting','post')),
 'supplier',jsonb_build_object('edit',public.transport_draft_invoice_allowed('supplier','edit'),'delete',public.transport_draft_invoice_allowed('supplier','delete'),'post',public.transport_finance_allowed('rent') AND public.has_module_permission(public.current_company_id(),'purchase','post') AND public.has_module_permission(public.current_company_id(),'accounting','post'))) $$;
REVOKE ALL ON FUNCTION public.transport_draft_invoice_permissions() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_draft_invoice_permissions() TO authenticated;
CREATE OR REPLACE FUNCTION public.transport_register_draft_invoice_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_rows jsonb;
begin
  if auth.uid() is null or public.current_company_id() is null
     or public.current_business_unit_id() is null or public.current_operating_location_id() is null then
    raise exception 'Select an active Transport Register workspace';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.invoice_date desc,x.invoice_no), '[]'::jsonb)
    into v_rows
    from (
      select 'customer'::text side,d.id document_id,s.id order_id,s.order_no invoice_no,s.order_date invoice_date,
             c.name party_name,count(distinct l.trip_id)::integer trip_count,
             coalesce((select sum(x.amount) from public.sales_service_lines x where x.order_id=s.id),0)
               +coalesce((select sum(x.amount) from public.sales_order_charges x where x.order_id=s.id),0) net_amount,
             coalesce((select sum(round(x.amount*coalesce(x.tax_percent,0)/100,2)) from public.sales_service_lines x where x.order_id=s.id),0)
               +coalesce((select sum(round(x.amount*coalesce(x.tax_percent,0)/100,2)) from public.sales_order_charges x where x.order_id=s.id),0) vat_amount
        from public.transport_customer_documents d
        join public.sales_orders s on s.id=d.sales_order_id
        join public.customers c on c.id=d.customer_id
        left join public.transport_customer_document_trips l on l.document_id=d.id and not l.is_adjustment
       where public.transport_draft_invoice_allowed('customer','view')
         and d.company_id=public.current_company_id() and d.business_unit_id=public.current_business_unit_id()
         and d.operating_location_id=public.current_operating_location_id()
         and d.journal_entry_id is null and s.status='draft' and s.document_kind='service'
       group by d.id,s.id,c.name
      union all
      select 'supplier'::text side,d.id document_id,p.id order_id,p.order_no invoice_no,p.order_date invoice_date,
             sp.name party_name,count(distinct l.rent_id)::integer trip_count,
             coalesce((select sum(x.amount) from public.purchase_service_lines x where x.order_id=p.id),0)
               +coalesce((select sum(x.amount) from public.purchase_order_charges x where x.order_id=p.id),0) net_amount,
             coalesce((select sum(round(x.amount*coalesce(x.tax_percent,0)/100,2)) from public.purchase_service_lines x where x.order_id=p.id),0)
               +coalesce((select sum(round(x.amount*coalesce(x.tax_percent,0)/100,2)) from public.purchase_order_charges x where x.order_id=p.id),0) vat_amount
        from public.transport_supplier_documents d
        join public.purchase_orders p on p.id=d.purchase_order_id
        join public.suppliers sp on sp.id=d.supplier_id
        left join public.transport_supplier_document_rents l on l.document_id=d.id and not l.is_adjustment
       where public.transport_draft_invoice_allowed('supplier','view')
         and d.company_id=public.current_company_id() and d.business_unit_id=public.current_business_unit_id()
         and d.operating_location_id=public.current_operating_location_id()
         and d.journal_entry_id is null and p.status='draft' and p.document_kind='service'
       group by d.id,p.id,sp.name
    ) x;
  return jsonb_build_object('rows',v_rows);
end $function$
;
CREATE OR REPLACE FUNCTION public.transport_create_customer_draft_grouped(p_trip_ids uuid[], p_date date, p_revenue_account_id uuid, p_with_tax boolean DEFAULT false, p_invoice_no text DEFAULT NULL::text, p_descriptions jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  loc uuid:=public.current_operating_location_id();
  u uuid:=public.legacy_data_user_id();
  v_expected int;
  v_count int;
  v_party_count int;
  v_sale_type_count int;
  v_null_party boolean;
  v_null_sale_type boolean;
  v_customer uuid;
  v_sale_type text;
  v_base_currency text;
  v_tax numeric;
  v_number text;
  v_order uuid;
  v_doc uuid;
  v_post jsonb;
  v_expected_net numeric:=0;
  v_base numeric;
  v_charge numeric;
  v_line_vat numeric;
  v_description text;
  t public.transport_trips%rowtype;
  r record;
begin
  if p_trip_ids is null or cardinality(p_trip_ids)=0 or p_date is null then
    raise exception 'Select one or more Transport trips and an invoice date';
  end if;
  if cardinality(p_trip_ids)>500 then
    raise exception 'A Transport invoice can include at most 500 trips';
  end if;
  if loc is null then
    raise exception 'Active operating location required';
  end if;

  select count(distinct x) into v_expected from unnest(p_trip_ids) x;
  if v_expected<>cardinality(p_trip_ids) then
    raise exception 'Duplicate Trip selection is not allowed';
  end if;

  perform public.transport_assert_draft_invoice_access('customer','create');
  perform public.assert_module_permission('sales','create');

  if p_revenue_account_id is null or not exists(select 1 from public.account_mappings am where am.company_id=c and am.mapping_key='service_revenue' and am.account_id=p_revenue_account_id)
     or not exists(
       select 1 from public.chart_of_accounts a
       where a.id=p_revenue_account_id
         and a.company_id=c
         and a.type='revenue'
         and a.is_active
         and not a.is_group
     )
  then
    raise exception 'Active same-company revenue account required';
  end if;

  perform 1
  from public.transport_trips t0
  where t0.id=any(p_trip_ids)
    and t0.company_id=c
    and t0.business_unit_id=b
  order by t0.id
  for update;

  select count(*),
         count(distinct customer_id),
         count(distinct sale_type),
         bool_or(customer_id is null),
         bool_or(sale_type is null),
         (array_agg(customer_id order by id))[1],
         (array_agg(sale_type order by id))[1]
    into v_count,v_party_count,v_sale_type_count,v_null_party,v_null_sale_type,v_customer,v_sale_type
  from public.transport_trips
  where id=any(p_trip_ids)
    and company_id=c
    and business_unit_id=b;

  if v_count<>v_expected then
    raise exception 'All selected trips must belong to the active Company and Business Unit';
  end if;
  if v_null_party or v_party_count<>1 then
    raise exception 'One customer is required per Transport invoice';
  end if;
  if v_null_sale_type or v_sale_type_count<>1 or v_sale_type not in ('cash','credit') then
    raise exception 'Selected trips must use one Cash/Credit sale type per invoice';
  end if;

  if v_sale_type = 'credit' and (nullif(btrim(p_invoice_no),'') is null or btrim(p_invoice_no) like 'H-S-%') then
    raise exception 'Credit Transport Sales invoice requires your original invoice number before posting';
  end if;

  select base_currency_code into v_base_currency from public.companies where id=c;
  p_with_tax:=public.transport_party_billing_mode('customer',c,b,v_customer)='Credit';
v_tax:=case when p_with_tax then public.fixed_tax_rate_on(c,'sales',p_date) else 0 end;
  if v_tax is null then raise exception 'Effective fixed VAT rate required'; end if;
  v_number:=public.transport_choose_invoice_number('customer',p_invoice_no);

  for t in
    select *
    from public.transport_trips
    where id=any(p_trip_ids)
      and company_id=c
      and business_unit_id=b
    order by trip_no,id
  loop
    if t.lifecycle_status='cancelled' or t.status='cancelled' then
      raise exception 'Active Transport Trip in current workspace required';
    end if;
    if t.customer_rate_state is distinct from 'finalized'
       or t.customer_rate_snapshot is null
       or t.customer_rate_snapshot is distinct from t.customer_rate
       or t.customer_rate<=0
    then
      raise exception 'Consistent finalized customer rate snapshot required for Trip %',t.trip_no;
    end if;
    if t.sales_order_id is not null
       or exists(
         select 1
         from public.transport_customer_document_trips l
         where l.trip_id=t.id and not l.is_adjustment
       )
    then
      raise exception 'Trip % is already billed',t.trip_no;
    end if;

    v_base:=coalesce(t.customer_base_rate,t.customer_rate)+coalesce(t.customer_manual_adjustment,0);
    if coalesce(v_base,0)<=0 then
      raise exception 'Positive base customer service amount required for Trip %',t.trip_no;
    end if;

    select coalesce(sum(tc.amount),0)
      into v_charge
    from public.transport_trip_customer_charges tc
    join public.charge_master cm on cm.id=tc.charge_master_id
    where tc.trip_id=t.id
      and cm.company_id=c
      and cm.is_active
      and cm.applies_to in ('sales','both');

    if round(v_base+v_charge,2) is distinct from round(t.customer_rate_snapshot,2) then
      raise exception 'Customer base + charges does not reconcile to finalized Trip rate for %',t.trip_no;
    end if;

    v_description:=nullif(btrim(coalesce(p_descriptions->>t.id::text,'')),'');
    if length(coalesce(v_description,''))>2000 then
      raise exception 'Invoice description must be at most 2000 characters for Trip %',t.trip_no;
    end if;
    v_expected_net:=v_expected_net+t.customer_rate_snapshot;
  end loop;

  insert into public.sales_orders(
    user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,order_date,
    status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,payment_mode
  )
  values(
    u,c,b,loc,v_number,v_customer,p_date,'draft',
    case when p_with_tax then 'Tax Invoice' else 'Sale Invoice' end,
    v_tax,v_base_currency,1,'service',initcap(v_sale_type)
  )
  returning id into v_order;

  for t in
    select *
    from public.transport_trips
    where id=any(p_trip_ids)
      and company_id=c
      and business_unit_id=b
    order by trip_no,id
  loop
    v_base:=coalesce(t.customer_base_rate,t.customer_rate)+coalesce(t.customer_manual_adjustment,0);
    v_description:=nullif(btrim(coalesce(p_descriptions->>t.id::text,'')),'');
    insert into public.sales_service_lines(
      company_id,business_unit_id,order_id,description,amount,tax_percent,revenue_account_id,
      source_module,source_id,created_by
    )
    values(
      c,b,v_order,
      concat_ws(E'\n',v_description,public.transport_trip_service_description(t.id)),
      round(v_base,2),v_tax,public.transport_trip_customer_income_account(t.id,p_revenue_account_id),'transport',t.id,auth.uid()
    );
  end loop;

  insert into public.sales_order_charges(
    order_id,charge_key,charge_label,amount,tax_percent,account_id,charge_type,
    cost_amount,cost_account_id,company_id,business_unit_id,quantity,rate
  )
  select
    v_order,
    cm.charge_key,
    cm.charge_name,
    round(sum(tc.amount),2),
    case when p_with_tax and cm.tax_applicable then v_tax else 0 end,
    public.transport_trip_customer_income_account(tc.trip_id,p_revenue_account_id),
    'recovery',
    0,
    cm.cost_account_id,
    c,b,
    case when cm.is_fixed then count(*)::numeric else 1 end,
    case when cm.is_fixed then cm.default_rate else round(sum(tc.amount),2) end
  from public.transport_trip_customer_charges tc
  join public.charge_master cm on cm.id=tc.charge_master_id
  where tc.trip_id=any(p_trip_ids)
    and tc.company_id=c
    and tc.business_unit_id=b
    and cm.company_id=c
    and cm.is_active
    and cm.applies_to in ('sales','both')
  group by cm.id,cm.charge_key,cm.charge_name,cm.revenue_account_id,cm.cost_account_id,
           cm.tax_applicable,cm.is_fixed,cm.default_rate,
           public.transport_trip_customer_income_account(tc.trip_id,p_revenue_account_id);

  if exists(
    select 1
    from public.sales_order_charges x
    where x.order_id=v_order and x.account_id is null
  ) then
    raise exception 'Every customer charge requires a revenue account mapping';
  end if;

  
      select jsonb_build_object(
        'status','draft',
        'order_id',v_order,
        'subtotal_excluding_vat',coalesce(sum(amount),0),
        'vat',coalesce(sum(round(amount*tax_percent/100,2)),0),
        'total',coalesce(sum(amount+round(amount*tax_percent/100,2)),0)
      ) into v_post
      from (
        select amount,tax_percent from public.sales_service_lines where order_id=v_order
        union all
        select amount,tax_percent from public.sales_order_charges where order_id=v_order
      ) draft_totals;
      

  if round(coalesce((v_post->>'subtotal_excluding_vat')::numeric,0),2)
     is distinct from round(v_expected_net,2)
  then
    raise exception 'Grouped customer invoice total does not reconcile to selected Trip totals';
  end if;

  insert into public.transport_customer_documents(
    company_id,business_unit_id,operating_location_id,customer_id,document_kind,
    sales_order_id,journal_entry_id,created_by
  )
  values(
    c,b,loc,v_customer,
    case when v_sale_type='cash' then 'cash_hand_bill' else 'credit' end,
    v_order,null::uuid,auth.uid()
  )
  returning id into v_doc;

  for t in
    select *
    from public.transport_trips
    where id=any(p_trip_ids)
      and company_id=c
      and business_unit_id=b
    order by trip_no,id
  loop
    v_base:=coalesce(t.customer_base_rate,t.customer_rate)+coalesce(t.customer_manual_adjustment,0);
    select
      round(v_base*v_tax/100,2)
      + coalesce(sum(
          case when p_with_tax and cm.tax_applicable
               then round(tc.amount*v_tax/100,2)
               else 0 end
        ),0)
      into v_line_vat
    from public.transport_trip_customer_charges tc
    join public.charge_master cm on cm.id=tc.charge_master_id
    where tc.trip_id=t.id
      and cm.company_id=c
      and cm.is_active
      and cm.applies_to in ('sales','both');

    insert into public.transport_customer_document_trips(
      company_id,business_unit_id,operating_location_id,document_id,trip_id,rate_snapshot,vat_snapshot
    )
    values(c,b,loc,v_doc,t.id,t.customer_rate_snapshot,coalesce(v_line_vat,round(v_base*v_tax/100,2)));

    perform public.transport_financial_audit(
      t.id,'customer_bill_draft_created',
      v_post||jsonb_build_object(
        'transport_document_id',v_doc,
        'sale_type',v_sale_type,
        'revenue_account_id',public.transport_trip_customer_income_account(t.id,p_revenue_account_id),
        'service_revenue_account_id',p_revenue_account_id,
        'grouped_invoice',true,'status','draft',
        'grouped_trip_count',v_expected,
        'invoice_no',v_number
      )
    );
  end loop;

  update public.transport_customer_document_trips l
     set vat_snapshot=round(l.vat_snapshot + (
       coalesce((v_post->>'vat')::numeric,0)
       - coalesce((select sum(evidence.vat_snapshot) from public.transport_customer_document_trips evidence where evidence.document_id=v_doc),0)
     ),2)
   where l.id=(select evidence.id from public.transport_customer_document_trips evidence where evidence.document_id=v_doc order by evidence.id desc limit 1)
     and abs(coalesce((v_post->>'vat')::numeric,0)-coalesce((select sum(evidence.vat_snapshot) from public.transport_customer_document_trips evidence where evidence.document_id=v_doc),0))>=0.005;

  update public.transport_supplier_document_rents l
     set vat_snapshot=round(l.vat_snapshot + (
       coalesce((v_post->>'vat')::numeric,0)
       - coalesce((select sum(evidence.vat_snapshot) from public.transport_supplier_document_rents evidence where evidence.document_id=v_doc),0)
     ),2)
   where l.id=(select evidence.id from public.transport_supplier_document_rents evidence where evidence.document_id=v_doc order by evidence.id desc limit 1)
     and abs(coalesce((v_post->>'vat')::numeric,0)-coalesce((select sum(evidence.vat_snapshot) from public.transport_supplier_document_rents evidence where evidence.document_id=v_doc),0))>=0.005;

  return v_post||jsonb_build_object(
    'transport_document_id',v_doc,
    'invoice_no',v_number,
    'grouped_invoice',true,'status','draft',
    'trip_count',v_expected,
    'revenue_account_id',p_revenue_account_id
  );
end
$function$
;
CREATE OR REPLACE FUNCTION public.transport_create_supplier_draft_grouped(p_rent_ids uuid[], p_date date, p_cost_account_id uuid, p_with_tax boolean DEFAULT false, p_reference text DEFAULT NULL::text, p_invoice_no text DEFAULT NULL::text, p_descriptions jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  loc uuid:=public.current_operating_location_id();
  u uuid:=public.legacy_data_user_id();
  v_expected int;
  v_count int;
  v_party_count int;
  v_null_party boolean;
  v_supplier uuid;
  v_base_currency text;
  v_tax numeric;
  v_number text;
  v_order uuid;
  v_doc uuid;
  v_post jsonb;
  v_expected_net numeric:=0;
  v_base numeric;
  v_charge numeric;
  v_line_vat numeric;
  v_description text;
  x public.transport_trip_supplier_rents%rowtype;
  t public.transport_trips%rowtype;
begin
  if p_rent_ids is null or cardinality(p_rent_ids)=0 or p_date is null then
    raise exception 'Select one or more finalized supplier rents and an invoice date';
  end if;
  if cardinality(p_rent_ids)>500 then
    raise exception 'A Transport supplier invoice can include at most 500 rent lines';
  end if;
  if loc is null then
    raise exception 'Active operating location required';
  end if;

  select count(distinct x0) into v_expected from unnest(p_rent_ids) x0;
  if v_expected<>cardinality(p_rent_ids) then
    raise exception 'Duplicate supplier rent selection is not allowed';
  end if;

  perform public.transport_assert_draft_invoice_access('supplier','create');
  perform public.assert_module_permission('purchase','create');

  if p_cost_account_id is null
     or not exists(
       select 1 from public.chart_of_accounts a
       where a.id=p_cost_account_id
         and a.company_id=c
         and a.type='expense'
         and a.is_active
         and not a.is_group
     )
  then
    raise exception 'Active same-company expense account required';
  end if;

  perform 1
  from public.transport_trip_supplier_rents r0
  where r0.id=any(p_rent_ids)
    and r0.company_id=c
    and r0.business_unit_id=b
  order by r0.id
  for update;

  select count(*),
         count(distinct supplier_id),
         bool_or(supplier_id is null),
         (array_agg(supplier_id order by id))[1]
    into v_count,v_party_count,v_null_party,v_supplier
  from public.transport_trip_supplier_rents
  where id=any(p_rent_ids)
    and company_id=c
    and business_unit_id=b;

  if v_count<>v_expected then
    raise exception 'All selected supplier rents must belong to the active Company and Business Unit';
  end if;
  if v_null_party or v_party_count<>1 then
    raise exception 'One supplier is required per Transport supplier invoice';
  end if;

  select base_currency_code into v_base_currency from public.companies where id=c;
  p_with_tax:=public.transport_party_billing_mode('supplier',c,b,v_supplier)='Credit';
v_tax:=case when p_with_tax then public.fixed_tax_rate_on(c,'purchase',p_date) else 0 end;
  if v_tax is null then raise exception 'Effective fixed VAT rate required'; end if;
  v_number:=public.transport_choose_invoice_number('supplier',p_invoice_no);

  for x in
    select *
    from public.transport_trip_supplier_rents
    where id=any(p_rent_ids)
      and company_id=c
      and business_unit_id=b
    order by created_at,id
  loop
    t:=public.transport_financial_trip(x.trip_id);

    if x.state is distinct from 'finalized'
       or x.finalized_amount_snapshot is null
       or x.finalized_amount_snapshot is distinct from x.amount
       or x.finalized_amount_snapshot<=0
    then
      raise exception 'Consistent positive finalized supplier rent snapshot required for Trip %',t.trip_no;
    end if;

    if exists(
      select 1
      from public.transport_supplier_document_rents l
      where l.rent_id=x.id and not l.is_adjustment
    ) then
      raise exception 'Supplier rent for Trip % is already billed',t.trip_no;
    end if;

    v_base:=coalesce(x.finalized_base_amount_snapshot,x.base_amount,x.finalized_amount_snapshot);
    if coalesce(v_base,0)<=0 then
      raise exception 'Positive base supplier service amount required for Trip %',t.trip_no;
    end if;

    select coalesce(sum(sc.amount),0)
      into v_charge
    from public.transport_trip_supplier_charges sc
    join public.charge_master cm on cm.id=sc.charge_master_id
    where sc.rent_id=x.id
      and sc.trip_id=x.trip_id
      and cm.company_id=c
      and cm.is_active
      and cm.applies_to in ('purchase','both');

    if round(v_base+v_charge,2) is distinct from round(x.finalized_amount_snapshot,2) then
      raise exception 'Supplier base rent + charges does not reconcile to finalized total rent for Trip %',t.trip_no;
    end if;

    v_description:=nullif(btrim(coalesce(p_descriptions->>x.id::text,'')),'');
    if length(coalesce(v_description,''))>2000 then
      raise exception 'Invoice description must be at most 2000 characters for Trip %',t.trip_no;
    end if;

    v_expected_net:=v_expected_net+x.finalized_amount_snapshot;
  end loop;

  insert into public.purchase_orders(
    user_id,company_id,business_unit_id,operating_location_id,order_no,supplier_id,order_date,
    status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,
    supplier_invoice_no,supplier_invoice_date
  )
  values(
    u,c,b,loc,v_number,v_supplier,p_date,'draft',
    case when p_with_tax then 'Tax Invoice' else 'Purchase Invoice' end,
    v_tax,v_base_currency,1,'service',
    coalesce(nullif(btrim(p_reference),''),'TR-'||substr(gen_random_uuid()::text,1,12)),
    p_date
  )
  returning id into v_order;

  for x in
    select *
    from public.transport_trip_supplier_rents
    where id=any(p_rent_ids)
      and company_id=c
      and business_unit_id=b
    order by created_at,id
  loop
    t:=public.transport_financial_trip(x.trip_id);
    v_base:=coalesce(x.finalized_base_amount_snapshot,x.base_amount,x.finalized_amount_snapshot);
    v_description:=nullif(btrim(coalesce(p_descriptions->>x.id::text,'')),'');
    insert into public.purchase_service_lines(
      company_id,business_unit_id,order_id,description,amount,tax_percent,cost_account_id,
      source_module,source_id,created_by
    )
    values(
      c,b,v_order,
      concat_ws(E'\n',v_description,public.transport_trip_service_description(t.id)||' · Supplier rent'),
      round(v_base,2),v_tax,p_cost_account_id,'transport',t.id,auth.uid()
    );
  end loop;

  insert into public.purchase_order_charges(
    user_id,company_id,business_unit_id,order_id,charge_key,charge_label,amount,tax_percent,
    treatment,cost_account_id,quantity,rate
  )
  select
    u,c,b,v_order,
    cm.charge_key,
    cm.charge_name,
    round(sum(sc.amount),2),
    case when p_with_tax and cm.tax_applicable then v_tax else 0 end,
    coalesce(cm.purchase_treatment,'expense'),
    cm.cost_account_id,
    case when cm.is_fixed then count(*)::numeric else 1 end,
    case when cm.is_fixed then cm.default_rate else round(sum(sc.amount),2) end
  from public.transport_trip_supplier_charges sc
  join public.charge_master cm on cm.id=sc.charge_master_id
  where sc.rent_id=any(p_rent_ids)
    and sc.company_id=c
    and sc.business_unit_id=b
    and cm.company_id=c
    and cm.is_active
    and cm.applies_to in ('purchase','both')
  group by cm.id,cm.charge_key,cm.charge_name,cm.tax_applicable,cm.purchase_treatment,
           cm.cost_account_id,cm.is_fixed,cm.default_rate;

  if exists(
    select 1
    from public.purchase_order_charges x0
    where x0.order_id=v_order and x0.cost_account_id is null
  ) then
    raise exception 'Every supplier charge requires a cost account mapping';
  end if;

  
      select jsonb_build_object(
        'status','draft',
        'order_id',v_order,
        'subtotal_excluding_vat',coalesce(sum(amount),0),
        'vat',coalesce(sum(round(amount*tax_percent/100,2)),0),
        'total',coalesce(sum(amount+round(amount*tax_percent/100,2)),0)
      ) into v_post
      from (
        select amount,tax_percent from public.purchase_service_lines where order_id=v_order
        union all
        select amount,tax_percent from public.purchase_order_charges where order_id=v_order
      ) draft_totals;
      

  if round(coalesce((v_post->>'subtotal_excluding_vat')::numeric,0),2)
     is distinct from round(v_expected_net,2)
  then
    raise exception 'Grouped supplier invoice total does not reconcile to selected rent totals';
  end if;

  insert into public.transport_supplier_documents(
    company_id,business_unit_id,operating_location_id,supplier_id,purchase_order_id,journal_entry_id,created_by
  )
  values(c,b,loc,v_supplier,v_order,null::uuid,auth.uid())
  returning id into v_doc;

  for x in
    select *
    from public.transport_trip_supplier_rents
    where id=any(p_rent_ids)
      and company_id=c
      and business_unit_id=b
    order by created_at,id
  loop
    t:=public.transport_financial_trip(x.trip_id);
    v_base:=coalesce(x.finalized_base_amount_snapshot,x.base_amount,x.finalized_amount_snapshot);

    select
      round(v_base*v_tax/100,2)
      + coalesce(sum(
          case when p_with_tax and cm.tax_applicable
               then round(sc.amount*v_tax/100,2)
               else 0 end
        ),0)
      into v_line_vat
    from public.transport_trip_supplier_charges sc
    join public.charge_master cm on cm.id=sc.charge_master_id
    where sc.rent_id=x.id
      and sc.trip_id=x.trip_id
      and cm.company_id=c
      and cm.is_active
      and cm.applies_to in ('purchase','both');

    insert into public.transport_supplier_document_rents(
      company_id,business_unit_id,operating_location_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot
    )
    values(c,b,loc,v_doc,x.id,t.id,x.finalized_amount_snapshot,coalesce(v_line_vat,round(v_base*v_tax/100,2)));

    perform public.transport_financial_audit(
      t.id,'supplier_bill_draft_created',
      v_post||jsonb_build_object(
        'rent_id',x.id,
        'transport_document_id',v_doc,
        'grouped_invoice',true,'status','draft',
        'grouped_rent_count',v_expected,
        'invoice_no',v_number
      )
    );
  end loop;

  return v_post||jsonb_build_object(
    'transport_document_id',v_doc,
    'invoice_no',v_number,
    'grouped_invoice',true,'status','draft',
    'rent_count',v_expected,
    'cost_account_id',p_cost_account_id
  );
end
$function$
;
CREATE OR REPLACE FUNCTION public.transport_refresh_draft_invoice(p_side text, p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 v_order_id uuid; v_invoice_no text; v_invoice_date date; v_account_id uuid;
 v_line_ids uuid[]; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF p_side='customer' THEN
  PERFORM public.transport_assert_draft_invoice_access('customer','edit');
  PERFORM public.assert_module_permission('sales','edit');
  SELECT d.sales_order_id,o.order_no,o.order_date INTO v_order_id,v_invoice_no,v_invoice_date
   FROM public.transport_customer_documents d JOIN public.sales_orders o ON o.id=d.sales_order_id
   WHERE d.id=p_document_id AND d.company_id=public.current_company_id()
    AND d.business_unit_id=public.current_business_unit_id()
    AND d.operating_location_id=public.current_operating_location_id()
    AND d.journal_entry_id IS NULL AND o.status='draft' AND o.document_kind='service' AND o.posted_at IS NULL
   FOR UPDATE OF d,o;
  IF FOUND THEN
   SELECT (SELECT sl.revenue_account_id FROM public.sales_service_lines sl WHERE sl.order_id=v_order_id ORDER BY sl.created_at,sl.id LIMIT 1),
    coalesce(array_agg(l.trip_id ORDER BY l.trip_id),'{}'::uuid[])
    INTO v_account_id,v_line_ids FROM public.transport_customer_document_trips l
    WHERE l.document_id=p_document_id AND NOT l.is_adjustment;
  END IF;
 ELSIF p_side='supplier' THEN
  PERFORM public.transport_assert_draft_invoice_access('supplier','edit');
  PERFORM public.assert_module_permission('purchase','edit');
  SELECT d.purchase_order_id,o.order_no,o.order_date INTO v_order_id,v_invoice_no,v_invoice_date
   FROM public.transport_supplier_documents d JOIN public.purchase_orders o ON o.id=d.purchase_order_id
   WHERE d.id=p_document_id AND d.company_id=public.current_company_id()
    AND d.business_unit_id=public.current_business_unit_id()
    AND d.operating_location_id=public.current_operating_location_id()
    AND d.journal_entry_id IS NULL AND o.status='draft' AND o.document_kind='service' AND o.posted_at IS NULL
   FOR UPDATE OF d,o;
  IF FOUND THEN
   SELECT (SELECT sl.cost_account_id FROM public.purchase_service_lines sl WHERE sl.order_id=v_order_id ORDER BY sl.created_at,sl.id LIMIT 1),
    coalesce(array_agg(l.rent_id ORDER BY l.rent_id),'{}'::uuid[])
    INTO v_account_id,v_line_ids FROM public.transport_supplier_document_rents l
    WHERE l.document_id=p_document_id AND NOT l.is_adjustment;
  END IF;
 ELSE
  RAISE EXCEPTION 'Invoice side must be customer or supplier';
 END IF;
 IF v_order_id IS NULL THEN RAISE EXCEPTION 'Draft Register invoice not found in active workspace'; END IF;
 IF cardinality(v_line_ids)=0 THEN RAISE EXCEPTION 'Draft invoice has no linked Trips'; END IF;
 IF v_account_id IS NULL THEN RAISE EXCEPTION 'Draft invoice has no mapped revenue or expense account'; END IF;
 v_result:=public.transport_edit_register_draft_invoice(p_side,p_document_id,v_line_ids,v_invoice_date,v_invoice_no,v_account_id);
 RETURN jsonb_build_object('status','refreshed','order_id',v_order_id,'line_count',cardinality(v_line_ids),'rebuild',v_result);
END
$function$
;
CREATE OR REPLACE FUNCTION public.transport_delete_register_draft_invoice(p_side text, p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_order_id uuid; v_deleted boolean; v_doc_company uuid; v_doc_bu uuid; v_doc_location uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_side = 'customer' THEN
    PERFORM public.transport_assert_draft_invoice_access('customer','delete');
    SELECT d.sales_order_id, d.company_id, d.business_unit_id, d.operating_location_id
      INTO v_order_id, v_doc_company, v_doc_bu, v_doc_location
      FROM public.transport_customer_documents d
      JOIN public.sales_orders o ON o.id = d.sales_order_id
     WHERE d.id = p_document_id AND d.company_id = public.current_company_id()
       AND d.business_unit_id = public.current_business_unit_id()
       AND d.operating_location_id = public.current_operating_location_id()
       AND d.journal_entry_id IS NULL AND o.status = 'draft' AND o.posted_at IS NULL
       AND o.document_kind = 'service'
     FOR UPDATE OF d, o;
    IF NOT FOUND THEN RAISE EXCEPTION 'Draft customer invoice not found in active Register'; END IF;
    INSERT INTO public.sales_draft_delete_gate(transaction_id, sales_order_id, company_id, business_unit_id, requested_by)
    VALUES (txid_current(), v_order_id, v_doc_company, v_doc_bu, auth.uid())
    ON CONFLICT (transaction_id, sales_order_id) DO NOTHING;
    INSERT INTO public.transport_action_gate(transaction_id, trip_id, action)
      SELECT txid_current(), l.trip_id, 'draft_invoice_delete'
        FROM public.transport_customer_document_trips l WHERE l.document_id = p_document_id
      UNION SELECT txid_current(), p_document_id, 'draft_invoice_delete'
      ON CONFLICT DO NOTHING;
    DELETE FROM public.sales_service_lines WHERE order_id = v_order_id;
    DELETE FROM public.sales_order_charges WHERE order_id = v_order_id;
    DELETE FROM public.transport_customer_document_trips WHERE document_id = p_document_id;
    DELETE FROM public.transport_customer_documents WHERE id = p_document_id;
    DELETE FROM public.sales_draft_delete_gate WHERE transaction_id = txid_current() AND sales_order_id = v_order_id;
    v_deleted := public.delete_draft_sales_invoice(v_order_id);
  ELSIF p_side = 'supplier' THEN
    PERFORM public.transport_assert_draft_invoice_access('supplier','delete');
    SELECT d.purchase_order_id, d.company_id, d.business_unit_id, d.operating_location_id
      INTO v_order_id, v_doc_company, v_doc_bu, v_doc_location
      FROM public.transport_supplier_documents d
      JOIN public.purchase_orders o ON o.id = d.purchase_order_id
     WHERE d.id = p_document_id AND d.company_id = public.current_company_id()
       AND d.business_unit_id = public.current_business_unit_id()
       AND d.operating_location_id = public.current_operating_location_id()
       AND d.journal_entry_id IS NULL AND o.status = 'draft' AND o.posted_at IS NULL
       AND o.document_kind = 'service'
     FOR UPDATE OF d, o;
    IF NOT FOUND THEN RAISE EXCEPTION 'Draft supplier invoice not found in active Register'; END IF;
    INSERT INTO public.purchase_draft_delete_gate(transaction_id, purchase_order_id, company_id, business_unit_id, requested_by)
    VALUES (txid_current(), v_order_id, v_doc_company, v_doc_bu, auth.uid())
    ON CONFLICT (transaction_id, purchase_order_id) DO NOTHING;
    INSERT INTO public.transport_action_gate(transaction_id, trip_id, action)
      SELECT txid_current(), l.trip_id, 'draft_invoice_delete'
        FROM public.transport_supplier_document_rents l WHERE l.document_id = p_document_id
      UNION SELECT txid_current(), p_document_id, 'draft_invoice_delete'
      ON CONFLICT DO NOTHING;
    DELETE FROM public.purchase_service_lines WHERE order_id = v_order_id;
    DELETE FROM public.purchase_order_charges WHERE order_id = v_order_id;
    DELETE FROM public.transport_supplier_document_rents WHERE document_id = p_document_id;
    DELETE FROM public.transport_supplier_documents WHERE id = p_document_id;
    DELETE FROM public.purchase_draft_delete_gate WHERE transaction_id = txid_current() AND purchase_order_id = v_order_id;
    v_deleted := public.delete_draft_purchase_invoice(v_order_id);
  ELSE
    RAISE EXCEPTION 'Invoice side must be customer or supplier';
  END IF;
  IF NOT coalesce(v_deleted, false) THEN RAISE EXCEPTION 'Draft invoice could not be deleted'; END IF;
  DELETE FROM public.transport_action_gate WHERE transaction_id = txid_current() AND action = 'draft_invoice_delete';
  RETURN jsonb_build_object('deleted', true, 'document_id', p_document_id, 'side', p_side);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transport_register_draft_invoice_edit_context(p_side text, p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_order uuid; v_context jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_side='customer' THEN
    PERFORM public.transport_assert_draft_invoice_access('customer','edit');
    PERFORM public.assert_module_permission('sales','edit');
    SELECT d.sales_order_id INTO v_order
      FROM public.transport_customer_documents d JOIN public.sales_orders o ON o.id=d.sales_order_id
     WHERE d.id=p_document_id AND d.company_id=public.current_company_id()
       AND d.business_unit_id=public.current_business_unit_id()
       AND d.operating_location_id=public.current_operating_location_id()
       AND d.journal_entry_id IS NULL AND o.status='draft' AND o.document_kind='service'
       AND o.posted_at IS NULL FOR UPDATE OF d,o;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only an unposted customer Register draft can be edited'; END IF;
    SELECT jsonb_build_object(
      'side','customer','document_id',d.id,'order_id',o.id,'invoice_no',o.order_no,
      'invoice_date',o.order_date,'party_id',d.customer_id,'party_name',c.name,
      'invoice_type',o.invoice_type,'tax_percent',o.tax_percent,
      'account_id',(SELECT sl.revenue_account_id FROM public.sales_service_lines sl WHERE sl.order_id=o.id ORDER BY sl.created_at,sl.id LIMIT 1),
      'line_ids',coalesce((SELECT jsonb_agg(l.trip_id::text ORDER BY l.trip_id) FROM public.transport_customer_document_trips l WHERE l.document_id=d.id AND NOT l.is_adjustment),'[]'::jsonb),
      'trip_ids',coalesce((SELECT jsonb_agg(l.trip_id::text ORDER BY l.trip_id) FROM public.transport_customer_document_trips l WHERE l.document_id=d.id AND NOT l.is_adjustment),'[]'::jsonb)
    ) INTO v_context FROM public.transport_customer_documents d JOIN public.sales_orders o ON o.id=d.sales_order_id
      JOIN public.customers c ON c.id=d.customer_id WHERE d.id=p_document_id;
  ELSIF p_side='supplier' THEN
    PERFORM public.transport_assert_draft_invoice_access('supplier','edit');
    PERFORM public.assert_module_permission('purchase','edit');
    SELECT d.purchase_order_id INTO v_order
      FROM public.transport_supplier_documents d JOIN public.purchase_orders o ON o.id=d.purchase_order_id
     WHERE d.id=p_document_id AND d.company_id=public.current_company_id()
       AND d.business_unit_id=public.current_business_unit_id()
       AND d.operating_location_id=public.current_operating_location_id()
       AND d.journal_entry_id IS NULL AND o.status='draft' AND o.document_kind='service'
       AND o.posted_at IS NULL FOR UPDATE OF d,o;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only an unposted supplier Register draft can be edited'; END IF;
    SELECT jsonb_build_object(
      'side','supplier','document_id',d.id,'order_id',o.id,'invoice_no',o.order_no,
      'invoice_date',o.order_date,'supplier_invoice_no',o.supplier_invoice_no,
      'party_id',d.supplier_id,'party_name',s.name,
      'invoice_type',o.invoice_type,'tax_percent',o.tax_percent,
      'account_id',(SELECT sl.cost_account_id FROM public.purchase_service_lines sl WHERE sl.order_id=o.id ORDER BY sl.created_at,sl.id LIMIT 1),
      'line_ids',coalesce((SELECT jsonb_agg(l.rent_id::text ORDER BY l.rent_id) FROM public.transport_supplier_document_rents l WHERE l.document_id=d.id AND NOT l.is_adjustment),'[]'::jsonb),
      'trip_ids',coalesce((SELECT jsonb_agg(DISTINCT l.trip_id::text ORDER BY l.trip_id::text) FROM public.transport_supplier_document_rents l WHERE l.document_id=d.id AND NOT l.is_adjustment),'[]'::jsonb)
    ) INTO v_context FROM public.transport_supplier_documents d JOIN public.purchase_orders o ON o.id=d.purchase_order_id
      JOIN public.suppliers s ON s.id=d.supplier_id WHERE d.id=p_document_id;
  ELSE
    RAISE EXCEPTION 'Invoice side must be customer or supplier';
  END IF;
  IF jsonb_array_length(coalesce(v_context->'line_ids','[]'::jsonb))=0 THEN RAISE EXCEPTION 'Draft invoice has no linked trips'; END IF;
  RETURN v_context;
END
$function$
;
CREATE OR REPLACE FUNCTION public.transport_edit_register_draft_invoice(p_side text, p_document_id uuid, p_line_ids uuid[], p_invoice_date date, p_invoice_no text, p_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id();
  v_order uuid; v_company uuid; v_bu uuid; v_party uuid; v_invoice_no text:=nullif(btrim(p_invoice_no),'');
  v_old_no text; v_old_ids uuid[]; v_old_trip_ids uuid[]; v_trip_ids uuid[]; v_tax numeric; v_invoice_type text; v_rate numeric;
  v_count integer; v_expected integer; v_party_count integer; v_sale_type_count integer; v_customer uuid;
  v_supplier uuid; v_with_tax boolean; v_doc_kind text; v_net numeric:=0; v_vat numeric:=0; v_total numeric:=0;
  v_description text; v_old_descriptions jsonb:='{}'::jsonb; v_revenue_account uuid; v_cost_account uuid; t public.transport_trips%rowtype;
  x public.transport_trip_supplier_rents%rowtype; v_charge numeric; v_base numeric; v_line_vat numeric;
BEGIN
  IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR loc IS NULL THEN RAISE EXCEPTION 'Authenticated Transport workspace required'; END IF;
  IF p_invoice_date IS NULL OR v_invoice_no IS NULL OR length(v_invoice_no)>80 OR v_invoice_no ~ '[[:cntrl:]]' OR v_invoice_no LIKE '%-AUTO' THEN
    RAISE EXCEPTION 'Enter a valid invoice date and invoice number (maximum 80 characters)';
  END IF;
  IF p_line_ids IS NULL OR cardinality(p_line_ids)=0 OR cardinality(p_line_ids)>500 THEN RAISE EXCEPTION 'Select between 1 and 500 trips'; END IF;
  SELECT count(DISTINCT id) INTO v_expected FROM unnest(p_line_ids) id;
  IF v_expected<>cardinality(p_line_ids) THEN RAISE EXCEPTION 'Duplicate Trip selection is not allowed'; END IF;

  IF p_side='customer' THEN
    PERFORM public.transport_assert_draft_invoice_access('customer','edit'); PERFORM public.assert_module_permission('sales','edit');
    SELECT d.sales_order_id,d.company_id,d.business_unit_id,d.customer_id,o.order_no,o.invoice_type,o.tax_percent,
      d.document_kind,coalesce((SELECT sl.revenue_account_id FROM public.sales_service_lines sl WHERE sl.order_id=o.id ORDER BY sl.created_at,sl.id LIMIT 1),p_account_id)
      INTO v_order,v_company,v_bu,v_party,v_old_no,v_invoice_type,v_tax,v_doc_kind,v_revenue_account
      FROM public.transport_customer_documents d JOIN public.sales_orders o ON o.id=d.sales_order_id
     WHERE d.id=p_document_id AND d.company_id=c AND d.business_unit_id=b AND d.operating_location_id=loc
       AND d.journal_entry_id IS NULL AND o.status='draft' AND o.document_kind='service' AND o.posted_at IS NULL FOR UPDATE OF d,o;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only an unposted customer Register draft can be edited'; END IF;
    IF v_revenue_account IS NULL OR v_revenue_account IS DISTINCT FROM p_account_id OR NOT EXISTS(
      SELECT 1 FROM public.chart_of_accounts a WHERE a.id=p_account_id AND a.company_id=c AND a.type='revenue' AND a.is_active AND NOT a.is_group
    ) THEN RAISE EXCEPTION 'The saved active revenue account is required'; END IF;
    IF EXISTS(SELECT 1 FROM public.sales_orders o WHERE o.company_id=c AND lower(btrim(o.order_no))=lower(v_invoice_no) AND o.id<>v_order) THEN RAISE EXCEPTION 'Invoice number already exists in this company'; END IF;
    SELECT coalesce(array_agg(l.trip_id ORDER BY l.trip_id),'{}'::uuid[]) INTO v_old_ids FROM public.transport_customer_document_trips l WHERE l.document_id=p_document_id AND NOT l.is_adjustment;
    v_old_trip_ids:=v_old_ids;
    SELECT coalesce(jsonb_object_agg(sl.source_id::text,sl.description),'{}'::jsonb) INTO v_old_descriptions
      FROM public.sales_service_lines sl WHERE sl.order_id=v_order AND sl.source_module='transport' AND sl.source_id IS NOT NULL;
    SELECT count(*),count(DISTINCT t.customer_id),count(DISTINCT t.sale_type),(array_agg(t.customer_id ORDER BY t.id))[1]
      INTO v_count,v_party_count,v_sale_type_count,v_customer
      FROM public.transport_trips t WHERE t.id=ANY(p_line_ids) AND t.company_id=c AND t.business_unit_id=b AND t.operating_location_id=loc;
    IF v_count<>cardinality(p_line_ids) OR v_party_count<>1 OR v_customer IS DISTINCT FROM v_party OR v_sale_type_count<>1 THEN RAISE EXCEPTION 'Selected trips must belong to this customer and one billing mode'; END IF;
    IF EXISTS(SELECT 1 FROM public.transport_trips t WHERE t.id=ANY(p_line_ids) AND (t.customer_rate_state<>'finalized' OR t.customer_rate_snapshot IS NULL OR t.customer_rate_snapshot IS DISTINCT FROM t.customer_rate OR coalesce(t.customer_rate,0)<=0 OR t.status='cancelled' OR t.lifecycle_status='cancelled')) THEN RAISE EXCEPTION 'Every selected Trip needs an active finalized customer rate'; END IF;
    IF EXISTS(SELECT 1 FROM public.transport_customer_document_trips l WHERE l.trip_id=ANY(p_line_ids) AND NOT l.is_adjustment AND l.document_id<>p_document_id) OR EXISTS(SELECT 1 FROM public.transport_trips t WHERE t.id=ANY(p_line_ids) AND t.sales_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unnest(v_old_ids) x WHERE x=t.id)) THEN RAISE EXCEPTION 'A selected Trip is linked to another invoice'; END IF;
    v_with_tax:=v_invoice_type='Tax Invoice'; v_rate:=CASE WHEN v_with_tax THEN public.fixed_tax_rate_on(c,'sales',p_invoice_date) ELSE 0 END;
    IF v_rate IS NULL THEN RAISE EXCEPTION 'Effective fixed Sales VAT rate is required for this date'; END IF;
    SELECT coalesce(array_agg(DISTINCT t.id),'{}'::uuid[]) INTO v_trip_ids FROM public.transport_trips t WHERE t.id=ANY(p_line_ids);
    INSERT INTO public.transport_action_gate(transaction_id,trip_id,action) VALUES(txid_current(),p_document_id,'draft_invoice_edit') ON CONFLICT DO NOTHING;
    INSERT INTO public.transport_action_gate(transaction_id,trip_id,action) SELECT txid_current(),x,'draft_invoice_edit' FROM unnest(v_old_ids||v_trip_ids) x ON CONFLICT DO NOTHING;
    DELETE FROM public.sales_service_lines WHERE order_id=v_order;
    DELETE FROM public.sales_order_charges WHERE order_id=v_order;
    DELETE FROM public.transport_customer_document_trips WHERE document_id=p_document_id AND NOT is_adjustment;
    UPDATE public.sales_orders SET order_no=v_invoice_no,order_date=p_invoice_date,tax_percent=v_rate,total=0,updated_by=auth.uid(),updated_at=now() WHERE id=v_order;
    FOR t IN SELECT * FROM public.transport_trips WHERE id=ANY(v_trip_ids) ORDER BY trip_no,id LOOP
      v_base:=round(coalesce(t.customer_base_rate,t.customer_rate)+coalesce(t.customer_manual_adjustment,0),2);
      SELECT coalesce(sum(tc.amount),0) INTO v_charge FROM public.transport_trip_customer_charges tc JOIN public.charge_master cm ON cm.id=tc.charge_master_id WHERE tc.trip_id=t.id AND cm.company_id=c AND cm.is_active AND cm.applies_to IN ('sales','both');
      IF v_base<=0 OR round(v_base+v_charge,2) IS DISTINCT FROM round(t.customer_rate_snapshot,2) THEN RAISE EXCEPTION 'Customer base rate and charges do not reconcile for Trip %',t.trip_no; END IF;
      IF p_side='supplier' THEN
        v_description:=public.transport_trip_service_description(t.id)||' · Supplier rent';
      ELSE
        v_description:=v_old_descriptions->>t.id::text;
      END IF;
      INSERT INTO public.sales_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,revenue_account_id,source_module,source_id,created_by)
      VALUES(c,b,v_order,coalesce(v_description,public.transport_trip_service_description(t.id)),v_base,v_rate,public.transport_trip_customer_income_account(t.id,p_account_id),'transport',t.id,auth.uid());
      SELECT round(v_base*v_rate/100,2)+coalesce(sum(CASE WHEN v_with_tax AND cm.tax_applicable THEN round(tc.amount*v_rate/100,2) ELSE 0 END),0)
        INTO v_line_vat FROM public.transport_trip_customer_charges tc JOIN public.charge_master cm ON cm.id=tc.charge_master_id WHERE tc.trip_id=t.id AND cm.company_id=c AND cm.is_active AND cm.applies_to IN ('sales','both');
      INSERT INTO public.transport_customer_document_trips(company_id,business_unit_id,operating_location_id,document_id,trip_id,rate_snapshot,vat_snapshot)
      VALUES(c,b,loc,p_document_id,t.id,t.customer_rate_snapshot,coalesce(v_line_vat,0));
      v_net:=v_net+t.customer_rate_snapshot; v_vat:=v_vat+coalesce(v_line_vat,0);
    END LOOP;
    INSERT INTO public.sales_order_charges(order_id,charge_key,charge_label,amount,tax_percent,account_id,charge_type,cost_amount,cost_account_id,company_id,business_unit_id,quantity,rate)
    SELECT v_order,cm.charge_key,cm.charge_name,round(sum(tc.amount),2),CASE WHEN v_with_tax AND cm.tax_applicable THEN v_rate ELSE 0 END,public.transport_trip_customer_income_account(tc.trip_id,p_account_id),'recovery',0,cm.cost_account_id,c,b,
      CASE WHEN cm.is_fixed THEN count(*)::numeric ELSE 1 END,CASE WHEN cm.is_fixed THEN cm.default_rate ELSE round(sum(tc.amount),2) END
    FROM public.transport_trip_customer_charges tc JOIN public.charge_master cm ON cm.id=tc.charge_master_id
    WHERE tc.trip_id=ANY(v_trip_ids) AND tc.company_id=c AND tc.business_unit_id=b AND cm.company_id=c AND cm.is_active AND cm.applies_to IN ('sales','both')
    GROUP BY cm.id,cm.charge_key,cm.charge_name,cm.cost_account_id,cm.tax_applicable,cm.is_fixed,cm.default_rate,
      public.transport_trip_customer_income_account(tc.trip_id,p_account_id);
    IF EXISTS(SELECT 1 FROM public.sales_order_charges WHERE order_id=v_order AND account_id IS NULL) THEN RAISE EXCEPTION 'Every customer charge requires a revenue account mapping'; END IF;
    
    v_total:=round(v_net+v_vat,2);
    UPDATE public.sales_orders SET total=v_total,outstanding_amount=v_total,paid_amount=0,payment_status='unpaid' WHERE id=v_order;
    UPDATE public.transport_customer_document_trips SET vat_snapshot=round(vat_snapshot+(v_vat-(SELECT coalesce(sum(vat_snapshot),0) FROM public.transport_customer_document_trips WHERE document_id=p_document_id)),2)
      WHERE id=(SELECT id FROM public.transport_customer_document_trips WHERE document_id=p_document_id ORDER BY id DESC LIMIT 1)
        AND abs(v_vat-(SELECT coalesce(sum(vat_snapshot),0) FROM public.transport_customer_document_trips WHERE document_id=p_document_id))>=0.005;
  ELSIF p_side='supplier' THEN
    PERFORM public.transport_assert_draft_invoice_access('supplier','edit'); PERFORM public.assert_module_permission('purchase','edit');
    SELECT d.purchase_order_id,d.company_id,d.business_unit_id,d.supplier_id,o.order_no,o.invoice_type,o.tax_percent,
      coalesce((SELECT sl.cost_account_id FROM public.purchase_service_lines sl WHERE sl.order_id=o.id ORDER BY sl.created_at,sl.id LIMIT 1),p_account_id)
      INTO v_order,v_company,v_bu,v_party,v_old_no,v_invoice_type,v_tax,v_cost_account
      FROM public.transport_supplier_documents d JOIN public.purchase_orders o ON o.id=d.purchase_order_id
     WHERE d.id=p_document_id AND d.company_id=c AND d.business_unit_id=b AND d.operating_location_id=loc
       AND d.journal_entry_id IS NULL AND o.status='draft' AND o.document_kind='service' AND o.posted_at IS NULL FOR UPDATE OF d,o;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only an unposted supplier Register draft can be edited'; END IF;
    IF v_cost_account IS NULL OR v_cost_account IS DISTINCT FROM p_account_id OR NOT EXISTS(SELECT 1 FROM public.chart_of_accounts a WHERE a.id=p_account_id AND a.company_id=c AND a.type='expense' AND a.is_active AND NOT a.is_group) THEN RAISE EXCEPTION 'The saved active expense account is required'; END IF;
    IF EXISTS(SELECT 1 FROM public.purchase_orders o WHERE o.company_id=c AND lower(btrim(o.order_no))=lower(v_invoice_no) AND o.id<>v_order) THEN RAISE EXCEPTION 'Invoice number already exists in this company'; END IF;
    SELECT coalesce(array_agg(l.rent_id ORDER BY l.rent_id),'{}'::uuid[]) INTO v_old_ids FROM public.transport_supplier_document_rents l WHERE l.document_id=p_document_id AND NOT l.is_adjustment;
    SELECT coalesce(array_agg(DISTINCT l.trip_id ORDER BY l.trip_id),'{}'::uuid[]) INTO v_old_trip_ids
      FROM public.transport_supplier_document_rents l WHERE l.document_id=p_document_id AND NOT l.is_adjustment;
    SELECT coalesce(jsonb_object_agg(sl.source_id::text,sl.description),'{}'::jsonb) INTO v_old_descriptions
      FROM public.purchase_service_lines sl WHERE sl.order_id=v_order AND sl.source_module='transport' AND sl.source_id IS NOT NULL;
    SELECT count(*),count(DISTINCT r.supplier_id),(array_agg(r.supplier_id ORDER BY r.id))[1] INTO v_count,v_party_count,v_supplier FROM public.transport_trip_supplier_rents r WHERE r.id=ANY(p_line_ids) AND r.company_id=c AND r.business_unit_id=b AND r.operating_location_id=loc;
    IF v_count<>cardinality(p_line_ids) OR v_party_count<>1 OR v_supplier IS DISTINCT FROM v_party THEN RAISE EXCEPTION 'Selected rents must belong to this supplier'; END IF;
    IF EXISTS(SELECT 1 FROM public.transport_trip_supplier_rents r WHERE r.id=ANY(p_line_ids) AND (r.state<>'finalized' OR r.finalized_amount_snapshot IS NULL OR r.finalized_amount_snapshot IS DISTINCT FROM r.amount OR r.amount<=0)) THEN RAISE EXCEPTION 'Every selected rent must have a consistent finalized amount'; END IF;
    IF EXISTS(SELECT 1 FROM public.transport_supplier_document_rents l WHERE l.rent_id=ANY(p_line_ids) AND NOT l.is_adjustment AND l.document_id<>p_document_id) THEN RAISE EXCEPTION 'A selected rent is linked to another invoice'; END IF;
    v_with_tax:=v_invoice_type='Tax Invoice'; v_rate:=CASE WHEN v_with_tax THEN public.fixed_tax_rate_on(c,'purchase',p_invoice_date) ELSE 0 END;
    IF v_rate IS NULL THEN RAISE EXCEPTION 'Effective fixed Purchase VAT rate is required for this date'; END IF;
    SELECT coalesce(array_agg(DISTINCT r.trip_id),'{}'::uuid[]) INTO v_trip_ids FROM public.transport_trip_supplier_rents r WHERE r.id=ANY(p_line_ids);
    INSERT INTO public.transport_action_gate(transaction_id,trip_id,action) VALUES(txid_current(),p_document_id,'draft_invoice_edit') ON CONFLICT DO NOTHING;
    INSERT INTO public.transport_action_gate(transaction_id,trip_id,action) SELECT txid_current(),t,'draft_invoice_edit' FROM (SELECT DISTINCT r.trip_id t FROM public.transport_supplier_document_rents l JOIN public.transport_trip_supplier_rents r ON r.id=l.rent_id WHERE l.document_id=p_document_id AND NOT l.is_adjustment UNION SELECT DISTINCT r.trip_id FROM public.transport_trip_supplier_rents r WHERE r.id=ANY(p_line_ids)) x ON CONFLICT DO NOTHING;
    DELETE FROM public.purchase_service_lines WHERE order_id=v_order;
    DELETE FROM public.purchase_order_charges WHERE order_id=v_order;
    DELETE FROM public.transport_supplier_document_rents WHERE document_id=p_document_id AND NOT is_adjustment;
    UPDATE public.purchase_orders SET order_no=v_invoice_no,order_date=p_invoice_date,supplier_invoice_date=p_invoice_date,tax_percent=v_rate,total=0,updated_by=auth.uid(),updated_at=now() WHERE id=v_order;
    FOR x IN SELECT * FROM public.transport_trip_supplier_rents WHERE id=ANY(p_line_ids) ORDER BY created_at,id LOOP
      t:=public.transport_financial_trip(x.trip_id); v_base:=coalesce(x.finalized_base_amount_snapshot,x.base_amount,x.finalized_amount_snapshot);
      SELECT coalesce(sum(sc.amount),0) INTO v_charge FROM public.transport_trip_supplier_charges sc JOIN public.charge_master cm ON cm.id=sc.charge_master_id WHERE sc.rent_id=x.id AND cm.company_id=c AND cm.is_active AND cm.applies_to IN ('purchase','both');
      IF v_base<=0 OR round(v_base+v_charge,2) IS DISTINCT FROM round(x.finalized_amount_snapshot,2) THEN RAISE EXCEPTION 'Supplier base rent and charges do not reconcile for Trip %',t.trip_no; END IF;
      IF p_side='supplier' THEN
        v_description:=public.transport_trip_service_description(t.id)||' · Supplier rent';
      ELSE
        v_description:=v_old_descriptions->>t.id::text;
      END IF;
      INSERT INTO public.purchase_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,cost_account_id,source_module,source_id,created_by)
      VALUES(c,b,v_order,coalesce(v_description,public.transport_trip_service_description(t.id)||' · Supplier rent'),v_base,v_rate,p_account_id,'transport',t.id,auth.uid());
      SELECT round(v_base*v_rate/100,2)+coalesce(sum(CASE WHEN v_with_tax AND cm.tax_applicable THEN round(sc.amount*v_rate/100,2) ELSE 0 END),0)
        INTO v_line_vat FROM public.transport_trip_supplier_charges sc JOIN public.charge_master cm ON cm.id=sc.charge_master_id WHERE sc.rent_id=x.id AND cm.company_id=c AND cm.is_active AND cm.applies_to IN ('purchase','both');
      INSERT INTO public.transport_supplier_document_rents(company_id,business_unit_id,operating_location_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot)
      VALUES(c,b,loc,p_document_id,x.id,x.trip_id,x.finalized_amount_snapshot,coalesce(v_line_vat,0));
      v_net:=v_net+x.finalized_amount_snapshot; v_vat:=v_vat+coalesce(v_line_vat,0);
    END LOOP;
    INSERT INTO public.purchase_order_charges(user_id,company_id,business_unit_id,order_id,charge_key,charge_label,amount,tax_percent,treatment,cost_account_id,quantity,rate)
    SELECT public.legacy_data_user_id(),c,b,v_order,cm.charge_key,cm.charge_name,round(sum(sc.amount),2),CASE WHEN v_with_tax AND cm.tax_applicable THEN v_rate ELSE 0 END,
      coalesce(cm.purchase_treatment,'expense'),cm.cost_account_id,CASE WHEN cm.is_fixed THEN count(*)::numeric ELSE 1 END,CASE WHEN cm.is_fixed THEN cm.default_rate ELSE round(sum(sc.amount),2) END
    FROM public.transport_trip_supplier_charges sc JOIN public.charge_master cm ON cm.id=sc.charge_master_id
    WHERE sc.rent_id=ANY(p_line_ids) AND sc.company_id=c AND sc.business_unit_id=b AND cm.company_id=c AND cm.is_active AND cm.applies_to IN ('purchase','both')
    GROUP BY cm.id,cm.charge_key,cm.charge_name,cm.tax_applicable,cm.purchase_treatment,cm.cost_account_id,cm.is_fixed,cm.default_rate;
    IF EXISTS(SELECT 1 FROM public.purchase_order_charges WHERE order_id=v_order AND cost_account_id IS NULL) THEN RAISE EXCEPTION 'Every supplier charge requires a cost account mapping'; END IF;
    
    v_total:=round(v_net+v_vat,2);
    UPDATE public.purchase_orders SET total=v_total,outstanding_amount=v_total,paid_amount=0,payment_status='unpaid' WHERE id=v_order;
    UPDATE public.transport_supplier_document_rents SET vat_snapshot=round(vat_snapshot+(v_vat-(SELECT coalesce(sum(vat_snapshot),0) FROM public.transport_supplier_document_rents WHERE document_id=p_document_id)),2)
      WHERE id=(SELECT id FROM public.transport_supplier_document_rents WHERE document_id=p_document_id ORDER BY id DESC LIMIT 1)
        AND abs(v_vat-(SELECT coalesce(sum(vat_snapshot),0) FROM public.transport_supplier_document_rents WHERE document_id=p_document_id))>=0.005;
  ELSE
    RAISE EXCEPTION 'Invoice side must be customer or supplier';
  END IF;

  PERFORM public.transport_refresh_document_balance(p_side,v_order);
  IF p_side='customer' THEN
    PERFORM public.transport_financial_audit(a.trip_id,'customer_bill_draft_edited',jsonb_build_object('document_id',p_document_id,'order_id',v_order,'old_invoice_no',v_old_no,'invoice_no',v_invoice_no,'old_line_ids',v_old_ids,'new_line_ids',p_line_ids,'net',round(v_net,2),'vat',round(v_vat,2),'total',v_total))
      FROM (SELECT DISTINCT unnest(coalesce(v_old_trip_ids,'{}'::uuid[])||coalesce(v_trip_ids,'{}'::uuid[])) trip_id) a;
  ELSE
    PERFORM public.transport_financial_audit(a.trip_id,'supplier_bill_draft_edited',jsonb_build_object('document_id',p_document_id,'order_id',v_order,'old_invoice_no',v_old_no,'invoice_no',v_invoice_no,'old_line_ids',v_old_ids,'new_line_ids',p_line_ids,'net',round(v_net,2),'vat',round(v_vat,2),'total',v_total))
      FROM (SELECT DISTINCT unnest(coalesce(v_old_trip_ids,'{}'::uuid[])||coalesce(v_trip_ids,'{}'::uuid[])) trip_id) a;
  END IF;
  DELETE FROM public.transport_action_gate WHERE transaction_id=txid_current() AND action='draft_invoice_edit';
  RETURN jsonb_build_object('status','updated','document_id',p_document_id,'order_id',v_order,'invoice_no',v_invoice_no,'trip_count',cardinality(p_line_ids),'net',round(v_net,2),'vat',round(v_vat,2),'total',v_total);
END
$function$
;
CREATE OR REPLACE FUNCTION public.transport_register_draft_edit_gate_allows(p_order_id uuid, p_company_id uuid, p_business_unit_id uuid, p_side text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_company_id=public.current_company_id()
    AND p_business_unit_id=public.current_business_unit_id()
    AND CASE p_side
      WHEN 'customer' THEN public.transport_draft_invoice_allowed('customer','edit')
        AND public.has_module_permission(p_company_id,'sales','edit')
        AND EXISTS (
          SELECT 1 FROM public.transport_action_gate g
          JOIN public.transport_customer_documents d ON d.id=g.trip_id
          JOIN public.sales_orders o ON o.id=d.sales_order_id
          WHERE g.transaction_id=txid_current() AND g.action='draft_invoice_edit'
            AND o.id=p_order_id AND o.status='draft' AND o.posted_at IS NULL
            AND d.journal_entry_id IS NULL AND d.company_id=p_company_id
            AND d.business_unit_id=p_business_unit_id
            AND d.operating_location_id=public.current_operating_location_id()
        )
      WHEN 'supplier' THEN public.transport_draft_invoice_allowed('supplier','edit')
        AND public.has_module_permission(p_company_id,'purchase','edit')
        AND EXISTS (
          SELECT 1 FROM public.transport_action_gate g
          JOIN public.transport_supplier_documents d ON d.id=g.trip_id
          JOIN public.purchase_orders o ON o.id=d.purchase_order_id
          WHERE g.transaction_id=txid_current() AND g.action='draft_invoice_edit'
            AND o.id=p_order_id AND o.status='draft' AND o.posted_at IS NULL
            AND d.journal_entry_id IS NULL AND d.company_id=p_company_id
            AND d.business_unit_id=p_business_unit_id
            AND d.operating_location_id=public.current_operating_location_id()
        )
      ELSE false
    END;
$function$
;
NOTIFY pgrst,'reload schema';
COMMIT;

