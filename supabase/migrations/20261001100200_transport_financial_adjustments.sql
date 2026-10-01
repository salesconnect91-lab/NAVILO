begin;
create table public.transport_service_note_lines(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,
 note_id uuid not null unique references public.return_notes(id) on delete restrict,
 side text not null check(side in ('customer','supplier')),order_id uuid not null,
 net_amount numeric(18,2) not null check(net_amount>0),vat_amount numeric(18,2) not null check(vat_amount>=0),
 created_by uuid not null,created_at timestamptz not null default now());
create table public.transport_rate_adjustments(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,
 trip_id uuid not null references public.transport_trips(id) on delete restrict,
 rent_id uuid references public.transport_trip_supplier_rents(id) on delete restrict,
 side text not null check(side in ('customer','supplier')),old_value numeric(18,2) not null,
 new_value numeric(18,2) not null check(new_value>=0),difference numeric(18,2) generated always as(new_value-old_value) stored,
 reason text not null check(btrim(reason)<>''),reference text,accounting_evidence jsonb not null,
 created_by uuid not null,created_at timestamptz not null default now(),
 check((side='supplier')=(rent_id is not null)),check(old_value<>new_value));
create table public.transport_service_refunds(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,
 side text not null check(side in ('customer','supplier')),order_id uuid not null,
 journal_entry_id uuid not null unique references public.journal_entries(id) on delete restrict,
 amount numeric(18,2) not null check(amount>0),reason text not null check(btrim(reason)<>''),created_by uuid not null,created_at timestamptz not null default now());
do $$ declare t text;begin
 foreach t in array array['transport_service_note_lines','transport_rate_adjustments','transport_service_refunds'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy %I on public.%I for select to authenticated using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''transport'',''view''))',t||'_read',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create trigger evidence_immutable before update or delete on public.%I for each row execute function public.transport_financial_append_only()',t);
 end loop;
end $$;

-- Canonical notes for service-only corrections. No inventory item, stock,
-- return quantity or COGS is invented. Uses original journal account IDs.
create function public.transport_post_service_note(p_side text,p_order_id uuid,p_net numeric,p_date date,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare o record;l record;v_note uuid:=gen_random_uuid();v_j uuid:=gen_random_uuid();v_no text;
 v_source_j uuid;v_net numeric;v_vat numeric;v_total numeric;v_party_name text;c uuid:=public.current_company_id();
 b uuid:=public.current_business_unit_id();u uuid:=public.legacy_data_user_id();loc uuid:=public.current_operating_location_id();
 v_used numeric;v_source_net numeric;v_tax numeric;v_account uuid;
begin
 if p_side='customer' then
 perform public.assert_module_permission('sales','post');
 select id,company_id,business_unit_id,operating_location_id,customer_id party_id,document_kind,status,total,tax_percent
 into o from public.sales_orders where id=p_order_id for update;
 select name into v_party_name from public.customers where id=o.party_id and company_id=c;
 select journal_entry_id into v_source_j from public.transport_customer_documents where sales_order_id=p_order_id;
 select sum(amount) into v_source_net from public.sales_service_lines where order_id=p_order_id;
 else
 perform public.assert_module_permission('purchase','post');
 select id,company_id,business_unit_id,operating_location_id,supplier_id party_id,document_kind,status,total,tax_percent
 into o from public.purchase_orders where id=p_order_id for update;
 select name into v_party_name from public.suppliers where id=o.party_id and company_id=c;
 select journal_entry_id into v_source_j from public.transport_supplier_documents where purchase_order_id=p_order_id;
 select sum(amount) into v_source_net from public.purchase_service_lines where order_id=p_order_id;
 end if;
 if o.company_id is distinct from c or o.business_unit_id is distinct from b or o.operating_location_id is distinct from loc
 or o.document_kind<>'service' or o.status<>'posted' or v_source_j is null
 or exists(select 1 from public.journal_entries where reversal_of_entry_id=v_source_j and status='posted')
 then raise exception 'Posted unreversed attributed service document in active branch required'; end if;
 select coalesce(sum(n.net_amount),0) into v_used from public.transport_service_note_lines n join public.return_notes rn on rn.id=n.note_id
 join public.journal_entries j on j.id=rn.journal_entry_id and j.status='posted'
 where n.side=p_side and n.order_id=p_order_id and not exists(select 1 from public.journal_entries where reversal_of_entry_id=j.id and status='posted');
 if round(coalesce(p_net,0),2)<=0 or round(p_net,2)>v_source_net-v_used then raise exception 'Service credit exceeds uncredited source value'; end if;
 v_net:=round(p_net,2);v_vat:=round(v_net*o.tax_percent/100,2);v_total:=v_net+v_vat;
 v_no:='TR-'||case when p_side='customer' then 'CN-' else 'DN-' end||substr(replace(v_note::text,'-',''),1,12);
 insert into public.return_notes(id,user_id,company_id,business_unit_id,operating_location_id,note_no,note_type,
 sales_order_id,purchase_order_id,party_type,party_id,party_name,note_date,reason,status,subtotal,tax_total,total,cost_total)
 values(v_note,u,c,b,loc,v_no,case when p_side='customer' then 'sales_credit' else 'purchase_debit' end,
 case when p_side='customer' then p_order_id end,case when p_side='supplier' then p_order_id end,p_side,o.party_id,v_party_name,p_date,btrim(p_reason),'draft',v_net,v_vat,v_total,0);
 insert into public.journal_entries(id,user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,party_name,trans_type,source_module,source_document_type,source_document_id)
 values(v_j,u,c,b,loc,v_no,p_date,'Transport service rate correction: '||p_reason,'draft',v_party_name,
 case when p_side='customer' then 'Service Sales Credit Note' else 'Service Purchase Debit Note' end,
 case when p_side='customer' then 'sales' else 'purchase' end,'service_rate_credit',v_note);
 -- Reverse AR/AP and the exact mapped revenue/expense and tax source accounts.
 -- Source document has one service line and no stock or discount lines.
 for l in select * from public.journal_lines where entry_id=v_source_j order by id loop
 if l.party_type=p_side and l.party_id=o.party_id then
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name,amount_basis)
 values(u,c,b,loc,v_j,l.account_id,l.account,case when p_side='supplier' then v_total else 0 end,
 case when p_side='customer' then v_total else 0 end,p_side,o.party_id,v_party_name,'base_currency');
 elsif (p_side='customer' and l.credit>0) or (p_side='supplier' and l.debit>0) then
 -- Separate VAT by the source VAT account, never by account name.
 v_account:=case when p_side='customer' then public.fx_mapping_account(u,c,'output_vat','liability') else public.fx_mapping_account(u,c,'input_vat','asset') end;
 v_tax:=case when l.account_id=v_account then v_vat else v_net end;
 if v_tax>0 then
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,amount_basis)
 values(u,c,b,loc,v_j,l.account_id,l.account,case when p_side='customer' then v_tax else 0 end,
 case when p_side='supplier' then v_tax else 0 end,'base_currency');end if;
 end if;
 end loop;
 perform public.post_journal_entry(v_j);
 update public.return_notes set status='posted',journal_entry_id=v_j where id=v_note;
 insert into public.transport_service_note_lines(company_id,business_unit_id,note_id,side,order_id,net_amount,vat_amount,created_by)
 values(c,b,v_note,p_side,p_order_id,v_net,v_vat,auth.uid());
 return jsonb_build_object('note_id',v_note,'journal_entry_id',v_j,'source_document_id',p_order_id,'net',v_net,'vat',v_vat,'total',v_total);
end $$;
revoke all on function public.transport_post_service_note(text,uuid,numeric,date,text) from public,anon,authenticated;

create function public.transport_adjust_rate(p_trip_id uuid,p_side text,p_new_rate numeric,p_reason text,p_date date default current_date,p_rent_id uuid default null,p_reference text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;x public.transport_trip_supplier_rents%rowtype;old_rate numeric;diff numeric;
 evidence jsonb:='[]';r jsonb;d uuid;source record;remaining numeric;available numeric;cost uuid;party uuid;original_order uuid;
 with_tax boolean;aid uuid;
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
 -- Never move a historical rate delta to a different COA mapping.
 if p_side='customer' and exists(select 1 from public.journal_lines l join public.transport_customer_documents d on d.journal_entry_id=l.entry_id join public.sales_orders o on o.id=d.sales_order_id
 where o.id=original_order and ((l.party_type='customer' and l.account_id is distinct from public.fx_mapping_account(o.user_id,o.company_id,'accounts_receivable','asset'))
 or (l.credit>0 and l.account_id in(select id from public.chart_of_accounts where type='revenue') and l.account_id is distinct from public.fx_mapping_account(o.user_id,o.company_id,'service_revenue','revenue'))))
 then raise exception 'Original accounting mappings changed; restore approved canonical mapping before rate correction';end if;
 if p_side='supplier' and exists(select 1 from public.journal_lines l join public.transport_supplier_documents d on d.journal_entry_id=l.entry_id join public.purchase_orders o on o.id=d.purchase_order_id
 where o.id=original_order and l.party_type='supplier' and l.account_id is distinct from public.fx_mapping_account(o.user_id,o.company_id,'accounts_payable','liability'))
 then raise exception 'Original AP mapping changed; canonical accounting review required';end if;
 if p_side='customer' then select tax_percent>0 into with_tax from public.sales_orders where id=original_order;
 else select tax_percent>0 into with_tax from public.purchase_orders where id=original_order;
 select cost_account_id into cost from public.purchase_service_lines where order_id=original_order order by id limit 1;end if;
 r:=public.transport_create_service_document(p_side,party,p_date,diff,with_tax,cost,'Rate adjustment '||t.trip_no||': '||p_reason,p_reference);
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
end $$;
revoke all on function public.transport_adjust_rate(uuid,text,numeric,text,date,uuid,text) from public,anon;
grant execute on function public.transport_adjust_rate(uuid,text,numeric,text,date,uuid,text) to authenticated;
commit;
