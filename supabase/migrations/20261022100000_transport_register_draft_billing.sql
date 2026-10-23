-- Transport Register creates canonical service invoices as drafts. A separate,
-- explicit Register action posts them through the existing accounting engine.
alter table public.transport_customer_documents
  alter column journal_entry_id drop not null;
alter table public.transport_supplier_documents
  alter column journal_entry_id drop not null;

-- Draft invoice links are working references, not posted financial effects.
-- Keep the posted helpers aligned so the Register can edit a Trip until Post.
create or replace function public.transport_supplier_side_posted(p_trip_id uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $function$
 select exists(
   select 1
   from public.transport_supplier_document_rents l
   join public.transport_supplier_documents d on d.id=l.document_id
   join public.purchase_orders p on p.id=d.purchase_order_id
   where l.trip_id=p_trip_id and not l.is_adjustment and p.status='posted'
 )
$function$;
revoke all on function public.transport_supplier_side_posted(uuid) from public,anon,authenticated;

-- The summary currently locks any linked invoice, including Drafts. Limit the
-- lock flags to posted service documents so a saved Draft does not freeze Trips.
do $draft_locks$
declare v_definition text; v_old text; v_new text;
begin
  v_definition:=pg_get_viewdef('public.transport_trip_financial_summary'::regclass,true);
  v_old:=$old$customer_link_flags AS MATERIALIZED (
         SELECT DISTINCT transport_customer_document_trips.trip_id
           FROM transport_customer_document_trips
        )$old$;
  v_new:=$new$customer_link_flags AS MATERIALIZED (
         SELECT DISTINCT l.trip_id
           FROM transport_customer_document_trips l
           JOIN transport_customer_documents d ON d.id=l.document_id
           JOIN sales_orders o ON o.id=d.sales_order_id
          WHERE o.status='posted'
        )$new$;
  if position(v_old in v_definition)=0 then raise exception 'Customer Draft lock definition changed; review migration'; end if;
  v_definition:=replace(v_definition,v_old,v_new);
  v_old:=$old$supplier_link_flags AS MATERIALIZED (
         SELECT DISTINCT transport_supplier_document_rents.trip_id
           FROM transport_supplier_document_rents
          WHERE NOT transport_supplier_document_rents.is_adjustment
        )$old$;
  v_new:=$new$supplier_link_flags AS MATERIALIZED (
         SELECT DISTINCT l.trip_id
           FROM transport_supplier_document_rents l
           JOIN transport_supplier_documents d ON d.id=l.document_id
           JOIN purchase_orders o ON o.id=d.purchase_order_id
          WHERE NOT l.is_adjustment AND o.status='posted'
        )$new$;
  if position(v_old in v_definition)=0 then raise exception 'Supplier Draft lock definition changed; review migration'; end if;
  v_definition:=replace(v_definition,v_old,v_new);
  execute 'CREATE OR REPLACE VIEW public.transport_trip_financial_summary WITH (security_invoker=true) AS '||v_definition;
end
$draft_locks$;

-- Keep the existing guard logic, but make linked Draft bills editable. The
-- posted checks remain canonical and the change is limited to this Register's
-- customer and supplier invoice evidence.
do $draft_guards$
declare v_definition text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.transport_posted_rate_guard()'::regprocedure) into v_definition;
  v_old:='exists(select 1 from public.transport_customer_document_trips where trip_id=old.id)';
  v_definition:=replace(v_definition,v_old,'public.transport_customer_side_posted(old.id)');
  v_old:='exists(select 1 from public.transport_supplier_document_rents where trip_id=old.id)';
  v_definition:=replace(v_definition,v_old,'public.transport_supplier_side_posted(old.id)');
  if position('public.transport_customer_side_posted(old.id)' in v_definition)=0
    or position('public.transport_supplier_side_posted(old.id)' in v_definition)=0 then
    raise exception 'Transport rate guard definition changed; review Draft guard update';
  end if;
  execute v_definition;

  select pg_get_functiondef('public.transport_trip_customer_accounting_guard()'::regprocedure) into v_definition;
  v_old:='exists(select 1 from public.transport_customer_document_trips l where l.trip_id=old.id and not l.is_adjustment)';
  -- Match both the legacy guard and the canonical guard introduced by
  -- later transport migrations. Keep the posted-only protection intact.
  if position('public.transport_customer_side_posted(old.id)' in v_definition)=0 then
    v_definition:=replace(v_definition,v_old,'public.transport_customer_side_posted(old.id)');
    -- The original guard uses multiline EXISTS with arbitrary whitespace.
    -- Match only the canonical unposted customer-document predicate.
    v_definition:=regexp_replace(v_definition,
      'exists[[:space:]]*\([[:space:]]*select[[:space:]]+1[[:space:]]+from[[:space:]]+public\.transport_customer_document_trips[[:space:]]+l[[:space:]]+where[[:space:]]+l\.trip_id[[:space:]]*=[[:space:]]*old\.id[[:space:]]+and[[:space:]]+not[[:space:]]+l\.is_adjustment[[:space:]]*\)',
      'public.transport_customer_side_posted(old.id)', 'i');
    v_definition:=replace(v_definition,
      'exists(select 1 from public.transport_customer_document_trips where trip_id=old.id)',
      'public.transport_customer_side_posted(old.id)');
  end if;
  if position('public.transport_customer_side_posted(old.id)' in v_definition)=0 then
    raise exception 'Trip customer guard definition changed; review Draft guard update';
  end if;
  execute v_definition;

  select pg_get_functiondef('public.transport_finalize_supplier_rent(uuid,numeric,text)'::regprocedure) into v_definition;
  v_old:='exists(select 1 from public.transport_supplier_document_rents where rent_id=r.id and not is_adjustment)';
  v_new:='exists(select 1 from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.purchase_orders p on p.id=d.purchase_order_id where l.rent_id=r.id and not l.is_adjustment and p.status=''posted'')';
  v_definition:=replace(v_definition,v_old,v_new);
  if position(v_new in v_definition)=0 then raise exception 'Supplier rent guard definition changed; review Draft guard update'; end if;
  execute v_definition;
end
$draft_guards$;

-- Preserve the append-only evidence trigger. A private transaction gate allows
-- only Draft-trip unlinking or the journal/VAT update caused by explicit Post.
do $draft_evidence_gate$
declare v_definition text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.transport_financial_append_only()'::regprocedure) into v_definition;
  v_old:='not exists(select 1 from public.transport_supplier_document_rents l where l.rent_id=old.id and not l.is_adjustment)';
  v_new:='not exists(select 1 from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.purchase_orders p on p.id=d.purchase_order_id where l.rent_id=old.id and not l.is_adjustment and p.status=''posted'')';
  v_definition:=replace(v_definition,v_old,v_new);
  if position(v_new in v_definition)=0 then raise exception 'Supplier-rent append-only guard changed; review Draft edit gate'; end if;
  v_new:=$gate$
  if tg_table_name='transport_customer_document_trips' and tg_op in ('UPDATE','DELETE')
    and exists(select 1 from public.transport_action_gate g
      join public.transport_customer_documents d on d.id=(to_jsonb(old)->>'document_id')::uuid
      join public.sales_orders o on o.id=d.sales_order_id
      where g.transaction_id=txid_current() and g.trip_id=(to_jsonb(old)->>'trip_id')::uuid
        and g.action in ('transport_invoice_post','trip_delete','draft_invoice_delete')
        and ((o.status='draft' and d.journal_entry_id is null)
          or (g.action='transport_invoice_post' and o.status='posted' and d.journal_entry_id is not null))
        and d.company_id=public.current_company_id()
        and d.business_unit_id=public.current_business_unit_id()
        and d.operating_location_id=public.current_operating_location_id()) then
    if tg_op='DELETE' and exists(select 1 from public.transport_action_gate g where g.transaction_id=txid_current() and g.trip_id=old.trip_id and g.action in ('trip_delete','draft_invoice_delete')) then return old; end if;
    if tg_op='UPDATE' and exists(select 1 from public.transport_action_gate g where g.transaction_id=txid_current() and g.trip_id=old.trip_id and g.action='transport_invoice_post')
      and (to_jsonb(new)-'rate_snapshot'-'vat_snapshot')=(to_jsonb(old)-'rate_snapshot'-'vat_snapshot') then return new; end if;
  end if;
  if tg_table_name='transport_supplier_document_rents' and tg_op in ('UPDATE','DELETE')
    and exists(select 1 from public.transport_action_gate g
      join public.transport_supplier_documents d on d.id=(to_jsonb(old)->>'document_id')::uuid
      join public.purchase_orders o on o.id=d.purchase_order_id
      where g.transaction_id=txid_current() and g.trip_id=(to_jsonb(old)->>'trip_id')::uuid
        and g.action in ('transport_invoice_post','trip_delete','draft_invoice_delete')
        and ((o.status='draft' and d.journal_entry_id is null)
          or (g.action='transport_invoice_post' and o.status='posted' and d.journal_entry_id is not null))
        and d.company_id=public.current_company_id()
        and d.business_unit_id=public.current_business_unit_id()
        and d.operating_location_id=public.current_operating_location_id()) then
    if tg_op='DELETE' and exists(select 1 from public.transport_action_gate g where g.transaction_id=txid_current() and g.trip_id=old.trip_id and g.action in ('trip_delete','draft_invoice_delete')) then return old; end if;
    if tg_op='UPDATE' and exists(select 1 from public.transport_action_gate g where g.transaction_id=txid_current() and g.trip_id=old.trip_id and g.action='transport_invoice_post')
      and (to_jsonb(new)-'amount_snapshot'-'vat_snapshot')=(to_jsonb(old)-'amount_snapshot'-'vat_snapshot') then return new; end if;
  end if;
  if tg_table_name='transport_customer_documents' and tg_op='UPDATE'
    and old.journal_entry_id is null and new.journal_entry_id is not null
    and (to_jsonb(new)-'journal_entry_id')=(to_jsonb(old)-'journal_entry_id')
    and exists(select 1 from public.transport_customer_document_trips l join public.transport_action_gate g on g.trip_id=l.trip_id
      where l.document_id=old.id and g.transaction_id=txid_current() and g.action='transport_invoice_post') then return new; end if;
  if tg_table_name='transport_supplier_documents' and tg_op='UPDATE'
    and old.journal_entry_id is null and new.journal_entry_id is not null
    and (to_jsonb(new)-'journal_entry_id')=(to_jsonb(old)-'journal_entry_id')
    and exists(select 1 from public.transport_supplier_document_rents l join public.transport_action_gate g on g.trip_id=l.trip_id
      where l.document_id=old.id and g.transaction_id=txid_current() and g.action='transport_invoice_post') then return new; end if;
  if tg_table_name='transport_customer_documents' and tg_op='DELETE'
    and old.journal_entry_id is null and old.company_id=public.current_company_id()
    and old.business_unit_id=public.current_business_unit_id()
    and old.operating_location_id=public.current_operating_location_id()
    and exists(select 1 from public.transport_action_gate g where g.transaction_id=txid_current()
      and g.trip_id=old.id and g.action='draft_invoice_delete') then return old; end if;
  if tg_table_name='transport_supplier_documents' and tg_op='DELETE'
    and old.journal_entry_id is null and old.company_id=public.current_company_id()
    and old.business_unit_id=public.current_business_unit_id()
    and old.operating_location_id=public.current_operating_location_id()
    and exists(select 1 from public.transport_action_gate g where g.transaction_id=txid_current()
      and g.trip_id=old.id and g.action='draft_invoice_delete') then return old; end if;
$gate$;
  if position(E'begin\n' in v_definition)>0 then
    v_definition:=replace(v_definition,E'begin\n',E'begin\n'||v_new);
  elsif position(E'BEGIN\n' in v_definition)>0 then
    v_definition:=replace(v_definition,E'BEGIN\n',E'BEGIN\n'||v_new);
  else
    raise exception 'Evidence append-only function body marker changed; review Draft gate';
  end if;
  if position('transport_invoice_post' in v_definition)=0 then raise exception 'Evidence append-only function definition changed; review Draft gate'; end if;
  execute v_definition;
end
$draft_evidence_gate$;

-- Removing a Trip from a Draft invoice also removes only that Trip's draft
-- lines and evidence. The original Draft invoice and the other Trips remain.
do $draft_trip_delete$
declare v_definition text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.transport_delete_draft_trip(uuid,text)'::regprocedure) into v_definition;

  v_old:='exists(select 1 from public.sales_service_lines where source_module in (''transport'',''transport_trip'') and source_id=t.id)';
  v_new:=$new$exists(select 1 from public.sales_service_lines sl join public.sales_orders o on o.id=sl.order_id
    where sl.source_module in ('transport','transport_trip') and sl.source_id=t.id
      and (o.status='posted' or not exists(select 1 from public.transport_customer_document_trips l
        join public.transport_customer_documents d on d.id=l.document_id
        where l.trip_id=t.id and d.sales_order_id=o.id and d.journal_entry_id is null)))$new$;
  v_definition:=replace(v_definition,v_old,v_new);
  if position(v_new in v_definition)=0 then raise exception 'Customer service-line delete guard changed; review Draft Trip delete'; end if;

  v_old:='exists(select 1 from public.purchase_service_lines where source_module in (''transport'',''transport_trip'') and (source_id=t.id or source_id in (select id from public.transport_trip_supplier_rents where trip_id=t.id)))';
  v_new:=$new$exists(select 1 from public.purchase_service_lines sl join public.purchase_orders o on o.id=sl.order_id
    where sl.source_module in ('transport','transport_trip')
      and (sl.source_id=t.id or sl.source_id in (select id from public.transport_trip_supplier_rents where trip_id=t.id))
      and (o.status='posted' or not exists(select 1 from public.transport_supplier_document_rents l
        join public.transport_supplier_documents d on d.id=l.document_id
        where l.trip_id=t.id and d.purchase_order_id=o.id and d.journal_entry_id is null)))$new$;
  v_definition:=replace(v_definition,v_old,v_new);
  if position(v_new in v_definition)=0 then raise exception 'Supplier service-line delete guard changed; review Draft Trip delete'; end if;

  v_old:='exists(select 1 from public.transport_customer_document_trips where trip_id=t.id)';
  v_new:='exists(select 1 from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders o on o.id=d.sales_order_id where l.trip_id=t.id and o.status=''posted'')';
  v_definition:=replace(v_definition,v_old,v_new);
  if position(v_new in v_definition)=0 then raise exception 'Customer document delete guard changed; review Draft Trip delete'; end if;

  v_old:='exists(select 1 from public.transport_supplier_document_rents where trip_id=t.id)';
  v_new:='exists(select 1 from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.purchase_orders o on o.id=d.purchase_order_id where l.trip_id=t.id and o.status=''posted'')';
  v_definition:=replace(v_definition,v_old,v_new);
  if position(v_new in v_definition)=0 then raise exception 'Supplier document delete guard changed; review Draft Trip delete'; end if;

  v_old:='insert into public.transport_action_gate values(txid_current(),t.id,''trip_delete'');';
  v_new:=$cleanup$insert into public.transport_action_gate values(txid_current(),t.id,'trip_delete');
 -- Reduce grouped charge lines by the deleted Trip before removing its source rows.
 update public.sales_order_charges c set amount=round(c.amount-x.amount,2)
   from (select d.sales_order_id,cm.charge_key,sl.revenue_account_id account_id,round(sum(tc.amount),2) amount
           from public.transport_customer_document_trips l
           join public.transport_customer_documents d on d.id=l.document_id
           join public.sales_orders o on o.id=d.sales_order_id and o.status='draft'
           join public.transport_trip_customer_charges tc on tc.trip_id=l.trip_id
           join public.charge_master cm on cm.id=tc.charge_master_id
           join public.sales_service_lines sl on sl.order_id=o.id and sl.source_module='transport' and sl.source_id=l.trip_id
          where l.trip_id=t.id and d.journal_entry_id is null
          group by d.sales_order_id,cm.charge_key,sl.revenue_account_id) x
  where c.order_id=x.sales_order_id and c.charge_key=x.charge_key and c.account_id=x.account_id;
 delete from public.sales_order_charges where amount<=0 and order_id in
   (select d.sales_order_id from public.transport_customer_documents d join public.transport_customer_document_trips l on l.document_id=d.id where l.trip_id=t.id and d.journal_entry_id is null);
 update public.purchase_order_charges c set amount=round(c.amount-x.amount,2)
   from (select d.purchase_order_id,cm.charge_key,round(sum(sc.amount),2) amount
           from public.transport_supplier_document_rents l
           join public.transport_supplier_documents d on d.id=l.document_id
           join public.purchase_orders o on o.id=d.purchase_order_id and o.status='draft'
           join public.transport_trip_supplier_charges sc on sc.trip_id=l.trip_id
           join public.charge_master cm on cm.id=sc.charge_master_id
          where l.trip_id=t.id and d.journal_entry_id is null
          group by d.purchase_order_id,cm.charge_key) x
  where c.order_id=x.purchase_order_id and c.charge_key=x.charge_key;
 delete from public.purchase_order_charges where amount<=0 and order_id in
   (select d.purchase_order_id from public.transport_supplier_documents d join public.transport_supplier_document_rents l on l.document_id=d.id where l.trip_id=t.id and d.journal_entry_id is null);
 delete from public.sales_service_lines sl using public.transport_customer_document_trips l,public.transport_customer_documents d,public.sales_orders o
  where l.trip_id=t.id and d.id=l.document_id and o.id=d.sales_order_id and o.status='draft' and d.journal_entry_id is null
    and sl.order_id=o.id and sl.source_module='transport' and sl.source_id=t.id;
 delete from public.transport_customer_document_trips l using public.transport_customer_documents d,public.sales_orders o
  where l.trip_id=t.id and d.id=l.document_id and o.id=d.sales_order_id and o.status='draft' and d.journal_entry_id is null;
 delete from public.purchase_service_lines sl using public.transport_supplier_document_rents l,public.transport_supplier_documents d,public.purchase_orders o
  where l.trip_id=t.id and d.id=l.document_id and o.id=d.purchase_order_id and o.status='draft' and d.journal_entry_id is null
    and sl.order_id=o.id and sl.source_module='transport' and sl.source_id=t.id;
 delete from public.transport_supplier_document_rents l using public.transport_supplier_documents d,public.purchase_orders o
  where l.trip_id=t.id and d.id=l.document_id and o.id=d.purchase_order_id and o.status='draft' and d.journal_entry_id is null;
$cleanup$;
  v_definition:=replace(v_definition,v_old,v_new);
  if position('Reduce grouped charge lines by the deleted Trip' in v_definition)=0 then raise exception 'Trip deletion gate changed; review Draft Trip cleanup'; end if;
  execute v_definition;
end
$draft_trip_delete$;

do $migration$
declare
  v_name text;
  v_def text;
  v_source text;
  v_post text;
begin
  foreach v_name in array array['customer','supplier'] loop
    v_source := case when v_name='customer'
      then 'transport_post_customer_bill_grouped'
      else 'transport_post_supplier_bill_grouped' end;
    v_post := case when v_name='customer'
      then 'public.post_sales_invoice(v_order)'
      else 'public.post_purchase_invoice(v_order)' end;
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v_source
    order by p.oid limit 1;
    if v_def is null then raise exception 'Missing canonical grouped % invoice function',v_name; end if;

    v_def := replace(v_def, 'public.'||v_source,
      'public.transport_create_'||v_name||'_draft_grouped');
    if position(v_post in v_def)=0 then
      raise exception 'Grouped % function no longer contains expected canonical post call',v_name;
    end if;
    v_def := replace(v_def, 'v_post:='||v_post||';',
      $replacement$
      select jsonb_build_object(
        'status','draft',
        'order_id',v_order,
        'subtotal_excluding_vat',coalesce(sum(amount),0),
        'vat',coalesce(sum(round(amount*tax_percent/100,2)),0),
        'total',coalesce(sum(amount+round(amount*tax_percent/100,2)),0)
      ) into v_post
      from (
        select amount,tax_percent from public.$line_table$ where order_id=v_order
        union all
        select amount,tax_percent from public.$charge_table$ where order_id=v_order
      ) draft_totals;
      $replacement$);
    v_def := replace(v_def, '(v_post->>''journal_entry_id'')::uuid', 'null::uuid');
    v_def := replace(v_def, '''customer_bill_posted''', '''customer_bill_draft_created''');
    v_def := replace(v_def, '''supplier_bill_posted''', '''supplier_bill_draft_created''');
    v_def := replace(v_def, '''grouped_invoice'',true', '''grouped_invoice'',true,''status'',''draft''');
    v_def := replace(v_def, 'public.sales_service_lines where order_id=v_order', 'public.sales_service_lines where order_id=v_order');
    v_def := replace(v_def, 'public.purchase_service_lines where order_id=v_order', 'public.purchase_service_lines where order_id=v_order');
    v_def := replace(v_def, 'public.sales_order_charges where order_id=v_order', 'public.sales_order_charges where order_id=v_order');
    v_def := replace(v_def, 'public.purchase_order_charges where order_id=v_order', 'public.purchase_order_charges where order_id=v_order');
    v_def := replace(v_def, '$line_table$', case when v_name='customer' then 'sales_service_lines' else 'purchase_service_lines' end);
    v_def := replace(v_def, '$charge_table$', case when v_name='customer' then 'sales_order_charges' else 'purchase_order_charges' end);
    if position('post_sales_invoice(v_order)' in v_def)>0 or position('post_purchase_invoice(v_order)' in v_def)>0 then
      raise exception 'Draft % creation still includes an accounting post call',v_name;
    end if;
    execute v_def;
  end loop;
end
$migration$;

create or replace function public.transport_post_customer_draft(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare d public.transport_customer_documents%rowtype; o public.sales_orders%rowtype; v_result jsonb;
begin
  perform public.transport_finance_assert('billing');
  perform public.assert_module_permission('sales','edit');
  select * into d from public.transport_customer_documents
   where id=p_document_id and company_id=public.current_company_id()
     and business_unit_id=public.current_business_unit_id()
     and operating_location_id=public.current_operating_location_id() for update;
  if not found then raise exception 'Draft customer invoice not found in active Register'; end if;
  select * into o from public.sales_orders where id=d.sales_order_id for update;
  if o.status is distinct from 'draft' or d.journal_entry_id is not null then raise exception 'Customer invoice is already posted or is not a draft'; end if;
  if not exists(select 1 from public.transport_customer_document_trips where document_id=d.id and not is_adjustment) then raise exception 'Draft invoice has no trips'; end if;
  insert into public.transport_action_gate(transaction_id,trip_id,action)
    select txid_current(),l.trip_id,'transport_invoice_post' from public.transport_customer_document_trips l
    where l.document_id=d.id and not l.is_adjustment on conflict do nothing;
  update public.sales_service_lines sl
     set amount=round(coalesce(t.customer_base_rate,t.customer_rate)+coalesce(t.customer_manual_adjustment,0),2),
         description=public.transport_trip_service_description(t.id)
    from public.transport_customer_document_trips l join public.transport_trips t on t.id=l.trip_id
   where l.document_id=d.id and not l.is_adjustment and sl.order_id=o.id
     and sl.source_module='transport' and sl.source_id=t.id;
  update public.transport_customer_document_trips l set rate_snapshot=t.customer_rate_snapshot
    from public.transport_trips t where l.document_id=d.id and not l.is_adjustment and t.id=l.trip_id;
  v_result:=public.post_sales_invoice(o.id);
  update public.transport_customer_document_trips l set vat_snapshot=round(l.vat_snapshot+(
    coalesce((v_result->>'vat')::numeric,0)-coalesce((select sum(x.vat_snapshot) from public.transport_customer_document_trips x where x.document_id=d.id),0)
  ),2) where l.id=(select x.id from public.transport_customer_document_trips x where x.document_id=d.id order by x.id desc limit 1)
    and abs(coalesce((v_result->>'vat')::numeric,0)-(select coalesce(sum(x.vat_snapshot),0) from public.transport_customer_document_trips x where x.document_id=d.id))>=0.005;
  perform public.transport_financial_audit(l.trip_id,'customer_bill_posted',v_result||jsonb_build_object('transport_document_id',d.id,'invoice_no',o.order_no,'manual_register_post',true))
    from public.transport_customer_document_trips l where l.document_id=d.id and not l.is_adjustment;
  delete from public.transport_action_gate where transaction_id=txid_current() and action='transport_invoice_post'
    and trip_id in (select l.trip_id from public.transport_customer_document_trips l where l.document_id=d.id);
  return v_result||jsonb_build_object('transport_document_id',d.id,'invoice_no',o.order_no,'status','posted');
end $function$;

create or replace function public.transport_post_supplier_draft(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare d public.transport_supplier_documents%rowtype; o public.purchase_orders%rowtype; v_result jsonb;
begin
  perform public.transport_finance_assert('rent');
  perform public.assert_module_permission('purchase','edit');
  select * into d from public.transport_supplier_documents
   where id=p_document_id and company_id=public.current_company_id()
     and business_unit_id=public.current_business_unit_id()
     and operating_location_id=public.current_operating_location_id() for update;
  if not found then raise exception 'Draft supplier invoice not found in active Register'; end if;
  select * into o from public.purchase_orders where id=d.purchase_order_id for update;
  if o.status is distinct from 'draft' or d.journal_entry_id is not null then raise exception 'Supplier invoice is already posted or is not a draft'; end if;
  if not exists(select 1 from public.transport_supplier_document_rents where document_id=d.id and not is_adjustment) then raise exception 'Draft supplier invoice has no trips'; end if;
  insert into public.transport_action_gate(transaction_id,trip_id,action)
    select txid_current(),l.trip_id,'transport_invoice_post' from public.transport_supplier_document_rents l
    where l.document_id=d.id and not l.is_adjustment on conflict do nothing;
  update public.purchase_service_lines sl
     set amount=round((select coalesce(sum(r.base_amount),sum(r.amount))
                         from public.transport_supplier_document_rents l2
                         join public.transport_trip_supplier_rents r on r.id=l2.rent_id
                        where l2.document_id=d.id and l2.trip_id=t.id and not l2.is_adjustment),2),
         description=public.transport_trip_service_description(t.id)||' · Supplier rent'
    from public.transport_supplier_document_rents l join public.transport_trips t on t.id=l.trip_id
   where l.document_id=d.id and not l.is_adjustment and sl.order_id=o.id
     and sl.source_module='transport' and sl.source_id=t.id;
  update public.transport_supplier_document_rents l set amount_snapshot=r.finalized_amount_snapshot
    from public.transport_trip_supplier_rents r where l.document_id=d.id and not l.is_adjustment and r.id=l.rent_id;
  v_result:=public.post_purchase_invoice(o.id);
  update public.transport_supplier_document_rents l set vat_snapshot=round(l.vat_snapshot+(
    coalesce((v_result->>'vat')::numeric,0)-coalesce((select sum(x.vat_snapshot) from public.transport_supplier_document_rents x where x.document_id=d.id),0)
  ),2) where l.id=(select x.id from public.transport_supplier_document_rents x where x.document_id=d.id order by x.id desc limit 1)
    and abs(coalesce((v_result->>'vat')::numeric,0)-(select coalesce(sum(x.vat_snapshot),0) from public.transport_supplier_document_rents x where x.document_id=d.id))>=0.005;
  perform public.transport_financial_audit(l.trip_id,'supplier_bill_posted',v_result||jsonb_build_object('transport_document_id',d.id,'invoice_no',o.order_no,'manual_register_post',true))
    from public.transport_supplier_document_rents l where l.document_id=d.id and not l.is_adjustment;
  delete from public.transport_action_gate where transaction_id=txid_current() and action='transport_invoice_post'
    and trip_id in (select l.trip_id from public.transport_supplier_document_rents l where l.document_id=d.id);
  return v_result||jsonb_build_object('transport_document_id',d.id,'invoice_no',o.order_no,'status','posted');
end $function$;

create or replace function public.transport_refresh_draft_invoice(p_side text,p_document_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_order_id uuid; v_count integer;
begin
  if p_side='customer' then
    perform public.transport_finance_assert('billing');
    perform public.assert_module_permission('sales','edit');
    select d.sales_order_id into v_order_id from public.transport_customer_documents d
      join public.sales_orders o on o.id=d.sales_order_id
     where d.id=p_document_id and d.company_id=public.current_company_id()
       and d.business_unit_id=public.current_business_unit_id()
       and d.operating_location_id=public.current_operating_location_id()
       and d.journal_entry_id is null and o.status='draft' and o.document_kind='service' for update of d,o;
    if not found then raise exception 'Draft customer invoice not found in active Register'; end if;
    if not exists(select 1 from public.transport_customer_document_trips where document_id=p_document_id and not is_adjustment) then raise exception 'Draft invoice has no Trips'; end if;
    insert into public.transport_action_gate(transaction_id,trip_id,action)
      select txid_current(),l.trip_id,'transport_invoice_post' from public.transport_customer_document_trips l
       where l.document_id=p_document_id and not l.is_adjustment on conflict do nothing;
    update public.sales_service_lines sl set
       amount=round(coalesce(t.customer_base_rate,t.customer_rate)+coalesce(t.customer_manual_adjustment,0),2),
       description=public.transport_trip_service_description(t.id)
      from public.transport_customer_document_trips l join public.transport_trips t on t.id=l.trip_id
     where l.document_id=p_document_id and not l.is_adjustment and sl.order_id=v_order_id
       and sl.source_module='transport' and sl.source_id=t.id;
    get diagnostics v_count=row_count;
    update public.transport_customer_document_trips l set rate_snapshot=t.customer_rate_snapshot
      from public.transport_trips t where l.document_id=p_document_id and not l.is_adjustment and t.id=l.trip_id;
    delete from public.transport_action_gate where transaction_id=txid_current() and action='transport_invoice_post'
      and trip_id in (select l.trip_id from public.transport_customer_document_trips l where l.document_id=p_document_id);
  elsif p_side='supplier' then
    perform public.transport_finance_assert('rent');
    perform public.assert_module_permission('purchase','edit');
    select d.purchase_order_id into v_order_id from public.transport_supplier_documents d
      join public.purchase_orders o on o.id=d.purchase_order_id
     where d.id=p_document_id and d.company_id=public.current_company_id()
       and d.business_unit_id=public.current_business_unit_id()
       and d.operating_location_id=public.current_operating_location_id()
       and d.journal_entry_id is null and o.status='draft' and o.document_kind='service' for update of d,o;
    if not found then raise exception 'Draft supplier invoice not found in active Register'; end if;
    if not exists(select 1 from public.transport_supplier_document_rents where document_id=p_document_id and not is_adjustment) then raise exception 'Draft invoice has no Trips'; end if;
    insert into public.transport_action_gate(transaction_id,trip_id,action)
      select txid_current(),l.trip_id,'transport_invoice_post' from public.transport_supplier_document_rents l
       where l.document_id=p_document_id and not l.is_adjustment on conflict do nothing;
    update public.purchase_service_lines sl set
       amount=round((select coalesce(sum(r.base_amount),sum(r.amount)) from public.transport_supplier_document_rents l2
                     join public.transport_trip_supplier_rents r on r.id=l2.rent_id
                    where l2.document_id=p_document_id and l2.trip_id=t.id and not l2.is_adjustment),2),
       description=public.transport_trip_service_description(t.id)||' · Supplier rent'
      from public.transport_supplier_document_rents l join public.transport_trips t on t.id=l.trip_id
     where l.document_id=p_document_id and not l.is_adjustment and sl.order_id=v_order_id
       and sl.source_module='transport' and sl.source_id=t.id;
    get diagnostics v_count=row_count;
    update public.transport_supplier_document_rents l set amount_snapshot=r.finalized_amount_snapshot
      from public.transport_trip_supplier_rents r where l.document_id=p_document_id and not l.is_adjustment and r.id=l.rent_id;
    delete from public.transport_action_gate where transaction_id=txid_current() and action='transport_invoice_post'
      and trip_id in (select l.trip_id from public.transport_supplier_document_rents l where l.document_id=p_document_id);
  else
    raise exception 'Invoice side must be customer or supplier';
  end if;
  return jsonb_build_object('status','refreshed','order_id',v_order_id,'line_count',coalesce(v_count,0));
end $function$;
revoke all on function public.transport_refresh_draft_invoice(text,uuid) from public,anon;
grant execute on function public.transport_refresh_draft_invoice(text,uuid) to authenticated;

create or replace function public.transport_delete_register_draft_invoice(p_side text,p_document_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_order_id uuid; v_deleted boolean; v_doc_company uuid; v_doc_bu uuid; v_doc_location uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_side='customer' then
    perform public.transport_finance_assert('billing');
    select d.sales_order_id,d.company_id,d.business_unit_id,d.operating_location_id
      into v_order_id,v_doc_company,v_doc_bu,v_doc_location
      from public.transport_customer_documents d join public.sales_orders o on o.id=d.sales_order_id
     where d.id=p_document_id and d.company_id=public.current_company_id()
       and d.business_unit_id=public.current_business_unit_id()
       and d.operating_location_id=public.current_operating_location_id()
       and d.journal_entry_id is null and o.status='draft' and o.document_kind='service' for update of d,o;
    if not found then raise exception 'Draft customer invoice not found in active Register'; end if;
    insert into public.transport_action_gate(transaction_id,trip_id,action)
      select txid_current(),l.trip_id,'draft_invoice_delete' from public.transport_customer_document_trips l where l.document_id=p_document_id
      union select txid_current(),p_document_id,'draft_invoice_delete' on conflict do nothing;
    delete from public.sales_service_lines where order_id=v_order_id;
    delete from public.sales_order_charges where order_id=v_order_id;
    delete from public.transport_customer_document_trips where document_id=p_document_id;
    delete from public.transport_customer_documents where id=p_document_id;
    v_deleted:=public.delete_draft_sales_invoice(v_order_id);
  elsif p_side='supplier' then
    perform public.transport_finance_assert('rent');
    select d.purchase_order_id,d.company_id,d.business_unit_id,d.operating_location_id
      into v_order_id,v_doc_company,v_doc_bu,v_doc_location
      from public.transport_supplier_documents d join public.purchase_orders o on o.id=d.purchase_order_id
     where d.id=p_document_id and d.company_id=public.current_company_id()
       and d.business_unit_id=public.current_business_unit_id()
       and d.operating_location_id=public.current_operating_location_id()
       and d.journal_entry_id is null and o.status='draft' and o.document_kind='service' for update of d,o;
    if not found then raise exception 'Draft supplier invoice not found in active Register'; end if;
    insert into public.transport_action_gate(transaction_id,trip_id,action)
      select txid_current(),l.trip_id,'draft_invoice_delete' from public.transport_supplier_document_rents l where l.document_id=p_document_id
      union select txid_current(),p_document_id,'draft_invoice_delete' on conflict do nothing;
    delete from public.purchase_service_lines where order_id=v_order_id;
    delete from public.purchase_order_charges where order_id=v_order_id;
    delete from public.transport_supplier_document_rents where document_id=p_document_id;
    delete from public.transport_supplier_documents where id=p_document_id;
    v_deleted:=public.delete_draft_purchase_invoice(v_order_id);
  else
    raise exception 'Invoice side must be customer or supplier';
  end if;
  if not coalesce(v_deleted,false) then raise exception 'Draft invoice could not be deleted'; end if;
  delete from public.transport_action_gate where transaction_id=txid_current() and action='draft_invoice_delete';
  return jsonb_build_object('deleted',true,'document_id',p_document_id,'side',p_side);
end $function$;
revoke all on function public.transport_delete_register_draft_invoice(text,uuid) from public,anon;
grant execute on function public.transport_delete_register_draft_invoice(text,uuid) to authenticated;

create or replace function public.transport_register_draft_invoice_list()
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
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
       where public.transport_finance_allowed('billing')
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
       where public.transport_finance_allowed('rent')
         and d.company_id=public.current_company_id() and d.business_unit_id=public.current_business_unit_id()
         and d.operating_location_id=public.current_operating_location_id()
         and d.journal_entry_id is null and p.status='draft' and p.document_kind='service'
       group by d.id,p.id,sp.name
    ) x;
  return jsonb_build_object('rows',v_rows);
end $function$;
revoke all on function public.transport_register_draft_invoice_list() from public,anon;
grant execute on function public.transport_register_draft_invoice_list() to authenticated;

revoke all on function public.transport_create_customer_draft_grouped(uuid[],date,uuid,boolean,text,jsonb) from public,anon;
grant execute on function public.transport_create_customer_draft_grouped(uuid[],date,uuid,boolean,text,jsonb) to authenticated,service_role;
revoke all on function public.transport_create_supplier_draft_grouped(uuid[],date,uuid,boolean,text,text,jsonb) from public,anon;
grant execute on function public.transport_create_supplier_draft_grouped(uuid[],date,uuid,boolean,text,text,jsonb) to authenticated,service_role;
revoke all on function public.transport_post_customer_draft(uuid) from public,anon;
grant execute on function public.transport_post_customer_draft(uuid) to authenticated,service_role;
revoke all on function public.transport_post_supplier_draft(uuid) from public,anon;
grant execute on function public.transport_post_supplier_draft(uuid) to authenticated,service_role;
notify pgrst,'reload schema';
