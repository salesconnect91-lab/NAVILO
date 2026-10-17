-- Forward-only: auto-split one Trip Service Invoice among vehicle Income COA and service revenue.
-- Existing posted invoices and journals remain immutable; original invoice UI unchanged.
-- Company-owned trips use one-time Vehicle Master revenue_account_id; third-party/shared use
-- the already selected Service Revenue COA. Preserve grouped invoices and VAT reconciliation.
BEGIN;
CREATE OR REPLACE FUNCTION public.transport_trip_customer_income_account(p_trip_id uuid,p_service_revenue_account uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path TO public,pg_temp AS $body$
DECLARE
 c uuid:=public.current_company_id();
 b uuid:=public.current_business_unit_id();
 t public.transport_trips%rowtype;
 v public.transport_vehicles%rowtype;
 v_owner text;
 v_history_count integer;
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR b IS NULL THEN
   RAISE EXCEPTION 'Authenticated Transport workspace required';
 END IF;
 SELECT * INTO t FROM public.transport_trips
 WHERE id=p_trip_id AND company_id=c AND business_unit_id=b;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trip outside active Transport workspace';END IF;
 IF p_service_revenue_account IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.chart_of_accounts a WHERE a.id=p_service_revenue_account
     AND a.company_id=c AND a.type='revenue' AND a.is_active AND NOT a.is_group
 ) THEN RAISE EXCEPTION 'Valid same-company Service Revenue account required';END IF;
 IF t.vehicle_id IS NULL THEN RETURN p_service_revenue_account;END IF;
 SELECT * INTO v FROM public.transport_vehicles
 WHERE id=t.vehicle_id AND company_id=c AND business_unit_id=b;
 IF NOT FOUND THEN RETURN p_service_revenue_account;END IF;
 IF t.ownership_id IS NOT NULL THEN
   SELECT h.owner_type INTO v_owner FROM public.transport_vehicle_ownership h
   WHERE h.id=t.ownership_id AND h.vehicle_id=t.vehicle_id AND h.company_id=c AND h.business_unit_id=b;
   IF NOT FOUND THEN RAISE EXCEPTION 'Trip % has an invalid vehicle ownership snapshot',t.trip_no;END IF;
 ELSE
   SELECT h.owner_type INTO v_owner FROM public.transport_vehicle_ownership h
   WHERE h.vehicle_id=v.id AND h.company_id=c AND h.business_unit_id=b
     AND h.effective_from<=t.trip_date AND (h.effective_to IS NULL OR h.effective_to>=t.trip_date)
   ORDER BY h.effective_from DESC,h.id DESC LIMIT 1;
   IF v_owner IS NULL THEN
     SELECT count(*) INTO v_history_count FROM public.transport_vehicle_ownership h
       WHERE h.vehicle_id=v.id AND h.company_id=c AND h.business_unit_id=b;
     IF v_history_count>0 AND coalesce(v.ownership_type,v.owner_type)='company' THEN
       RAISE EXCEPTION 'Trip %: company Vehicle % has no confirmed ownership period for Trip date',t.trip_no,v.vehicle_no;
     END IF;
     -- Legacy masters with no dated history retain their explicit company/supplier classification.
     -- No ownership history or financial entry is invented or backfilled.
     v_owner:=coalesce(v.ownership_type,v.owner_type);
   END IF;
 END IF;
 IF v_owner='company' THEN
   IF v.revenue_account_id IS NULL THEN
     RAISE EXCEPTION 'Trip %: Company vehicle % Income COA not linked. Set Revenue account once in Vehicle Master before posting',t.trip_no,v.vehicle_no;
   END IF;
   IF NOT EXISTS (
     SELECT 1 FROM public.chart_of_accounts a WHERE a.id=v.revenue_account_id
       AND a.company_id=c AND a.type='revenue' AND a.is_active AND NOT a.is_group
   ) THEN RAISE EXCEPTION 'Trip %: Company vehicle % has invalid Income COA mapping',t.trip_no,v.vehicle_no;END IF;
   RETURN v.revenue_account_id;
 END IF;
 RETURN p_service_revenue_account;
END
$body$;
REVOKE ALL ON FUNCTION public.transport_trip_customer_income_account(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.transport_post_customer_bill_grouped(p_trip_ids uuid[], p_date date, p_revenue_account_id uuid, p_with_tax boolean DEFAULT false, p_invoice_no text DEFAULT NULL::text, p_descriptions jsonb DEFAULT '{}'::jsonb)
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
        'revenue_account_id',public.transport_trip_customer_income_account(t.id,p_revenue_account_id),
        'service_revenue_account_id',p_revenue_account_id,
        'grouped_invoice',true,
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
    'grouped_invoice',true,
    'trip_count',v_expected,
    'revenue_account_id',p_revenue_account_id
  );
end
$function$
;
CREATE OR REPLACE FUNCTION public.transport_post_customer_bill_accounted(p_trip_id uuid, p_date date, p_revenue_account_id uuid, p_with_tax boolean DEFAULT false, p_invoice_no text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  t public.transport_trips%rowtype;
  r jsonb;
  d uuid;
  base numeric;
  v_effective_revenue uuid;
begin
  if length(coalesce(p_description,''))>2000 then
    raise exception 'Invoice description must be at most 2000 characters';
  end if;

  perform public.transport_finance_assert('billing');
  t:=public.transport_financial_trip(p_trip_id);

  if t.sale_type = 'credit' and (nullif(btrim(p_invoice_no),'') is null or btrim(p_invoice_no) like 'H-S-%') then
    raise exception 'Credit Transport Sales invoice requires your original invoice number before posting';
  end if;

  if p_revenue_account_id is null
     or not exists(
       select 1
       from public.chart_of_accounts a
       where a.id=p_revenue_account_id
         and a.company_id=t.company_id
         and a.type='revenue'
         and a.is_active
         and not a.is_group
     )
  then
    raise exception 'Active same-company revenue account required';
  end if;

  if t.customer_rate_state is distinct from 'finalized'
     or t.customer_rate_snapshot is null
     or t.customer_rate_snapshot is distinct from t.customer_rate
  then
    raise exception 'Consistent finalized customer rate snapshot required';
  end if;

  if t.sales_order_id is not null then
    raise exception 'Trip already references a canonical Sales document; reconcile its existing posted linkage before billing';
  end if;

  if t.sale_type is null
     or t.customer_id is null
     or t.customer_rate<=0
     or exists(select 1 from public.transport_customer_document_trips where trip_id=t.id and not is_adjustment)
  then
    raise exception 'Unbilled Trip, Cash/Credit classification, customer and positive finalized rate required';
  end if;

  base:=coalesce(t.customer_base_rate,t.customer_rate)+coalesce(t.customer_manual_adjustment,0);

  v_effective_revenue:=public.transport_trip_customer_income_account(t.id,p_revenue_account_id);
  r:=public.transport_create_charged_service_document_accounted(
    'customer',t.customer_id,p_date,base,p_with_tax,null,v_effective_revenue,
    concat_ws(E'\n',nullif(btrim(p_description),''),public.transport_trip_service_description(t.id)),
    null,p_invoice_no,t.id,null
  );

  if round(coalesce((r->>'net')::numeric,0),2) is distinct from round(t.customer_rate_snapshot,2) then
    raise exception 'Customer base + charges does not reconcile to finalized Trip rate';
  end if;

  insert into public.transport_customer_documents(
    company_id,business_unit_id,operating_location_id,customer_id,document_kind,
    sales_order_id,journal_entry_id,created_by
  )
  values(
    t.company_id,t.business_unit_id,public.current_operating_location_id(),t.customer_id,
    case when t.sale_type='cash' then 'cash_hand_bill' else 'credit' end,
    (r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()
  )
  returning id into d;

  insert into public.transport_customer_document_trips(
    company_id,business_unit_id,document_id,trip_id,rate_snapshot,vat_snapshot
  )
  values(
    t.company_id,t.business_unit_id,d,t.id,t.customer_rate_snapshot,(r->>'vat')::numeric
  );

  perform public.transport_financial_audit(
    t.id,'customer_bill_posted',
    r||jsonb_build_object(
      'transport_document_id',d,
      'sale_type',t.sale_type,
      'revenue_account_id',v_effective_revenue,
      'service_revenue_account_id',p_revenue_account_id
    )
  );

  return r||jsonb_build_object('transport_document_id',d,'revenue_account_id',v_effective_revenue,'service_revenue_account_id',p_revenue_account_id);
end
$function$
;
CREATE OR REPLACE FUNCTION public.transport_create_charged_service_document_accounted(p_side text, p_party uuid, p_date date, p_base_amount numeric, p_tax boolean, p_cost_account uuid, p_revenue_account uuid, p_description text, p_reference text, p_invoice_no text, p_trip_id uuid, p_rent_id uuid DEFAULT NULL::uuid)
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
  base text;
  tax numeric;
  oid uuid;
  j jsonb;
  number text;
  charge_total numeric:=0;
  charge_vat numeric:=0;
  x record;
begin
  if p_side not in ('customer','supplier') or p_date is null or coalesce(p_base_amount,0)<0 then
    raise exception 'Valid service document required';
  end if;

  perform public.assert_module_permission(case when p_side='customer' then 'sales' else 'purchase' end,'create');
  number:=public.transport_choose_invoice_number(p_side,p_invoice_no);
  select base_currency_code into base from public.companies where id=c;
  p_tax:=public.transport_party_billing_mode(p_side,c,b,p_party)='Credit';
tax:=public.transport_billing_rate(c,p_side,p_date,case when p_tax then 'Credit' else 'Cash' end);
  if tax is null then raise exception 'Effective fixed VAT rate required';end if;

  if p_side='customer' then
    if p_revenue_account is null
       or not exists(
         select 1 from public.chart_of_accounts a
         where a.id=p_revenue_account
           and a.company_id=c
           and a.type='revenue'
           and a.is_active
           and not a.is_group
       )
    then
      raise exception 'Active same-company revenue account required';
    end if;

    insert into public.sales_orders(
      user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,order_date,
      status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,payment_mode
    )
    values(
      u,c,b,loc,number,p_party,p_date,'draft',
      case when p_tax then 'Tax Invoice' else 'Sale Invoice' end,
      tax,base,1,'service',coalesce((select initcap(t.sale_type) from public.transport_trips t where t.id=p_trip_id and t.company_id=c and t.business_unit_id=b),(select m.billing_mode from public.transport_customer_billing_modes m where m.company_id=c and m.business_unit_id=b and m.customer_id=p_party),'Credit')
    )
    returning id into oid;

    if p_base_amount>0 then
      insert into public.sales_service_lines(
        company_id,business_unit_id,order_id,description,amount,tax_percent,revenue_account_id,
        source_module,source_id,created_by
      )
      values(
        c,b,oid,p_description,round(p_base_amount,2),tax,p_revenue_account,
        'transport',p_trip_id,auth.uid()
      );
    end if;

    for x in
      select tc.amount,cm.*
      from public.transport_trip_customer_charges tc
      join public.charge_master cm on cm.id=tc.charge_master_id
      where tc.trip_id=p_trip_id
        and cm.company_id=c
        and cm.is_active
        and cm.applies_to in ('sales','both')
      order by tc.sort_order,tc.id
    loop
      if p_trip_id is null and x.revenue_account_id is null then
        raise exception 'Charge % has no revenue account mapping',x.charge_name;
      end if;
      insert into public.sales_order_charges(
        order_id,charge_key,charge_label,amount,tax_percent,account_id,charge_type,cost_amount,
        cost_account_id,company_id,business_unit_id,quantity,rate
      )
      values(
        oid,x.charge_key,x.charge_name,x.amount,
        case when p_tax and x.tax_applicable then tax else 0 end,
        case when p_trip_id is not null then p_revenue_account else x.revenue_account_id end,'recovery',0,x.cost_account_id,c,b,1,x.amount
      );
      charge_total:=charge_total+x.amount;
      charge_vat:=charge_vat+case when p_tax and x.tax_applicable then round(x.amount*tax/100,2) else 0 end;
    end loop;

    j:=public.post_sales_invoice(oid);
  else
    insert into public.purchase_orders(
      user_id,company_id,business_unit_id,operating_location_id,order_no,supplier_id,order_date,
      status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,
      supplier_invoice_no,supplier_invoice_date
    )
    values(
      u,c,b,loc,number,p_party,p_date,'draft',
      case when p_tax then 'Tax Invoice' else 'Purchase Invoice' end,
      tax,base,1,'service',
      coalesce(nullif(btrim(p_reference),''),'TR-'||substr(gen_random_uuid()::text,1,12)),
      p_date
    )
    returning id into oid;

    if p_base_amount>0 then
      insert into public.purchase_service_lines(
        company_id,business_unit_id,order_id,description,amount,tax_percent,cost_account_id,
        source_module,source_id,created_by
      )
      values(
        c,b,oid,p_description,round(p_base_amount,2),tax,p_cost_account,
        'transport',p_trip_id,auth.uid()
      );
    end if;

    for x in
      select sc.amount,cm.*
      from public.transport_trip_supplier_charges sc
      join public.charge_master cm on cm.id=sc.charge_master_id
      where sc.trip_id=p_trip_id
        and sc.rent_id=p_rent_id
        and cm.company_id=c
        and cm.is_active
        and cm.applies_to in ('purchase','both')
      order by sc.sort_order,sc.id
    loop
      if x.cost_account_id is null then
        raise exception 'Charge % has no cost account mapping',x.charge_name;
      end if;
      insert into public.purchase_order_charges(
        user_id,company_id,business_unit_id,order_id,charge_key,charge_label,amount,tax_percent,
        treatment,cost_account_id,quantity,rate
      )
      values(
        u,c,b,oid,x.charge_key,x.charge_name,x.amount,
        case when p_tax and x.tax_applicable then tax else 0 end,
        coalesce(x.purchase_treatment,'expense'),x.cost_account_id,1,x.amount
      );
      charge_total:=charge_total+x.amount;
      charge_vat:=charge_vat+case when p_tax and x.tax_applicable then round(x.amount*tax/100,2) else 0 end;
    end loop;

    j:=public.post_purchase_invoice(oid);
  end if;

  return j||jsonb_build_object(
    'document_id',oid,
    'invoice_no',number,
    'base_net',round(p_base_amount,2),
    'charges_net',round(charge_total,2),
    'net',round(p_base_amount+charge_total,2),
    'vat',round(p_base_amount*tax/100,2)+charge_vat,
    'tax_percent',tax
  );
end
$function$
;
COMMIT;
