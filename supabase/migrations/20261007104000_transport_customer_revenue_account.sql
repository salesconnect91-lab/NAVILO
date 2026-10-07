-- Give Transport customer service invoices the same explicit-account rule as supplier service invoices.
-- Existing service Sales lines remain compatible: NULL revenue_account_id falls back to the canonical service_revenue mapping.

alter table public.sales_service_lines
  add column if not exists revenue_account_id uuid references public.chart_of_accounts(id);

create index if not exists sales_service_lines_revenue_account_idx
  on public.sales_service_lines(company_id,business_unit_id,revenue_account_id)
  where revenue_account_id is not null;

create or replace function public.post_service_sales_invoice_core(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  o public.sales_orders%rowtype;
  v_sub numeric;
  v_charge numeric;
  v_vat numeric;
  v_total numeric;
  v_ar uuid;
  v_default_rev uuid;
  v_tax uuid;
  v_j uuid;
  v_customer text;
  r record;
begin
  perform public.assert_module_permission('sales','post');

  select *
    into o
  from public.sales_orders
  where id=p_order_id
    and company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
    and operating_location_id=public.current_operating_location_id()
  for update;

  if not found
     or o.document_kind<>'service'
     or o.status='posted'
     or exists(select 1 from public.sales_order_lines where order_id=p_order_id)
     or exists(select 1 from public.consolidated_sales_invoices where main_sales_order_id=p_order_id)
     or public.discount_amount_for('sales_main',o.order_no)<>0
  then
    raise exception 'Eligible service Sales document without inventory lines required';
  end if;

  select coalesce(sum(amount),0),
         coalesce(sum(round(amount*tax_percent/100,2)),0)
    into v_sub,v_vat
  from public.sales_service_lines
  where order_id=o.id
    and company_id=o.company_id
    and business_unit_id=o.business_unit_id;

  select coalesce(sum(amount),0),
         v_vat+coalesce(sum(round(amount*tax_percent/100,2)),0)
    into v_charge,v_vat
  from public.sales_order_charges
  where order_id=o.id
    and company_id=o.company_id
    and business_unit_id=o.business_unit_id;

  if v_sub<=0 or o.customer_id is null then
    raise exception 'Customer and positive service lines required';
  end if;

  v_total:=round(v_sub+v_charge+v_vat,2);
  v_ar:=public.fx_mapping_account(o.user_id,o.company_id,'accounts_receivable','asset');
  v_default_rev:=public.fx_mapping_account(o.user_id,o.company_id,'service_revenue','revenue');
  if v_vat>0 then
    v_tax:=public.fx_mapping_account(o.user_id,o.company_id,'output_vat','liability');
  end if;

  update public.customers
     set account_id=v_ar
   where id=o.customer_id
     and company_id=o.company_id
     and user_id=o.user_id
     and account_id is null;

  select name
    into v_customer
  from public.customers
  where id=o.customer_id
    and company_id=o.company_id
    and user_id=o.user_id
    and account_id=v_ar;

  if v_customer is null then
    raise exception 'Customer/AR mapping mismatch';
  end if;

  for r in
    select coalesce(l.revenue_account_id,v_default_rev) as account_id,
           sum(l.amount) as amount
    from public.sales_service_lines l
    where l.order_id=o.id
      and l.company_id=o.company_id
      and l.business_unit_id=o.business_unit_id
    group by coalesce(l.revenue_account_id,v_default_rev)
  loop
    if not exists(
      select 1
      from public.chart_of_accounts a
      where a.id=r.account_id
        and a.company_id=o.company_id
        and a.type='revenue'
        and a.is_active
        and not a.is_group
    ) then
      raise exception 'Active service revenue account required';
    end if;
  end loop;

  for r in
    select account_id,sum(amount) amount
    from public.sales_order_charges
    where order_id=o.id
    group by account_id
  loop
    if not exists(
      select 1
      from public.chart_of_accounts a
      where a.id=r.account_id
        and a.company_id=o.company_id
        and a.type='revenue'
        and a.is_active
        and not a.is_group
    ) then
      raise exception 'Active charge revenue account required';
    end if;
  end loop;

  insert into public.journal_entries(
    user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,
    description,status,party_name,trans_type,source_module,source_document_type,source_document_id
  )
  values(
    o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,o.order_no,o.order_date,
    'Service Sales Invoice '||o.order_no,'draft',v_customer,'Sales Invoice','sales','sales_invoice',o.id
  )
  returning id into v_j;

  insert into public.journal_lines(
    user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,
    debit,credit,party_type,party_id,party_name
  )
  select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,
         a.id,a.code||' - '||a.name,v_total,0,'customer',o.customer_id,v_customer
  from public.chart_of_accounts a
  where a.id=v_ar;

  for r in
    select coalesce(l.revenue_account_id,v_default_rev) as account_id,
           sum(l.amount) as amount
    from public.sales_service_lines l
    where l.order_id=o.id
      and l.company_id=o.company_id
      and l.business_unit_id=o.business_unit_id
    group by coalesce(l.revenue_account_id,v_default_rev)
  loop
    insert into public.journal_lines(
      user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit
    )
    select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,
           a.id,a.code||' - '||a.name,0,r.amount
    from public.chart_of_accounts a
    where a.id=r.account_id;
  end loop;

  for r in
    select account_id,sum(amount) amount
    from public.sales_order_charges
    where order_id=o.id
    group by account_id
  loop
    insert into public.journal_lines(
      user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit
    )
    select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,
           a.id,a.code||' - '||a.name,0,r.amount
    from public.chart_of_accounts a
    where a.id=r.account_id;
  end loop;

  if v_vat>0 then
    insert into public.journal_lines(
      user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit
    )
    select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,
           a.id,a.code||' - '||a.name,0,v_vat
    from public.chart_of_accounts a
    where a.id=v_tax;
  end if;

  perform public.post_journal_entry(v_j);

  update public.sales_orders
     set status='posted',
         total=v_total,
         posted_at=now(),
         posted_by=auth.uid(),
         updated_at=now()
   where id=o.id
     and status<>'posted';

  return jsonb_build_object(
    'success',true,
    'order_id',o.id,
    'journal_entry_id',v_j,
    'subtotal_excluding_vat',v_sub+v_charge,
    'charges',v_charge,
    'vat',v_vat,
    'grand_total',v_total,
    'status','posted'
  );
end
$function$;

create or replace function public.transport_create_charged_service_document_accounted(
  p_side text,
  p_party uuid,
  p_date date,
  p_base_amount numeric,
  p_tax boolean,
  p_cost_account uuid,
  p_revenue_account uuid,
  p_description text,
  p_reference text,
  p_invoice_no text,
  p_trip_id uuid,
  p_rent_id uuid default null
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
  tax:=case when p_tax then public.fixed_tax_rate_on(c,case when p_side='customer' then 'sales' else 'purchase' end,p_date) else 0 end;
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
      tax,base,1,'service','Credit'
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
      if x.revenue_account_id is null then
        raise exception 'Charge % has no revenue account mapping',x.charge_name;
      end if;
      insert into public.sales_order_charges(
        order_id,charge_key,charge_label,amount,tax_percent,account_id,charge_type,cost_amount,
        cost_account_id,company_id,business_unit_id,quantity,rate
      )
      values(
        oid,x.charge_key,x.charge_name,x.amount,
        case when p_tax and x.tax_applicable then tax else 0 end,
        x.revenue_account_id,'recovery',0,x.cost_account_id,c,b,1,x.amount
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
$function$;

create or replace function public.transport_post_customer_bill_accounted(
  p_trip_id uuid,
  p_date date,
  p_revenue_account_id uuid,
  p_with_tax boolean default false,
  p_invoice_no text default null,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  t public.transport_trips%rowtype;
  r jsonb;
  d uuid;
  base numeric;
begin
  if length(coalesce(p_description,''))>2000 then
    raise exception 'Invoice description must be at most 2000 characters';
  end if;

  perform public.transport_finance_assert('billing');
  t:=public.transport_financial_trip(p_trip_id);

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

  r:=public.transport_create_charged_service_document_accounted(
    'customer',t.customer_id,p_date,base,p_with_tax,null,p_revenue_account_id,
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
      'revenue_account_id',p_revenue_account_id
    )
  );

  return r||jsonb_build_object('transport_document_id',d,'revenue_account_id',p_revenue_account_id);
end
$function$;

revoke all on function public.transport_create_charged_service_document_accounted(text,uuid,date,numeric,boolean,uuid,uuid,text,text,text,uuid,uuid) from public,anon;
grant execute on function public.transport_create_charged_service_document_accounted(text,uuid,date,numeric,boolean,uuid,uuid,text,text,text,uuid,uuid) to authenticated,service_role;

revoke all on function public.transport_post_customer_bill_accounted(uuid,date,uuid,boolean,text,text) from public,anon;
grant execute on function public.transport_post_customer_bill_accounted(uuid,date,uuid,boolean,text,text) to authenticated,service_role;
