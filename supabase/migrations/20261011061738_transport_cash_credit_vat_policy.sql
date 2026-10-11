-- Transport billing classification: Cash = without VAT; Credit = dated VAT.
-- Payment/settlement remains separate. No posted history is rewritten.
begin;
create table public.transport_supplier_billing_modes (
 company_id uuid not null references public.companies(id),
 business_unit_id uuid not null references public.business_units(id),
 supplier_id uuid not null references public.suppliers(id),
 billing_mode text not null check(billing_mode in ('Cash','Credit')),
 updated_by uuid references auth.users(id),updated_at timestamptz not null default now(),
 primary key(company_id,business_unit_id,supplier_id)
);
alter table public.transport_supplier_billing_modes enable row level security;
revoke all on public.transport_supplier_billing_modes from public,anon,authenticated;
-- Do not infer a supplier's future billing rule from old invoice VAT or payments.
alter table public.purchase_orders add column transport_billing_mode text check(transport_billing_mode in ('Cash','Credit'));
alter table public.sales_orders add column transport_billing_origin_id uuid references public.sales_orders(id);
create table public.transport_billing_correction_gate(transaction_id bigint primary key,origin_order_id uuid not null references public.sales_orders(id));
alter table public.transport_billing_correction_gate enable row level security;
revoke all on public.transport_billing_correction_gate from public,anon,authenticated;

create table public.transport_billing_adjustment_gate(transaction_id bigint primary key,side text not null,party_id uuid not null,company_id uuid not null,business_unit_id uuid not null,billing_mode text not null,tax_percent numeric not null);
alter table public.transport_billing_adjustment_gate enable row level security;
revoke all on public.transport_billing_adjustment_gate from public,anon,authenticated;
create function public.transport_party_billing_mode(p_side text,p_company uuid,p_business_unit uuid,p_party uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v text;
begin
 if auth.uid() is null or p_company is distinct from public.current_company_id()
 or p_business_unit is distinct from public.current_business_unit_id()
 or not public.transport_customer_billing_scope(p_company,p_business_unit)
 then raise exception 'Active Transport workspace required';end if;
 if p_side not in ('customer','supplier') or p_side is null or p_party is null then raise exception 'Customer or supplier required';end if;
 select billing_mode into v from public.transport_billing_adjustment_gate where transaction_id=txid_current() and side=p_side and party_id=p_party and company_id=p_company and business_unit_id=p_business_unit;
 if found then return v;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||':'||p_business_unit::text||':'||p_party::text||':billing_mode',0));
 if p_side='customer' then
  select m.billing_mode into v from public.transport_customer_billing_modes m join public.customers x on x.id=m.customer_id and x.company_id=m.company_id and x.is_active
  where m.company_id=p_company and m.business_unit_id=p_business_unit and m.customer_id=p_party;
 else
  select m.billing_mode into v from public.transport_supplier_billing_modes m join public.suppliers x on x.id=m.supplier_id and x.company_id=m.company_id and x.is_active
  where m.company_id=p_company and m.business_unit_id=p_business_unit and m.supplier_id=p_party;
 end if;
 if v is null then raise exception 'Set % Cash/Credit in Transport Master Billing Rules before billing',initcap(p_side);end if;
 return v;
end $$;
revoke all on function public.transport_party_billing_mode(text,uuid,uuid,uuid) from public,anon,authenticated;

create function public.transport_billing_modes(p_side text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();v jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if p_side not in ('customer','supplier') or p_side is null then raise exception 'Invalid party side';end if;
 perform public.assert_module_permission(case when p_side='customer' then 'sales' else 'purchase' end,'view');
 if not public.transport_customer_billing_scope(c,b) then return jsonb_build_object('enabled',false,'rows','[]'::jsonb);end if;
 if p_side='customer' then
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'mode',m.billing_mode,
   'cash_invoices',(select count(*) from public.sales_orders s where s.company_id=c and s.business_unit_id=b and s.customer_id=x.id and s.payment_mode='Cash'),
   'credit_invoices',(select count(*) from public.sales_orders s where s.company_id=c and s.business_unit_id=b and s.customer_id=x.id and s.payment_mode='Credit')) order by x.name),'[]'::jsonb) into v
  from public.customers x left join public.transport_customer_billing_modes m on m.company_id=c and m.business_unit_id=b and m.customer_id=x.id where x.company_id=c and x.is_active;
 else
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'mode',m.billing_mode,
   'cash_invoices',(select count(*) from public.purchase_orders s where s.company_id=c and s.business_unit_id=b and s.supplier_id=x.id and s.transport_billing_mode='Cash'),
   'credit_invoices',(select count(*) from public.purchase_orders s where s.company_id=c and s.business_unit_id=b and s.supplier_id=x.id and s.transport_billing_mode='Credit')) order by x.name),'[]'::jsonb) into v
  from public.suppliers x left join public.transport_supplier_billing_modes m on m.company_id=c and m.business_unit_id=b and m.supplier_id=x.id where x.company_id=c and x.is_active;
 end if;
 return jsonb_build_object('enabled',true,'rows',v);
end $$;
revoke all on function public.transport_billing_modes(text) from public,anon;
grant execute on function public.transport_billing_modes(text) to authenticated;

create function public.transport_billing_rate(p_company uuid,p_side text,p_date date,p_mode text)
returns numeric language plpgsql security definer set search_path=public,pg_temp as $$
declare r numeric;
begin
 select tax_percent into r from public.transport_billing_adjustment_gate where transaction_id=txid_current() and side=p_side and company_id=p_company and business_unit_id=public.current_business_unit_id();
 if found then return r;end if;
 if p_mode='Cash' then return 0;end if;
 if p_mode is distinct from 'Credit' or p_date is null then raise exception 'Billing mode and invoice date required';end if;
 r:=public.fixed_tax_rate_on(p_company,case when p_side='customer' then 'sales' else 'purchase' end,p_date);
 if r is null or r<=0 or r>100 then raise exception 'Configure a positive effective % VAT rate for %',p_side,p_date;end if;
 return r;
end $$;
revoke all on function public.transport_billing_rate(uuid,text,date,text) from public,anon,authenticated;

create function public.transport_order_billing_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=coalesce(new.company_id,public.current_company_id());b uuid:=coalesce(new.business_unit_id,public.current_business_unit_id());
 s text:=case when tg_table_name='sales_orders' then 'customer' else 'supplier' end;m text;r numeric;o public.sales_orders%rowtype;origin uuid;
begin
 if new.document_kind is distinct from 'service' or not public.transport_customer_billing_scope(c,b) then return new;end if;
 if tg_op='UPDATE' and old.status<>'draft' then return new;end if;
 if s='customer' then origin:=new.transport_billing_origin_id;end if;
 if origin is not null then
  if tg_op='INSERT' or new.transport_billing_origin_id is distinct from old.transport_billing_origin_id then
   if not exists(select 1 from public.transport_billing_correction_gate g where g.transaction_id=txid_current() and g.origin_order_id=new.transport_billing_origin_id) then raise exception 'Billing origin requires controlled financial correction';end if;
  end if;
  select * into o from public.sales_orders where id=new.transport_billing_origin_id and company_id=c and business_unit_id=b and customer_id=new.customer_id and status='posted';
  if not found then raise exception 'Posted same-party billing origin required';end if;
  m:=o.payment_mode;r:=o.tax_percent;
 else
  if s='customer' then m:=public.transport_party_billing_mode(s,c,b,new.customer_id);
  else m:=public.transport_party_billing_mode(s,c,b,new.supplier_id);end if;
  r:=public.transport_billing_rate(c,s,new.order_date,m);
 end if;
 if new.status='posted' then
  if new.tax_percent is distinct from r or new.invoice_type is distinct from(case when m='Credit' then 'Tax Invoice' when s='customer' then 'Sale Invoice' else 'Purchase Invoice' end) then raise exception 'Refresh draft billing before posting';end if;
 else
  new.tax_percent:=r;
  new.invoice_type:=case when m='Credit' then 'Tax Invoice' when s='customer' then 'Sale Invoice' else 'Purchase Invoice' end;
 end if;
 if s='customer' then new.payment_mode:=m;else new.transport_billing_mode:=m;end if;
 return new;
end $$;
revoke all on function public.transport_order_billing_guard() from public,anon,authenticated;
create trigger a_transport_billing_policy before insert or update of customer_id,payment_mode,order_date,invoice_type,tax_percent,status,transport_billing_origin_id
on public.sales_orders for each row execute function public.transport_order_billing_guard();
create trigger a_transport_billing_policy before insert or update of supplier_id,transport_billing_mode,order_date,invoice_type,tax_percent,status
on public.purchase_orders for each row execute function public.transport_order_billing_guard();

-- New lines inherit their draft's snapshot even if a caller sends a manual VAT flag.
create function public.transport_line_billing_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare o record;s text:=case when tg_table_name in ('sales_service_lines','sales_order_charges') then 'customer' else 'supplier' end;taxable boolean:=true;
begin
 if s='customer' then select * into o from public.sales_orders where id=new.order_id;
 else select * into o from public.purchase_orders where id=new.order_id;end if;
 if not found or o.document_kind is distinct from 'service' or not public.transport_customer_billing_scope(o.company_id,o.business_unit_id) then return new;end if;
 if o.status<>'draft' then raise exception 'Posted service billing is immutable';end if;
 if tg_table_name in ('sales_order_charges','purchase_order_charges') then
  select cm.tax_applicable into taxable from public.charge_master cm where cm.company_id=o.company_id and cm.charge_key=new.charge_key and cm.is_active;
  if not found then raise exception 'Active charge master required';end if;
 end if;
 new.tax_percent:=case when o.invoice_type='Tax Invoice' and taxable then o.tax_percent else 0 end;
 return new;
end $$;
revoke all on function public.transport_line_billing_guard() from public,anon,authenticated;
create trigger a_transport_line_billing_policy before insert or update on public.sales_service_lines for each row execute function public.transport_line_billing_guard();
create trigger a_transport_line_billing_policy before insert or update on public.purchase_service_lines for each row execute function public.transport_line_billing_guard();
create trigger a_transport_line_billing_policy before insert or update on public.sales_order_charges for each row execute function public.transport_line_billing_guard();
create trigger a_transport_line_billing_policy before insert or update on public.purchase_order_charges for each row execute function public.transport_line_billing_guard();

create function public.transport_sync_draft_billing() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v numeric;
begin
 if new.status<>'draft' or new.document_kind is distinct from 'service' or not public.transport_customer_billing_scope(new.company_id,new.business_unit_id) then return new;end if;
 if tg_table_name='sales_orders' then
  update public.sales_service_lines set tax_percent=new.tax_percent where order_id=new.id and tax_percent is distinct from new.tax_percent;
  update public.sales_order_charges x set tax_percent=case when new.invoice_type='Tax Invoice' and cm.tax_applicable then new.tax_percent else 0 end
   from public.charge_master cm where x.order_id=new.id and cm.company_id=new.company_id and cm.charge_key=x.charge_key and cm.is_active
   and x.tax_percent is distinct from(case when new.invoice_type='Tax Invoice' and cm.tax_applicable then new.tax_percent else 0 end);
  select coalesce(sum(amount+round(amount*tax_percent/100,2)),0) into v from (
   select amount,tax_percent from public.sales_service_lines where order_id=new.id union all select amount,tax_percent from public.sales_order_charges where order_id=new.id) x;
  update public.sales_orders set total=v,updated_at=now() where id=new.id and total is distinct from v;
 else
  update public.purchase_service_lines set tax_percent=new.tax_percent where order_id=new.id and tax_percent is distinct from new.tax_percent;
  update public.purchase_order_charges x set tax_percent=case when new.invoice_type='Tax Invoice' and cm.tax_applicable then new.tax_percent else 0 end
   from public.charge_master cm where x.order_id=new.id and cm.company_id=new.company_id and cm.charge_key=x.charge_key and cm.is_active
   and x.tax_percent is distinct from(case when new.invoice_type='Tax Invoice' and cm.tax_applicable then new.tax_percent else 0 end);
  select coalesce(sum(amount+round(amount*tax_percent/100,2)),0) into v from (
   select amount,tax_percent from public.purchase_service_lines where order_id=new.id union all select amount,tax_percent from public.purchase_order_charges where order_id=new.id) x;
  update public.purchase_orders set total=v,updated_at=now() where id=new.id and total is distinct from v;
 end if;
 return new;
end $$;
revoke all on function public.transport_sync_draft_billing() from public,anon,authenticated;
create trigger transport_sync_draft_billing after update of invoice_type,tax_percent,payment_mode,order_date on public.sales_orders for each row execute function public.transport_sync_draft_billing();
create trigger transport_sync_draft_billing after update of invoice_type,tax_percent,transport_billing_mode,order_date on public.purchase_orders for each row execute function public.transport_sync_draft_billing();

create function public.transport_refresh_draft_billing(p_side text,p_order_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_side='customer' then
  update public.sales_orders set tax_percent=tax_percent where id=p_order_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id() and status='draft' and document_kind='service' and public.transport_customer_billing_scope(company_id,business_unit_id);
 else
  update public.purchase_orders set tax_percent=tax_percent where id=p_order_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id() and status='draft' and document_kind='service' and public.transport_customer_billing_scope(company_id,business_unit_id);
 end if;
end $$;
revoke all on function public.transport_refresh_draft_billing(text,uuid) from public,anon,authenticated;

create function public.transport_set_party_billing_mode(p_side text,p_party_id uuid,p_mode text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();t record;v_count int:=0;v_drafts int:=0;
begin
 if auth.uid() is null or not public.transport_customer_billing_scope(c,b) then raise exception 'Active Transport workspace required';end if;
 if p_side not in ('customer','supplier') or p_side is null or p_mode not in ('Cash','Credit') or p_mode is null then raise exception 'Select party side and Cash/Credit';end if;
 perform public.assert_module_permission(case when p_side='customer' then 'sales' else 'purchase' end,'edit');
 if p_side='customer' then
  if not exists(select 1 from public.customers where id=p_party_id and company_id=c and is_active) then raise exception 'Active customer required';end if;
 else
  if not exists(select 1 from public.suppliers where id=p_party_id and company_id=c and is_active) then raise exception 'Active supplier required';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text||':'||b::text||':'||p_party_id::text||':billing_mode',0));
 if p_side='customer' then
  insert into public.transport_customer_billing_modes(company_id,business_unit_id,customer_id,billing_mode,updated_by) values(c,b,p_party_id,p_mode,auth.uid())
  on conflict(company_id,business_unit_id,customer_id) do update set billing_mode=excluded.billing_mode,updated_by=excluded.updated_by,updated_at=now();
  for t in select id from public.transport_trips where company_id=c and business_unit_id=b and customer_id=p_party_id and sale_type is distinct from lower(p_mode)
   and not public.transport_customer_side_posted(id) order by id for update loop
   insert into public.transport_action_gate values(txid_current(),t.id,'operational_correction');
   update public.transport_trips set sale_type=lower(p_mode) where id=t.id;
   delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='operational_correction';v_count:=v_count+1;
  end loop;
  update public.sales_orders set payment_mode=p_mode where company_id=c and business_unit_id=b and customer_id=p_party_id and status='draft' and document_kind='service' and transport_billing_origin_id is null;
  get diagnostics v_drafts=row_count;
 else
  insert into public.transport_supplier_billing_modes(company_id,business_unit_id,supplier_id,billing_mode,updated_by) values(c,b,p_party_id,p_mode,auth.uid())
  on conflict(company_id,business_unit_id,supplier_id) do update set billing_mode=excluded.billing_mode,updated_by=excluded.updated_by,updated_at=now();
  update public.purchase_orders set transport_billing_mode=p_mode where company_id=c and business_unit_id=b and supplier_id=p_party_id and status='draft' and document_kind='service' and public.transport_customer_billing_scope(company_id,business_unit_id);get diagnostics v_drafts=row_count;
 end if;
 return jsonb_build_object('party_id',p_party_id,'mode',p_mode,'status','saved','trips_updated',v_count,'drafts_updated',v_drafts);
end $$;
revoke all on function public.transport_set_party_billing_mode(text,uuid,text) from public,anon;
grant execute on function public.transport_set_party_billing_mode(text,uuid,text) to authenticated;
create or replace function public.transport_set_customer_billing_mode(p_customer_id uuid,p_mode text) returns jsonb
language sql security definer set search_path=public,pg_temp as $$select public.transport_set_party_billing_mode('customer',p_customer_id,p_mode)$$;
create or replace function public.transport_customer_side_posted(p_trip_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.transport_trips t where t.id=p_trip_id and (
 exists(select 1 from public.sales_orders s where s.id=t.sales_order_id and s.status='posted') or
 exists(select 1 from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders s on s.id=d.sales_order_id where l.trip_id=t.id and not l.is_adjustment and s.status='posted')))
$$;
-- Current masters govern new/draft billing; posted invoices and notes retain snapshots.
create or replace function public.transport_guard_sales_customer_billing_mode() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and old.status<>'draft' then return new;end if;
 if new.document_kind='service' and public.transport_customer_billing_scope(new.company_id,new.business_unit_id) and new.transport_billing_origin_id is null and not exists(select 1 from public.transport_billing_adjustment_gate where transaction_id=txid_current() and side='customer' and party_id=new.customer_id and company_id=new.company_id and business_unit_id=new.business_unit_id) then
  perform public.transport_assert_customer_billing_mode(new.company_id,new.business_unit_id,new.customer_id,new.payment_mode);
 end if;return new;
end $$;

-- Trip-linked invoice preview and import share master-derived VAT, including old templates.
create function public.transport_normalize_invoice_billing_rows(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare x jsonb;cid uuid;m text;v jsonb:='[]'::jsonb;c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();
begin
 if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Select 1 to 500 invoice rows';end if;
 for x in select value from jsonb_array_elements(p_rows) loop
  select id into cid from public.customers where company_id=c and is_active and lower(btrim(name))=lower(btrim(x->>'customer')) order by id limit 1;
  if cid is not null then m:=public.transport_party_billing_mode('customer',c,b,cid);x:=jsonb_set(x,'{vat}',to_jsonb(m='Credit'),true);end if;
  v:=v||jsonb_build_array(x);
 end loop;return v;
end $$;
revoke all on function public.transport_normalize_invoice_billing_rows(jsonb) from public,anon,authenticated;
-- Resolve automatic VAT before totals, journal entries and trip/rent snapshots are computed.
do $$
declare f record;d text;a text;v text;
begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('transport_create_charged_service_document_accounted','transport_create_charged_service_document','transport_create_numbered_service_document') loop
  d:=pg_get_functiondef(f.oid);
  a:='tax:=case when p_tax then public.fixed_tax_rate_on';
  if position(a in d)=0 then raise exception 'Billing creator anchor changed: %',f.proname;end if;
  d:=replace(d,a,'p_tax:=public.transport_party_billing_mode(p_side,c,b,p_party)=''Credit'';'||chr(10)||a);
  -- The legacy numbered creator had hard-coded Credit on customer documents.
  d:=replace(d,'tax,base,1,''service'',''Credit''','tax,base,1,''service'',public.transport_party_billing_mode(''customer'',c,b,p_party)');
  d:=replace(d,'tax:=case when p_tax then public.fixed_tax_rate_on(c,case when p_side=''customer'' then ''sales'' else ''purchase'' end,p_date) else 0 end;', 'tax:=public.transport_billing_rate(c,p_side,p_date,case when p_tax then ''Credit'' else ''Cash'' end);');
  execute d;
 end loop;
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('transport_post_customer_bill_grouped','transport_post_supplier_bill_grouped','transport_post_supplier_bill_grouped_described') loop
  d:=pg_get_functiondef(f.oid);
  a:=case when f.proname='transport_post_customer_bill_grouped' then 'v_tax:=case when p_with_tax then public.fixed_tax_rate_on(c,''sales'',p_date)' else 'v_tax:=case when p_with_tax then public.fixed_tax_rate_on(c,''purchase'',p_date)' end;
  if position(a in d)=0 then raise exception 'Grouped billing anchor changed: %',f.proname;end if;
  v:=case when f.proname='transport_post_customer_bill_grouped' then 'p_with_tax:=public.transport_party_billing_mode(''customer'',c,b,v_customer)=''Credit'';' else 'p_with_tax:=public.transport_party_billing_mode(''supplier'',c,b,v_supplier)=''Credit'';' end;
  d:=replace(d,'select max(x.id) from public.transport_customer_document_trips x where x.document_id=v_doc','select x.id from public.transport_customer_document_trips x where x.document_id=v_doc order by x.id desc limit 1');
  d:=replace(d,'select max(x.id) from public.transport_supplier_document_rents x where x.document_id=v_doc','select x.id from public.transport_supplier_document_rents x where x.document_id=v_doc order by x.id desc limit 1');
  d:=replace(d,'select sum(x.vat_snapshot) from public.transport_customer_document_trips x where x.document_id=v_doc','select sum(evidence.vat_snapshot) from public.transport_customer_document_trips evidence where evidence.document_id=v_doc');
  d:=replace(d,'select x.id from public.transport_customer_document_trips x where x.document_id=v_doc order by x.id desc limit 1','select evidence.id from public.transport_customer_document_trips evidence where evidence.document_id=v_doc order by evidence.id desc limit 1');
  d:=replace(d,'select sum(x.vat_snapshot) from public.transport_supplier_document_rents x where x.document_id=v_doc','select sum(evidence.vat_snapshot) from public.transport_supplier_document_rents evidence where evidence.document_id=v_doc');
  d:=replace(d,'select x.id from public.transport_supplier_document_rents x where x.document_id=v_doc order by x.id desc limit 1','select evidence.id from public.transport_supplier_document_rents evidence where evidence.document_id=v_doc order by evidence.id desc limit 1');
  execute replace(d,a,v||chr(10)||a);
 end loop;
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('post_service_sales_invoice_core','post_service_purchase_invoice_core') loop
  d:=pg_get_functiondef(f.oid);v:=case when f.proname='post_service_sales_invoice_core' then 'customer' else 'supplier' end;
  a:='perform public.assert_module_permission('''||case when v='customer' then 'sales' else 'purchase' end||''',''post'');';
  if position(a in d)=0 then raise exception 'Service posting anchor changed: %',f.proname;end if;
  execute replace(d,a,a||chr(10)||' perform public.transport_refresh_draft_billing('''||v||''',p_order_id);');
 end loop;
 select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='transport_import_customer_invoice_draft';
 a:='tax:=case when p_with_tax then public.fixed_tax_rate_on';
 if position(a in d)=0 then raise exception 'Trip draft import tax anchor changed';end if;
 execute replace(d,a,'p_with_tax:=public.transport_party_billing_mode(''customer'',c,b,p_customer_id)=''Credit'';'||chr(10)||a);
 select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='transport_trip_customer_mode_guard';
 a:=' if tg_op=''UPDATE''';
 if position(a in d)=0 then raise exception 'Trip mode update anchor changed';end if;
 d:=replace(d,a,' if tg_op=''UPDATE'' and public.transport_customer_side_posted(old.id) and (new.customer_id,new.sale_type) is distinct from (old.customer_id,old.sale_type) then raise exception ''Posted Trip billing mode is immutable'';end if;'||chr(10)||a);
 execute d;
 -- This shared immutability trigger must only read sales_order_id on external lines.
 select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='transport_financial_append_only';
 a:='if tg_table_name=''transport_external_invoice_lines'' and tg_op=''DELETE'''||chr(10)||'   and public.sales_draft_delete_gate_allows(old.sales_order_id,old.company_id,old.business_unit_id) then'||chr(10)||'   return old;'||chr(10)||' end if;';
 if position(a in d)=0 then raise exception 'External line draft-delete guard anchor changed';end if;
 v:='if tg_table_name=''transport_external_invoice_lines'' then if tg_op=''DELETE'' and public.sales_draft_delete_gate_allows(old.sales_order_id,old.company_id,old.business_unit_id) then return old;end if;end if;';
 execute replace(d,a,v);
 -- Apply the customer posting lock to posted evidence; a draft link is not posting.
 select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='transport_posted_rate_guard';
 a:='if exists(select 1 from public.transport_customer_document_trips where trip_id=old.id) or old.sales_order_id is not null then';
 if position(a in d)=0 then raise exception 'Trip posted mode guard anchor changed';end if;
 -- Draft-linked rate/payer identity stays locked; only the controlled master mode can change.
 v:='if exists(select 1 from public.transport_customer_document_trips where trip_id=old.id) or (old.sales_order_id is not null and not (tg_op=''UPDATE'' and not public.transport_customer_side_posted(old.id) and (new.customer_id,new.customer_rate,new.sales_order_id) is not distinct from (old.customer_id,old.customer_rate,old.sales_order_id) and exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=old.id and action=''operational_correction''))) then';
 execute replace(d,a,v);
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('transport_preview_customer_invoice_batch','transport_import_customer_invoice_batch') loop
  d:=pg_get_functiondef(f.oid);
  execute regexp_replace(d,'([Bb][Ee][Gg][Ii][Nn])',E'\\1'||chr(10)||'p_rows:=public.transport_normalize_invoice_billing_rows(p_rows);');
 end loop;
 -- Preserve Transport billing labels through the general invoice classification trigger.
 select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='standardize_invoice_classification';
 d:=regexp_replace(d,'new[.]payment_mode[[:space:]]*:=[[:space:]]*''Credit''[[:space:]]*;',
 'if new.document_kind is distinct from ''service'' or not public.transport_customer_billing_scope(new.company_id,new.business_unit_id) then new.payment_mode:=''Credit'';end if;','g');
 execute d;
 -- Origin-tagged external debit notes are validated by the early billing guard;
 -- their source VAT snapshot is retained even across an effective-rate transition.
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('standardize_invoice_classification','enforce_document_tax_rate','guard_document_tax_transition') loop
  d:=pg_get_functiondef(f.oid);
  a:='begin';
  v:='if tg_table_name=''sales_orders'' then if new.transport_billing_origin_id is not null and new.document_kind=''service'' and public.transport_customer_billing_scope(new.company_id,new.business_unit_id) then return new;end if;end if;';
  d:=regexp_replace(d,'([Bb][Ee][Gg][Ii][Nn])',E'\\1'||chr(10)||v);
  execute d;
 end loop;
 -- The date-aware invoice snapshot is the authority for Transport charge VAT.
 select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='enforce_sales_charge_settings';
 a:='select rate into v_tax from public.tax_rates where company_id=v_company_id and is_active and is_fixed and applies_to in(''sales'',''both'') order by created_at limit 1;';
 if position(a in d)>0 then
 execute replace(d,a,'if public.transport_customer_billing_scope(v_company_id,v_unit_id) then select tax_percent into v_tax from public.sales_orders where id=new.order_id;else '||a||'end if;');
 elsif position('v_snapshot' in d)=0 then raise exception 'Sales charge rate anchor changed';end if;
 select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='transport_adjust_rate';
 a:='r:=public.transport_create_service_document(p_side,party,p_date,diff,with_tax,cost,';
 if position(a in d)=0 then raise exception 'Rate adjustment creator anchor changed';end if;
 v:='if p_side=''customer'' then insert into public.transport_billing_adjustment_gate select txid_current(),p_side,party,t.company_id,t.business_unit_id,payment_mode,case when payment_mode=''Credit'' then public.fixed_tax_rate_on(t.company_id,''sales'',p_date) else 0 end from public.sales_orders where id=original_order;else insert into public.transport_billing_adjustment_gate select txid_current(),p_side,party,t.company_id,t.business_unit_id,case when tax_percent>0 then ''Credit'' else ''Cash'' end,case when tax_percent>0 then public.fixed_tax_rate_on(t.company_id,''purchase'',p_date) else 0 end from public.purchase_orders where id=original_order;end if;';
 d:=replace(d,a,v||chr(10)||a);
 a:='if p_side=''customer'' then'||chr(10)||' insert into public.transport_customer_documents';
 if position(a in d)=0 then raise exception 'Rate adjustment cleanup anchor changed';end if;
 execute replace(d,a,'delete from public.transport_billing_adjustment_gate where transaction_id=txid_current();'||chr(10)||' '||a);
 -- Controlled external debit notes preserve the originating invoice's mode and VAT.
 select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='transport_post_external_invoice_note';
 a:='number:=''DN-''||substr(replace(p_request_id::text,''-'',''''),1,16);';
 if position(a in d)=0 then raise exception 'External debit note anchor changed';end if;
 d:=replace(d,a,a||chr(10)||' insert into public.transport_billing_correction_gate values(txid_current(),o.id);');
 a:='created_by,transport_source_company,transport_source_invoice_id)';
 if position(a in d)=0 then raise exception 'Debit origin column anchor changed';end if;
 d:=replace(d,a,'created_by,transport_source_company,transport_source_invoice_id,transport_billing_origin_id)');
 a:='''debit:''||p_request_id::text) returning id into oid;';
 if position(a in d)=0 then raise exception 'Debit origin value anchor changed';end if;
 d:=replace(d,a,'''debit:''||p_request_id::text,o.id) returning id into oid;');
 a:='result:=public.post_sales_invoice(oid);';
 d:=replace(d,a,a||'delete from public.transport_billing_correction_gate where transaction_id=txid_current();');
 execute d;
end $$;
notify pgrst,'reload schema';
commit;
