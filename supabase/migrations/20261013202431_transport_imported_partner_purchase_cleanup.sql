-- Only erroneous native Purchase conversions of explicitly selected partners.
-- No Trips, Sales, source evidence, original cutover journals or real payments are deleted.
begin;
create table public.transport_partner_purchase_exclusions(
 company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 supplier_id uuid not null references public.suppliers(id),reason text not null,created_by uuid not null,created_at timestamptz not null default now(),
 primary key(company_id,business_unit_id,operating_location_id,supplier_id));
create table public.transport_partner_purchase_cleanup_audit(
 id bigint generated always as identity primary key,transaction_id bigint not null,actor_id uuid not null,
 company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 document_id uuid not null,table_name text not null,row_id uuid not null,before_row jsonb not null,
 reason text not null,created_at timestamptz not null default now(),unique(document_id,table_name,row_id));
create table public.transport_partner_purchase_delete_gates(
 transaction_id bigint not null,actor_id uuid not null,company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 table_name text not null,row_id uuid not null,before_row jsonb not null,
 primary key(transaction_id,actor_id,table_name,row_id));
alter table public.transport_partner_purchase_exclusions enable row level security;
alter table public.transport_partner_purchase_cleanup_audit enable row level security;
alter table public.transport_partner_purchase_delete_gates enable row level security;
revoke all on public.transport_partner_purchase_exclusions,public.transport_partner_purchase_cleanup_audit,public.transport_partner_purchase_delete_gates from public,anon,authenticated;
grant select on public.transport_partner_purchase_exclusions to authenticated;
create policy partner_exclusions_read on public.transport_partner_purchase_exclusions for select to authenticated using(
 company_id=(select public.current_company_id()) and business_unit_id=(select public.current_business_unit_id()) and operating_location_id=(select public.current_operating_location_id()) and (select public.has_module_permission(public.current_company_id(),'transport','view')));

create function public.transport_partner_purchase_delete_allowed(p_table text,p_row jsonb) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and exists(select 1 from public.transport_partner_purchase_delete_gates g
 where g.transaction_id=txid_current() and g.actor_id=auth.uid() and g.company_id=public.current_company_id()
 and g.business_unit_id=public.current_business_unit_id() and g.operating_location_id=public.current_operating_location_id()
 and g.table_name=p_table and g.row_id=(p_row->>'id')::uuid and g.before_row=p_row)
$$;
revoke all on function public.transport_partner_purchase_delete_allowed(text,jsonb) from public,anon,authenticated;

-- The normal immutability rules remain intact; a private before-image gate only
-- permits DELETE of rows selected and locked by the cleanup below.
do $patch$ declare n text;f text;begin
 foreach n in array array['guard_journal_entry_changes','guard_posted_journal_immutability','guard_journal_line_changes','guard_journal_line_delete','prevent_posted_purchase_order_changes','guard_service_document_line','transport_financial_append_only','transport_archive_reversed_allocation','recalculate_purchase_order_payment_status','recalculate_party_ledger_balance'] loop
 f:=pg_get_functiondef(('public.'||n||'()')::regprocedure);
 f:=regexp_replace(f,'\m[Bb][Ee][Gg][Ii][Nn]\M',E'begin\n if tg_op=''DELETE'' and public.transport_partner_purchase_delete_allowed(tg_table_name,to_jsonb(old)) then return old;end if;');
 execute f;
 end loop;
end $patch$;

alter table public.transport_register_invoice_conversions drop constraint transport_register_invoice_conversions_status_check;
alter table public.transport_register_invoice_conversions add constraint transport_register_invoice_conversions_status_check check(status in('prepared','posted','blocked','zero_value','partner_excluded'));

create function public.transport_exclude_partner_purchases(p_suppliers uuid[],p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();n integer;
begin
 perform public.assert_admin_posted_record_control(c);perform public.assert_module_permission('accounting','post');
 if c is null or b is null or loc is null or nullif(btrim(p_reason),'') is null then raise exception 'Active company, unit, location and reason required';end if;
 if p_suppliers is null or cardinality(p_suppliers)<>3 or (select count(distinct x) from unnest(p_suppliers) x)<>3 then raise exception 'Select exactly the three partner supplier identities';end if;
 if (select count(distinct upper(btrim(s.name))) from public.suppliers s where s.id=any(p_suppliers) and s.company_id=c and upper(btrim(s.name)) in('GONDAL','USMAN','SAJID'))<>3 then raise exception 'Exact Gondal, Usman and Sajid identities in active company required';end if;
 insert into public.transport_partner_purchase_exclusions(company_id,business_unit_id,operating_location_id,supplier_id,reason,created_by)
 select c,b,loc,x,btrim(p_reason),auth.uid() from unnest(p_suppliers) x on conflict do nothing;
 update public.transport_register_invoice_conversions v set status='partner_excluded',error='Partner purchase excluded by owner instruction'
 from public.transport_opening_invoice_documents d where d.id=v.document_id and v.company_id=c and v.business_unit_id=b and v.operating_location_id=loc and v.side='supplier' and d.party_id=any(p_suppliers) and v.status in('prepared','zero_value','blocked') and not exists(select 1 from public.purchase_orders po where po.id=v.order_id);
 get diagnostics n=row_count;
 return jsonb_build_object('excluded_unposted',n,'posted_to_delete',(select count(*) from public.transport_register_invoice_conversions v join public.transport_opening_invoice_documents d on d.id=v.document_id where v.company_id=c and v.business_unit_id=b and v.operating_location_id=loc and v.side='supplier' and d.party_id=any(p_suppliers) and v.status='posted'));
end $$;
revoke all on function public.transport_exclude_partner_purchases(uuid[],text) from public,anon;
grant execute on function public.transport_exclude_partner_purchases(uuid[],text) to authenticated;

create function public.transport_delete_imported_partner_purchase_batch(p_limit integer,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();v record;po public.purchase_orders%rowtype;jids uuid[];tbl text;predicate text;done integer:=0;expected integer;td uuid[];
begin
 perform public.assert_admin_posted_record_control(c);perform public.assert_module_permission('accounting','post');
 if c is null or b is null or loc is null or p_limit is null or p_limit not between 1 and 100 or nullif(btrim(p_reason),'') is null then raise exception 'Active scope, limit 1..100 and reason required';end if;
 for v in select cv.*,d.party_id from public.transport_register_invoice_conversions cv
 join public.transport_opening_invoice_documents d on d.id=cv.document_id
 join public.transport_partner_purchase_exclusions e on e.company_id=cv.company_id and e.business_unit_id=cv.business_unit_id and e.operating_location_id=cv.operating_location_id and e.supplier_id=d.party_id
 where cv.company_id=c and cv.business_unit_id=b and cv.operating_location_id=loc and cv.side='supplier' and cv.status in('posted','blocked') order by cv.document_id limit p_limit for update of cv skip locked loop
 select * into strict po from public.purchase_orders where id=v.order_id and company_id=c and business_unit_id=b and operating_location_id=loc for update;
 if po.transport_register_conversion_id is distinct from v.document_id or po.supplier_id is distinct from v.party_id or po.document_kind<>'service' or po.total<>v.gross then raise exception 'Only unchanged imported partner Purchase may be deleted';end if;
 if exists(select 1 from public.purchase_service_lines l where l.order_id=po.id and (l.source_module<>'historical_register' or not exists(select 1 from public.transport_register_invoice_conversion_lines x where x.document_id=v.document_id and x.trip_id=l.source_id and x.net=l.amount and x.vat=l.historical_vat_amount))) then raise exception 'Purchase lines no longer match imported source';end if;
 if exists(select 1 from public.return_notes where purchase_order_id=po.id) or exists(select 1 from public.stock_movements where source_id=po.id) or exists(select 1 from public.transport_service_cost_links where purchase_order_id=po.id) or exists(select 1 from public.purchase_order_lines where order_id=po.id) or exists(select 1 from public.purchase_order_charges where order_id=po.id) then raise exception 'Subsequent or inventory activity prevents deletion';end if;
 if exists(select 1 from public.purchase_payment_allocations a where a.purchase_order_id=po.id and (a.journal_entry_id is distinct from v.clearing_journal_id or a.supplier_id is distinct from v.party_id or a.company_id<>c or a.business_unit_id<>b or a.operating_location_id<>loc)) then raise exception 'Real or unrelated payment evidence prevents deletion';end if;
 if (select coalesce(sum(amount),0) from public.purchase_payment_allocations where purchase_order_id=po.id)<>v.historical_settled then raise exception 'Settled source allocation mismatch';end if;
 jids:=array_remove(array[v.invoice_journal_id,v.clearing_journal_id,v.reclass_journal_id],null);expected:=cardinality(jids);
 perform 1 from public.journal_entries where id=any(jids) for update;
 if expected=0 or (select count(*) from public.journal_entries j where j.id=any(jids) and j.company_id=c and j.business_unit_id=b and j.operating_location_id=loc and j.status='posted' and j.reversal_of_entry_id is null and ((j.id=v.invoice_journal_id and j.source_document_type='purchase_invoice' and j.source_document_id=po.id) or (j.id=v.clearing_journal_id and j.source_document_type='transport_historical_clearing' and j.source_document_id=po.id) or (j.id=v.reclass_journal_id and j.source_document_type='transport_opening_invoice_reclassification' and j.source_document_id=v.document_id)))<>expected then raise exception 'Exact original conversion journals required';end if;
 if exists(select 1 from public.journal_entries where reversal_of_entry_id=any(jids)) or exists(select 1 from public.journal_lines l join public.account_mappings a on a.account_id=l.account_id and a.company_id=c where l.entry_id=any(jids) and a.mapping_key in('cash','bank')) then raise exception 'Reversal or cash/bank evidence prevents deletion';end if;
 if exists(select 1 from public.journal_entries j where j.source_document_id=po.id and not(j.id=any(jids))) then raise exception 'Additional invoice activity prevents deletion';end if;
 if exists(select 1 from public.journal_lines where entry_id=any(jids) and party_type='customer') then raise exception 'Customer/Sales activity may never be deleted';end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into td from public.transport_supplier_documents where purchase_order_id=po.id;
 if cardinality(td)<>1 then raise exception 'Exactly one native supplier document required';end if;
 if exists(select 1 from public.transport_supplier_document_rents where document_id=any(td) and is_adjustment) then raise exception 'Adjusted rent prevents deletion';end if;
 -- Lock and retain exact before-images inside the same database before deleting.
 foreach tbl in array array['purchase_orders','purchase_service_lines','purchase_payment_allocations','transport_supplier_documents','transport_supplier_document_rents','journal_entries','journal_lines','ledgers','party_ledgers'] loop
 predicate:=case tbl when 'purchase_orders' then 'id=$1' when 'purchase_service_lines' then 'order_id=$1' when 'purchase_payment_allocations' then 'purchase_order_id=$1' when 'transport_supplier_documents' then 'purchase_order_id=$1' when 'transport_supplier_document_rents' then 'document_id=any($3)' when 'journal_entries' then 'id=any($2)' when 'journal_lines' then 'entry_id=any($2)' else 'journal_entry_id=any($2)' end;
 execute format('select 1 from public.%I where %s for update',tbl,predicate) using po.id,jids,td;
 execute format('insert into public.transport_partner_purchase_delete_gates select txid_current(),auth.uid(),$4,$5,$6,%L,id,to_jsonb(r) from public.%I r where %s',tbl,tbl,predicate) using po.id,jids,td,c,b,loc;
 end loop;
 insert into public.transport_partner_purchase_cleanup_audit(transaction_id,actor_id,company_id,business_unit_id,operating_location_id,document_id,table_name,row_id,before_row,reason)
 select transaction_id,actor_id,company_id,business_unit_id,operating_location_id,v.document_id,table_name,row_id,before_row,btrim(p_reason) from public.transport_partner_purchase_delete_gates where transaction_id=txid_current() and actor_id=auth.uid();
 delete from public.purchase_payment_allocations where purchase_order_id=po.id;
 delete from public.transport_supplier_document_rents where document_id=any(td);
 delete from public.transport_supplier_documents where id=any(td);
 delete from public.purchase_service_lines where order_id=po.id;
 delete from public.party_ledgers where journal_entry_id=any(jids);
 delete from public.ledgers where journal_entry_id=any(jids);
 delete from public.journal_lines where entry_id=any(jids);
 delete from public.journal_entries where id=any(jids);
 delete from public.purchase_orders where id=po.id;
 update public.transport_register_invoice_conversions set status='partner_excluded',order_id=null,invoice_journal_id=null,clearing_journal_id=null,reclass_journal_id=null,error='Imported partner Purchase deleted on owner instruction; Trips and Sales retained' where document_id=v.document_id;
 delete from public.transport_partner_purchase_delete_gates where transaction_id=txid_current() and actor_id=auth.uid();
 done:=done+1;
 end loop;
 with running as(select pl.id,sum(pl.debit-pl.credit) over(partition by pl.user_id,pl.business_unit_id,pl.party_type,pl.party_id order by pl.entry_date,pl.created_at,pl.id rows unbounded preceding) balance from public.party_ledgers pl where pl.company_id=c and pl.business_unit_id=b and pl.party_type='supplier' and exists(select 1 from public.transport_partner_purchase_exclusions e where e.company_id=c and e.business_unit_id=b and e.operating_location_id=loc and e.supplier_id=pl.party_id))
 update public.party_ledgers pl set balance=r.balance from running r where pl.id=r.id and pl.balance is distinct from r.balance;
 return jsonb_build_object('deleted',done,'remaining',(select count(*) from public.transport_register_invoice_conversions cv join public.transport_opening_invoice_documents d on d.id=cv.document_id join public.transport_partner_purchase_exclusions e on e.company_id=cv.company_id and e.business_unit_id=cv.business_unit_id and e.operating_location_id=cv.operating_location_id and e.supplier_id=d.party_id where cv.company_id=c and cv.business_unit_id=b and cv.operating_location_id=loc and cv.side='supplier' and cv.status in('posted','blocked')),'trips_deleted',0,'sales_deleted',0,'reversals_created',0);
end $$;
revoke all on function public.transport_delete_imported_partner_purchase_batch(integer,text) from public,anon;
grant execute on function public.transport_delete_imported_partner_purchase_batch(integer,text) to authenticated;

-- Defense in depth: even an old prepared row must never be re-posted as Purchase.
do $patch$ declare f text;marker text:='and q.side=p_side and';begin
 f:=pg_get_functiondef('public.transport_convert_register_invoice_batch(text,integer,boolean)'::regprocedure);
 if strpos(f,marker)=0 then raise exception 'Expected converter side condition missing';end if;
 execute replace(f,marker,marker||' not exists(select 1 from public.transport_opening_invoice_documents od join public.transport_partner_purchase_exclusions e on e.company_id=od.company_id and e.business_unit_id=od.business_unit_id and e.operating_location_id=od.operating_location_id and e.supplier_id=od.party_id where od.id=q.document_id and q.side=''supplier'') and');
end $patch$;
notify pgrst,'reload schema';
commit;
