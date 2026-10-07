-- Consolidate selected Transport trips/rents into one canonical service invoice per party.
-- Customer: one Sales service invoice for selected trips of one customer/sale type.
-- Supplier: one Purchase service invoice for selected rents of one supplier.
-- Existing one-row posting RPCs remain available for compatibility.

create or replace function public.transport_post_customer_bill_grouped(
  p_trip_ids uuid[],
  p_date date,
  p_revenue_account_id uuid,
  p_with_tax boolean default false,
  p_invoice_no text default null,
  p_descriptions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
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

  perform public.transport_finance_assert('billing');
  perform public.assert_module_permission('sales','create');

  if p_revenue_account_id is null
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

  select base_currency_code into v_base_currency from public.companies where id=c;
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
    v_tax,v_base_currency,1,'service','Credit'
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
      round(v_base,2),v_tax,p_revenue_account_id,'transport',t.id,auth.uid()
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
    cm.revenue_account_id,
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
           cm.tax_applicable,cm.is_fixed,cm.default_rate;

  if exists(
    select 1
    from public.sales_order_charges x
    where x.order_id=v_order and x.account_id is null
  ) then
    raise exception 'Every customer charge requires a revenue account mapping';
  end if;

  v_post:=public.post_sales_invoice(v_order);

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
    v_order,(v_post->>'journal_entry_id')::uuid,auth.uid()
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
      t.id,'customer_bill_posted',
      v_post||jsonb_build_object(
        'transport_document_id',v_doc,
        'sale_type',v_sale_type,
        'revenue_account_id',p_revenue_account_id,
        'grouped_invoice',true,
        'grouped_trip_count',v_expected,
        'invoice_no',v_number
      )
    );
  end loop;

  return v_post||jsonb_build_object(
    'transport_document_id',v_doc,
    'invoice_no',v_number,
    'grouped_invoice',true,
    'trip_count',v_expected,
    'revenue_account_id',p_revenue_account_id
  );
end
$function$;

create or replace function public.transport_post_supplier_bill_grouped(
  p_rent_ids uuid[],
  p_date date,
  p_cost_account_id uuid,
  p_with_tax boolean default false,
  p_reference text default null,
  p_invoice_no text default null,
  p_descriptions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
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

  perform public.transport_finance_assert('rent');
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

  v_post:=public.post_purchase_invoice(v_order);

  if round(coalesce((v_post->>'subtotal_excluding_vat')::numeric,0),2)
     is distinct from round(v_expected_net,2)
  then
    raise exception 'Grouped supplier invoice total does not reconcile to selected rent totals';
  end if;

  insert into public.transport_supplier_documents(
    company_id,business_unit_id,operating_location_id,supplier_id,purchase_order_id,journal_entry_id,created_by
  )
  values(c,b,loc,v_supplier,v_order,(v_post->>'journal_entry_id')::uuid,auth.uid())
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
      t.id,'supplier_bill_posted',
      v_post||jsonb_build_object(
        'rent_id',x.id,
        'transport_document_id',v_doc,
        'grouped_invoice',true,
        'grouped_rent_count',v_expected,
        'invoice_no',v_number
      )
    );
  end loop;

  return v_post||jsonb_build_object(
    'transport_document_id',v_doc,
    'invoice_no',v_number,
    'grouped_invoice',true,
    'rent_count',v_expected,
    'cost_account_id',p_cost_account_id
  );
end
$function$;

revoke all on function public.transport_post_customer_bill_grouped(uuid[],date,uuid,boolean,text,jsonb) from public,anon;
grant execute on function public.transport_post_customer_bill_grouped(uuid[],date,uuid,boolean,text,jsonb) to authenticated,service_role;

revoke all on function public.transport_post_supplier_bill_grouped(uuid[],date,uuid,boolean,text,text,jsonb) from public,anon;
grant execute on function public.transport_post_supplier_bill_grouped(uuid[],date,uuid,boolean,text,text,jsonb) to authenticated,service_role;
