-- Atomic settlement upload through canonical posting, with explicit identity filters.
begin;
create table public.transport_settlement_import_sources(
 company_id uuid not null references public.companies(id),
 business_unit_id uuid not null references public.business_units(id),
 operating_location_id uuid not null references public.operating_locations(id),
 source_reference text not null check(source_reference=lower(btrim(source_reference)) and source_reference<>''),
 result jsonb not null,created_by uuid not null,created_at timestamptz not null default now(),
 primary key(company_id,business_unit_id,source_reference)
);
alter table public.transport_settlement_import_sources enable row level security;
revoke all on public.transport_settlement_import_sources from public,anon,authenticated;
create or replace function public.transport_import_settlements_batch(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;v_side text;v_party uuid;v_account uuid;v_document uuid;v_matches uuid[];n integer:=0;
 c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();ref text;answer jsonb;
begin
 perform public.transport_finance_assert('settlement');
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Upload 1–500 settlement rows';end if;
 if (select count(distinct lower(btrim(value->>'source_reference'))) from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then raise exception 'Duplicate Source Reference in settlement file';end if;
 -- Same company/business reference is serialized, including differently cased retries.
 for ref in select lower(btrim(value->>'source_reference')) from jsonb_array_elements(p_rows) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended(c::text||':'||b::text||':settlement-import:'||ref,0));
 end loop;
 for r in select value from jsonb_array_elements(p_rows) loop
  v_side:=lower(btrim(r->>'side'));
  if v_side is null or v_side not in ('customer','supplier') then raise exception 'Settlement Side must be Customer or Supplier';end if;
  if nullif(btrim(r->>'source_reference'),'') is null or nullif(r->>'payment_date','') is null or coalesce(r->>'amount','') !~ '^[0-9]+(\.[0-9]{1,2})?$' or (r->>'amount')::numeric<=0 then raise exception 'Source Reference, Payment Date and positive two-decimal Amount are required';end if;
  if exists(select 1 from public.transport_settlement_import_sources s where s.company_id=c and s.business_unit_id=b and s.source_reference=lower(btrim(r->>'source_reference'))) then raise exception 'Settlement Source Reference already posted: %',r->>'source_reference';end if;
  if v_side='customer' then
   select array_agg(p.id) into v_matches from public.customers p where p.company_id=c and lower(btrim(p.name))=lower(btrim(r->>'party')) and p.is_active;
  else
   select array_agg(p.id) into v_matches from public.suppliers p where p.company_id=c and lower(btrim(p.name))=lower(btrim(r->>'party')) and p.is_active;
  end if;
  if coalesce(cardinality(v_matches),0)<>1 then raise exception 'Settlement party must match exactly one active record: %',r->>'party';end if;v_party:=v_matches[1];
  select array_agg(a.id) into v_matches from public.chart_of_accounts a where a.company_id=c and (lower(btrim(a.code))=lower(btrim(r->>'account')) or lower(btrim(a.name))=lower(btrim(r->>'account'))) and a.is_active and not a.is_group;
  if coalesce(cardinality(v_matches),0)<>1 then raise exception 'Settlement account must match exactly one posting account: %',r->>'account';end if;v_account:=v_matches[1];
  select array_agg(d.order_id) into v_matches from public.transport_service_document_balances d where d.side=v_side and d.party_id=v_party and d.company_id=c and d.business_unit_id=b and d.operating_location_id=loc and lower(btrim(d.order_no))=lower(btrim(r->>'document_no'));
  if coalesce(cardinality(v_matches),0)<>1 then raise exception 'Transport document must match exactly one active-branch document: %',r->>'document_no';end if;v_document:=v_matches[1];
  answer:=public.transport_settle_documents(v_side,v_party,(r->>'payment_date')::date,v_account,coalesce(nullif(btrim(r->>'method'),''),'Bank'),jsonb_build_array(jsonb_build_object('document_id',v_document,'amount',(r->>'amount')::numeric)),null,btrim(r->>'source_reference'));
  insert into public.transport_settlement_import_sources(company_id,business_unit_id,operating_location_id,source_reference,result,created_by) values(c,b,loc,lower(btrim(r->>'source_reference')),answer,auth.uid());
  n:=n+1;
 end loop;
 return jsonb_build_object('success',true,'posted',n);
end $$;
revoke all on function public.transport_import_settlements_batch(jsonb) from public,anon;
grant execute on function public.transport_import_settlements_batch(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
