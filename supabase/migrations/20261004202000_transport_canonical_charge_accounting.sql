begin;

-- Canonical Transport charges: one NAVILO Charge Master, separate customer recovery and supplier cost evidence.
alter table public.transport_trip_customer_charges
  add column if not exists charge_master_id uuid references public.charge_master(id) on delete restrict;
alter table public.transport_trip_customer_charges alter column charge_type_id drop not null;
alter table public.transport_customer_charge_rates
  add column if not exists charge_master_id uuid references public.charge_master(id) on delete restrict;
alter table public.transport_customer_charge_rates alter column charge_type_id drop not null;

create table if not exists public.transport_trip_supplier_charges(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete cascade,
 trip_id uuid not null references public.transport_trips(id) on delete restrict,
 rent_id uuid not null references public.transport_trip_supplier_rents(id) on delete restrict,
 charge_master_id uuid not null references public.charge_master(id) on delete restrict,
 charge_key_snapshot text not null,
 name_snapshot text not null,
 amount numeric(18,2) not null check(amount>=0),
 sort_order integer not null default 0,
 created_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(rent_id,charge_master_id)
);
create index if not exists transport_trip_supplier_charges_trip_idx on public.transport_trip_supplier_charges(company_id,business_unit_id,trip_id,rent_id);
alter table public.transport_trip_supplier_charges enable row level security;
drop policy if exists transport_trip_supplier_charges_select on public.transport_trip_supplier_charges;
create policy transport_trip_supplier_charges_select on public.transport_trip_supplier_charges for select to authenticated
using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
 and public.has_module_permission(company_id,'transport','view'));
revoke all on public.transport_trip_supplier_charges from public,anon;
grant select on public.transport_trip_supplier_charges to authenticated,service_role;
grant all on public.transport_trip_supplier_charges to service_role;

alter table public.transport_trip_supplier_rents
 add column if not exists base_amount numeric(18,2),
 add column if not exists finalized_base_amount_snapshot numeric(18,2);

-- Do not rewrite historical Transport financial evidence during migration.
-- Legacy rows intentionally keep these new snapshot columns null; runtime readers/posting
-- functions fall back to finalized_amount_snapshot/amount. New writes populate the columns.

create or replace function public.transport_replace_trip_customer_charges(p_trip_id uuid,p_lines jsonb,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$
declare t public.transport_trips%rowtype;line jsonb;cm public.charge_master%rowtype;
 base numeric(18,2);total_charges numeric(18,2):=0;final_rate numeric(18,2);seq int:=0;amount numeric(18,2);old_lines jsonb;new_lines jsonb;cmid uuid;
begin
 select * into t from public.transport_trips where id=p_trip_id for update;
 if not found or t.company_id is distinct from public.current_company_id() or t.business_unit_id is distinct from public.current_business_unit_id() then raise exception 'Transport Trip not found in active workspace'; end if;
 if not public.has_transport_action_permission(t.company_id,case when t.customer_rate_state='finalized' then 'customer_rate_override' else 'customer_rate_finalize' end) then raise exception 'Customer rate permission required'; end if;
 if public.transport_customer_side_posted(t.id) then raise exception 'Customer invoice is posted. Customer-side Trip data and charges are locked; use Credit/Debit Note.'; end if;
 if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))>50 then raise exception 'Charges must be an array of at most 50 lines'; end if;
 if t.customer_rate_state='finalized' and nullif(btrim(p_reason),'') is null then raise exception 'Reason required when changing a finalized unposted customer rate'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('charge_key',coalesce(cm.charge_key,x.code_snapshot),'name',x.name_snapshot,'amount',x.amount) order by x.sort_order,x.id),'[]'::jsonb)
 into old_lines from public.transport_trip_customer_charges x left join public.charge_master cm on cm.id=x.charge_master_id where x.trip_id=t.id;
 base:=coalesce(t.customer_base_rate,t.customer_rate,0);
 delete from public.transport_trip_customer_charges where trip_id=t.id;
 for line in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
  seq:=seq+1; amount:=coalesce(nullif(line->>'amount','')::numeric,0);
  if amount<0 then raise exception 'Charge amount cannot be negative';end if;
  cmid:=coalesce(nullif(line->>'charge_master_id','')::uuid,nullif(line->>'charge_type_id','')::uuid);
  select * into cm from public.charge_master where id=cmid and company_id=t.company_id and is_active and applies_to in ('sales','both');
  if not found then raise exception 'Selected Charge Master item is not active for Sales';end if;
  if cm.revenue_account_id is null then raise exception 'Charge % has no revenue account mapping',cm.charge_name;end if;
  insert into public.transport_trip_customer_charges(company_id,business_unit_id,trip_id,charge_type_id,charge_master_id,code_snapshot,name_snapshot,amount,sort_order,created_by)
  values(t.company_id,t.business_unit_id,t.id,null,cm.id,cm.charge_key,cm.charge_name,amount,seq,auth.uid());
  total_charges:=total_charges+amount;
 end loop;
 final_rate:=round((base+total_charges+coalesce(t.customer_manual_adjustment,0))::numeric,2);
 insert into public.transport_action_gate values(txid_current(),t.id,'customer_rate_finalize') on conflict do nothing;
 update public.transport_trips set customer_base_rate=base,customer_rate=final_rate,
 customer_rate_snapshot=case when customer_rate_state='finalized' then final_rate else customer_rate_snapshot end,
 customer_rate_source=case when customer_rate_state='finalized' then 'manual' else customer_rate_source end,
 updated_at=now(),updated_by=auth.uid() where id=t.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='customer_rate_finalize';
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'charge_master_id',x.charge_master_id,'charge_type_id',x.charge_master_id,'code',x.code_snapshot,'name',x.name_snapshot,'amount',x.amount) order by x.sort_order,x.id),'[]'::jsonb)
 into new_lines from public.transport_trip_customer_charges x where x.trip_id=t.id;
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,t.trip_no,'customer_charges_changed',
 jsonb_build_object('base_rate',coalesce(t.customer_base_rate,base),'charges',old_lines,'final_rate',t.customer_rate),
 jsonb_build_object('base_rate',base,'charges',new_lines,'final_rate',final_rate),p_reason,auth.uid());
 return jsonb_build_object('base_rate',base,'charges_total',total_charges,'manual_adjustment',coalesce(t.customer_manual_adjustment,0),'final_rate',final_rate,'lines',new_lines);
end$body$;

create or replace function public.transport_replace_trip_supplier_charges(p_rent_id uuid,p_lines jsonb,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$
declare r public.transport_trip_supplier_rents%rowtype;t public.transport_trips%rowtype;line jsonb;cm public.charge_master%rowtype;
 base numeric(18,2);charges numeric(18,2):=0;total numeric(18,2);seq int:=0;amt numeric(18,2);cmid uuid;old_lines jsonb;new_lines jsonb;
begin
 select * into r from public.transport_trip_supplier_rents where id=p_rent_id for update;
 if not found or r.company_id is distinct from public.current_company_id() or r.business_unit_id is distinct from public.current_business_unit_id() then raise exception 'Supplier rent not found in active workspace';end if;
 select * into t from public.transport_trips where id=r.trip_id for update;
 if exists(select 1 from public.transport_supplier_document_rents where rent_id=r.id and not is_adjustment) then raise exception 'Supplier bill is posted. Supplier charges are locked; use controlled AP correction.';end if;
 if not public.has_transport_action_permission(r.company_id,case when r.state='finalized' then 'rent_correct' else 'rent_finalize' end) then raise exception 'Rent permission required';end if;
 if r.state='finalized' and nullif(btrim(p_reason),'') is null then raise exception 'Reason required when changing finalized supplier charges';end if;
 if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))>50 then raise exception 'Charges must be an array of at most 50 lines';end if;
 base:=coalesce(r.base_amount,r.amount,0);
 select coalesce(jsonb_agg(jsonb_build_object('charge_key',x.charge_key_snapshot,'name',x.name_snapshot,'amount',x.amount) order by x.sort_order,x.id),'[]'::jsonb) into old_lines from public.transport_trip_supplier_charges x where x.rent_id=r.id;
 delete from public.transport_trip_supplier_charges where rent_id=r.id;
 for line in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
  seq:=seq+1;amt:=coalesce(nullif(line->>'amount','')::numeric,0);if amt<0 then raise exception 'Charge amount cannot be negative';end if;
  cmid:=coalesce(nullif(line->>'charge_master_id','')::uuid,nullif(line->>'charge_type_id','')::uuid);
  select * into cm from public.charge_master where id=cmid and company_id=r.company_id and is_active and applies_to in ('purchase','both');
  if not found then raise exception 'Selected Charge Master item is not active for Purchase';end if;
  if cm.cost_account_id is null then raise exception 'Charge % has no cost account mapping',cm.charge_name;end if;
  insert into public.transport_trip_supplier_charges(company_id,business_unit_id,trip_id,rent_id,charge_master_id,charge_key_snapshot,name_snapshot,amount,sort_order,created_by)
  values(r.company_id,r.business_unit_id,r.trip_id,r.id,cm.id,cm.charge_key,cm.charge_name,amt,seq,auth.uid());charges:=charges+amt;
 end loop;
 total:=round(base+charges,2);
 insert into public.transport_action_gate values(txid_current(),r.trip_id,'supplier_rent_finalize') on conflict do nothing;
 update public.transport_trip_supplier_rents set base_amount=base,amount=total,
 finalized_amount_snapshot=case when state='finalized' then total else finalized_amount_snapshot end,
 finalized_base_amount_snapshot=case when state='finalized' then base else finalized_base_amount_snapshot end
 where id=r.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=r.trip_id and action='supplier_rent_finalize';
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'charge_master_id',x.charge_master_id,'charge_type_id',x.charge_master_id,'code',x.charge_key_snapshot,'name',x.name_snapshot,'amount',x.amount) order by x.sort_order,x.id),'[]'::jsonb) into new_lines from public.transport_trip_supplier_charges x where x.rent_id=r.id;
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(r.company_id,r.business_unit_id,r.trip_id,t.trip_no,'supplier_charges_changed',
 jsonb_build_object('base_rent',base,'charges',old_lines,'total_rent',r.amount),
 jsonb_build_object('base_rent',base,'charges',new_lines,'total_rent',total),p_reason,auth.uid());
 return jsonb_build_object('base_rent',base,'charges_total',charges,'total_rent',total,'lines',new_lines);
end$body$;
revoke all on function public.transport_replace_trip_supplier_charges(uuid,jsonb,text) from public,anon;
grant execute on function public.transport_replace_trip_supplier_charges(uuid,jsonb,text) to authenticated,service_role;

-- Bulk/single rent amount is always the base route rent; supplier charges are added to produce total supplier rent.
create or replace function public.transport_finalize_supplier_rent(p_rent_id uuid,p_amount numeric,p_reason text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $body$
declare r public.transport_trip_supplier_rents%rowtype;t public.transport_trips%rowtype;v_action text;v_charges numeric(18,2);v_total numeric(18,2);
begin
 select * into r from public.transport_trip_supplier_rents where id=p_rent_id for update;if not found then raise exception 'Supplier rent not found';end if;
 select * into t from public.transport_trips where id=r.trip_id for update;
 if r.company_id is distinct from public.current_company_id() or r.business_unit_id is distinct from public.current_business_unit_id() then raise exception 'Supplier rent outside active workspace';end if;
 v_action:=case when r.state='finalized' then 'rent_correct' else 'rent_finalize' end;
 if not public.has_transport_action_permission(r.company_id,v_action) then raise exception 'Rent permission required';end if;
 if v_action='rent_correct' and nullif(btrim(p_reason),'') is null then raise exception 'Correction reason required';end if;
 if p_amount is null or p_amount<0 then raise exception 'Invalid base rent amount';end if;
 if exists(select 1 from public.transport_supplier_document_rents where rent_id=r.id and not is_adjustment) then raise exception 'Posted supplier rent is immutable; use controlled correction';end if;
 select coalesce(sum(amount),0) into v_charges from public.transport_trip_supplier_charges where rent_id=r.id;v_total:=round(p_amount+v_charges,2);
 if r.state='finalized' and r.base_amount=p_amount and r.amount=v_total and r.finalized_amount_snapshot=v_total then return;end if;
 insert into public.transport_action_gate values(txid_current(),r.trip_id,'supplier_rent_finalize') on conflict do nothing;
 update public.transport_trip_supplier_rents set base_amount=p_amount,amount=v_total,state='finalized',finalized_base_amount_snapshot=p_amount,finalized_amount_snapshot=v_total,finalized_by=auth.uid(),finalized_at=now() where id=r.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=r.trip_id and action='supplier_rent_finalize';
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(r.company_id,r.business_unit_id,r.trip_id,t.trip_no,v_action,
 jsonb_build_object('supplier_id',r.supplier_id,'base_rent',coalesce(r.base_amount,r.amount),'charges',v_charges,'total_rent',r.amount),
 jsonb_build_object('supplier_id',r.supplier_id,'base_rent',p_amount,'charges',v_charges,'total_rent',v_total),p_reason,auth.uid());
end$body$;

create or replace function public.transport_create_charged_service_document(
 p_side text,p_party uuid,p_date date,p_base_amount numeric,p_tax boolean,p_cost_account uuid,p_description text,p_reference text,p_invoice_no text,p_trip_id uuid,p_rent_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();u uuid:=public.legacy_data_user_id();
 base text;tax numeric;oid uuid;j jsonb;number text;charge_total numeric:=0;charge_vat numeric:=0;x record;
begin
 if p_side not in ('customer','supplier') or p_date is null or coalesce(p_base_amount,0)<0 then raise exception 'Valid service document required';end if;
 perform public.assert_module_permission(case when p_side='customer' then 'sales' else 'purchase' end,'create');
 number:=public.transport_choose_invoice_number(p_side,p_invoice_no);
 select base_currency_code into base from public.companies where id=c;
 tax:=case when p_tax then public.fixed_tax_rate_on(c,case when p_side='customer' then 'sales' else 'purchase' end,p_date) else 0 end;
 if tax is null then raise exception 'Effective fixed VAT rate required';end if;
 if p_side='customer' then
  insert into public.sales_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,payment_mode)
  values(u,c,b,loc,number,p_party,p_date,'draft',case when p_tax then 'Tax Invoice' else 'Sale Invoice' end,tax,base,1,'service','Credit') returning id into oid;
  if p_base_amount>0 then insert into public.sales_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,source_module,source_id,created_by)
   values(c,b,oid,p_description,round(p_base_amount,2),tax,'transport',p_trip_id,auth.uid());end if;
  for x in select tc.amount,cm.* from public.transport_trip_customer_charges tc join public.charge_master cm on cm.id=tc.charge_master_id
   where tc.trip_id=p_trip_id and cm.company_id=c and cm.is_active and cm.applies_to in ('sales','both') order by tc.sort_order,tc.id loop
   if x.revenue_account_id is null then raise exception 'Charge % has no revenue account mapping',x.charge_name;end if;
   insert into public.sales_order_charges(order_id,charge_key,charge_label,amount,tax_percent,account_id,charge_type,cost_amount,cost_account_id,company_id,business_unit_id,quantity,rate)
   values(oid,x.charge_key,x.charge_name,x.amount,case when p_tax and x.tax_applicable then tax else 0 end,x.revenue_account_id,coalesce(x.charge_type,'recovery'),0,x.cost_account_id,c,b,1,x.amount);
   charge_total:=charge_total+x.amount;charge_vat:=charge_vat+case when p_tax and x.tax_applicable then round(x.amount*tax/100,2) else 0 end;
  end loop;
  j:=public.post_sales_invoice(oid);
 else
  insert into public.purchase_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,supplier_id,order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,supplier_invoice_no,supplier_invoice_date)
  values(u,c,b,loc,number,p_party,p_date,'draft',case when p_tax then 'Tax Invoice' else 'Purchase Invoice' end,tax,base,1,'service',coalesce(nullif(btrim(p_reference),''),'TR-'||substr(gen_random_uuid()::text,1,12)),p_date) returning id into oid;
  if p_base_amount>0 then insert into public.purchase_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,cost_account_id,source_module,source_id,created_by)
   values(c,b,oid,p_description,round(p_base_amount,2),tax,p_cost_account,'transport',p_trip_id,auth.uid());end if;
  for x in select sc.amount,cm.* from public.transport_trip_supplier_charges sc join public.charge_master cm on cm.id=sc.charge_master_id
   where sc.trip_id=p_trip_id and sc.rent_id=p_rent_id and cm.company_id=c and cm.is_active and cm.applies_to in ('purchase','both') order by sc.sort_order,sc.id loop
   if x.cost_account_id is null then raise exception 'Charge % has no cost account mapping',x.charge_name;end if;
   insert into public.purchase_order_charges(user_id,company_id,business_unit_id,order_id,charge_key,charge_label,amount,tax_percent,treatment,cost_account_id,quantity,rate)
   values(u,c,b,oid,x.charge_key,x.charge_name,x.amount,case when p_tax and x.tax_applicable then tax else 0 end,coalesce(x.purchase_treatment,'expense'),x.cost_account_id,1,x.amount);
   charge_total:=charge_total+x.amount;charge_vat:=charge_vat+case when p_tax and x.tax_applicable then round(x.amount*tax/100,2) else 0 end;
  end loop;
  j:=public.post_purchase_invoice(oid);
 end if;
 return j||jsonb_build_object('document_id',oid,'invoice_no',number,'base_net',round(p_base_amount,2),'charges_net',round(charge_total,2),'net',round(p_base_amount+charge_total,2),'vat',round(p_base_amount*tax/100,2)+charge_vat,'tax_percent',tax);
end$body$;
revoke all on function public.transport_create_charged_service_document(text,uuid,date,numeric,boolean,uuid,text,text,text,uuid,uuid) from public,anon;
grant execute on function public.transport_create_charged_service_document(text,uuid,date,numeric,boolean,uuid,text,text,text,uuid,uuid) to authenticated,service_role;

create or replace function public.transport_post_customer_bill_described(p_trip_id uuid,p_date date,p_with_tax boolean default false,p_invoice_no text default null,p_description text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$
declare t public.transport_trips%rowtype;r jsonb;d uuid;base numeric;
begin
 if length(coalesce(p_description,''))>2000 then raise exception 'Invoice description must be at most 2000 characters';end if;
 perform public.transport_finance_assert('billing');t:=public.transport_financial_trip(p_trip_id);
 if t.customer_rate_state is distinct from 'finalized' or t.customer_rate_snapshot is null or t.customer_rate_snapshot is distinct from t.customer_rate then raise exception 'Consistent finalized customer rate snapshot required';end if;
 if t.sales_order_id is not null then raise exception 'Trip already references a canonical Sales document; reconcile its existing posted linkage before billing';end if;
 if t.sale_type is null or t.customer_id is null or t.customer_rate<=0 or exists(select 1 from public.transport_customer_document_trips where trip_id=t.id and not is_adjustment) then raise exception 'Unbilled Trip, Cash/Credit classification, customer and positive finalized rate required';end if;
 base:=coalesce(t.customer_base_rate,t.customer_rate)+coalesce(t.customer_manual_adjustment,0);
 r:=public.transport_create_charged_service_document('customer',t.customer_id,p_date,base,p_with_tax,null,
 concat_ws(E'\n',nullif(btrim(p_description),''),public.transport_trip_service_description(t.id)),null,p_invoice_no,t.id,null);
 if round(coalesce((r->>'net')::numeric,0),2) is distinct from round(t.customer_rate_snapshot,2) then raise exception 'Customer base + charges does not reconcile to finalized Trip rate';end if;
 insert into public.transport_customer_documents(company_id,business_unit_id,operating_location_id,customer_id,document_kind,sales_order_id,journal_entry_id,created_by)
 values(t.company_id,t.business_unit_id,public.current_operating_location_id(),t.customer_id,case when t.sale_type='cash' then 'cash_hand_bill' else 'credit' end,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_customer_document_trips(company_id,business_unit_id,document_id,trip_id,rate_snapshot,vat_snapshot)
 values(t.company_id,t.business_unit_id,d,t.id,t.customer_rate_snapshot,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'customer_bill_posted',r||jsonb_build_object('transport_document_id',d,'sale_type',t.sale_type));
 return r||jsonb_build_object('transport_document_id',d);
end$body$;

create or replace function public.transport_post_supplier_bill_described(p_rent_id uuid,p_date date,p_cost_account_id uuid,p_with_tax boolean default false,p_reference text default null,p_invoice_no text default null,p_description text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$
declare x public.transport_trip_supplier_rents%rowtype;t public.transport_trips%rowtype;r jsonb;d uuid;base numeric;
begin
 if length(coalesce(p_description,''))>2000 then raise exception 'Invoice description must be at most 2000 characters';end if;
 perform public.transport_finance_assert('rent');
 select * into x from public.transport_trip_supplier_rents where id=p_rent_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Finalized supplier rent required';end if;t:=public.transport_financial_trip(x.trip_id);
 if x.state is distinct from 'finalized' or x.finalized_amount_snapshot is null or x.finalized_amount_snapshot is distinct from x.amount then raise exception 'Consistent finalized supplier rent snapshot required';end if;
 if exists(select 1 from public.transport_supplier_document_rents where rent_id=x.id and not is_adjustment) then raise exception 'Supplier rent already billed';end if;
 base:=coalesce(x.finalized_base_amount_snapshot,x.base_amount,x.finalized_amount_snapshot);
 r:=public.transport_create_charged_service_document('supplier',x.supplier_id,p_date,base,p_with_tax,p_cost_account_id,
 concat_ws(E'\n',nullif(btrim(p_description),''),public.transport_trip_service_description(t.id)||' · Supplier rent'),p_reference,p_invoice_no,t.id,x.id);
 if round((r->>'net')::numeric,2) is distinct from round(x.finalized_amount_snapshot,2) then raise exception 'Supplier base rent + charges does not reconcile to finalized total rent';end if;
 insert into public.transport_supplier_documents(company_id,business_unit_id,operating_location_id,supplier_id,purchase_order_id,journal_entry_id,created_by)
 values(x.company_id,x.business_unit_id,public.current_operating_location_id(),x.supplier_id,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_supplier_document_rents(company_id,business_unit_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot)
 values(x.company_id,x.business_unit_id,d,x.id,t.id,x.finalized_amount_snapshot,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'supplier_bill_posted',r||jsonb_build_object('rent_id',x.id,'transport_document_id',d));return r;
end$body$;


create or replace function public.transport_post_customer_bill(p_trip_id uuid,p_date date,p_with_tax boolean default false)
returns jsonb language sql security definer set search_path=public,pg_temp as $body$
 select public.transport_post_customer_bill_described(p_trip_id,p_date,p_with_tax,null,null)
$body$;
create or replace function public.transport_post_customer_bill_numbered(p_trip_id uuid,p_date date,p_with_tax boolean default false,p_invoice_no text default null)
returns jsonb language sql security definer set search_path=public,pg_temp as $body$
 select public.transport_post_customer_bill_described(p_trip_id,p_date,p_with_tax,p_invoice_no,null)
$body$;
create or replace function public.transport_post_supplier_bill(p_rent_id uuid,p_date date,p_cost_account_id uuid,p_with_tax boolean default false,p_reference text default null)
returns jsonb language sql security definer set search_path=public,pg_temp as $body$
 select public.transport_post_supplier_bill_described(p_rent_id,p_date,p_cost_account_id,p_with_tax,p_reference,null,null)
$body$;
create or replace function public.transport_post_supplier_bill_numbered(p_rent_id uuid,p_date date,p_cost_account_id uuid,p_with_tax boolean default false,p_reference text default null,p_invoice_no text default null)
returns jsonb language sql security definer set search_path=public,pg_temp as $body$
 select public.transport_post_supplier_bill_described(p_rent_id,p_date,p_cost_account_id,p_with_tax,p_reference,p_invoice_no,null)
$body$;

commit;