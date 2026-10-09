-- Optional company-vehicle attribution on manual income/expense journal lines.
-- No extra financial posting; canonical journals remain the single accounting source.
begin;
alter table public.journal_lines add column transport_vehicle_id uuid,
 add column transport_vehicle_no text,
 add constraint journal_line_vehicle_scope_fk foreign key(company_id,business_unit_id,transport_vehicle_id)
 references public.transport_vehicles(company_id,business_unit_id,id);
create index journal_line_vehicle_scope_idx on public.journal_lines(company_id,business_unit_id,transport_vehicle_id) where transport_vehicle_id is not null;
create function public.guard_journal_vehicle_attribution()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.journal_entries%rowtype;n text;source_date date;
begin
 select * into j from public.journal_entries where id=new.entry_id;
 if tg_op='UPDATE' and j.status='posted' and row(new.transport_vehicle_id,new.transport_vehicle_no) is distinct from row(old.transport_vehicle_id,old.transport_vehicle_no) then raise exception 'Posted vehicle attribution is immutable; use journal reversal';end if;
 if new.transport_vehicle_id is null then new.transport_vehicle_no:=null;return new;end if;
 if not exists(select 1 from public.business_units b where b.id=j.business_unit_id and b.company_id=j.company_id and b.unit_type='transport')
 or not public.has_module_permission(j.company_id,'transport','view') then raise exception 'Transport business and view permission required for vehicle journal';end if;
 if not exists(select 1 from public.chart_of_accounts a where a.id=new.account_id and a.company_id=j.company_id and a.type in ('revenue','income','expense')) then raise exception 'Select vehicle only on an income or expense line';end if;
 if coalesce(j.source_module,'') not in ('','accounting') or j.fiscal_year_closure_id is not null or j.monthly_profit_closure_id is not null
 or coalesce(j.trans_type,'') not in ('','Journal Entry','Manual Journal','Journal Reversal') then raise exception 'Vehicle attribution is only for manual journals; source documents already have vehicle links';end if;
 source_date:=j.entry_date;
 if j.reversal_of_entry_id is not null then
  select entry_date into source_date from public.journal_entries where id=j.reversal_of_entry_id and company_id=j.company_id and business_unit_id=j.business_unit_id;
  if not exists(select 1 from public.journal_lines l where l.entry_id=j.reversal_of_entry_id and l.transport_vehicle_id=new.transport_vehicle_id and l.account_id=new.account_id) then raise exception 'Reversal must retain original vehicle attribution';end if;
 end if;
 select v.vehicle_no into n from public.transport_vehicles v where v.id=new.transport_vehicle_id and v.company_id=j.company_id and v.business_unit_id=j.business_unit_id;
 if n is null or not exists(select 1 from public.transport_vehicle_ownership o where o.vehicle_id=new.transport_vehicle_id and o.company_id=j.company_id and o.business_unit_id=j.business_unit_id
 and o.owner_type='company' and o.effective_from<=source_date and (o.effective_to is null or o.effective_to>=source_date)) then raise exception 'Vehicle must be company-owned on the journal date';end if;
 if tg_op='UPDATE' and old.transport_vehicle_id=new.transport_vehicle_id then new.transport_vehicle_no:=old.transport_vehicle_no;else new.transport_vehicle_no:=n;end if;
 return new;
end $$;
revoke all on function public.guard_journal_vehicle_attribution() from public,anon,authenticated;
create trigger zzzz_journal_vehicle_attribution before insert or update on public.journal_lines for each row execute function public.guard_journal_vehicle_attribution();

-- Revalidate draft header changes and posting against the final journal date/source.
create function public.guard_vehicle_journal_header()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare source_date date:=new.entry_date;
begin
 if not exists(select 1 from public.journal_lines where entry_id=new.id and transport_vehicle_id is not null) then return new;end if;
 if coalesce(new.source_module,'') not in ('','accounting') or new.fiscal_year_closure_id is not null or new.monthly_profit_closure_id is not null
 or coalesce(new.trans_type,'') not in ('','Journal Entry','Manual Journal','Journal Reversal') then raise exception 'Vehicle attribution is only for manual journals';end if;
 if new.reversal_of_entry_id is not null then select entry_date into source_date from public.journal_entries where id=new.reversal_of_entry_id;end if;
 if exists(select 1 from public.journal_lines l where l.entry_id=new.id and l.transport_vehicle_id is not null and not exists(
 select 1 from public.transport_vehicle_ownership o where o.vehicle_id=l.transport_vehicle_id and o.company_id=new.company_id and o.business_unit_id=new.business_unit_id and o.owner_type='company' and o.effective_from<=source_date and (o.effective_to is null or o.effective_to>=source_date))) then raise exception 'Vehicle must be company-owned on the journal date';end if;
 return new;
end $$;
revoke all on function public.guard_vehicle_journal_header() from public,anon,authenticated;
create trigger zzzz_vehicle_journal_header before update on public.journal_entries for each row execute function public.guard_vehicle_journal_header();

create view public.transport_vehicle_manual_contributions with(security_invoker=true) as
select 'vehicle-manual:'||l.id::text event_id,j.company_id,j.business_unit_id,j.operating_location_id,null::uuid trip_id,''::text trip_no,
 l.transport_vehicle_id account_id,l.transport_vehicle_no account_name,j.entry_date event_date,j.entry_no,j.trans_type event_type,
 'Manual journal'::text category,a.name::text expense_accounts,
 case when a.type in ('revenue','income') then coalesce(l.base_credit,l.credit)-coalesce(l.base_debit,l.debit) else 0::numeric end revenue,
 case when a.type='expense' then coalesce(l.base_debit,l.debit)-coalesce(l.base_credit,l.credit) else 0::numeric end cost
from public.journal_lines l join public.journal_entries j on j.id=l.entry_id and j.company_id=l.company_id and j.business_unit_id=l.business_unit_id
 join public.chart_of_accounts a on a.id=l.account_id and a.company_id=l.company_id
where j.status='posted' and l.transport_vehicle_id is not null and a.type in ('revenue','income','expense')
 and public.has_module_permission(j.company_id,'accounting','view') and public.has_module_permission(j.company_id,'transport','view');
revoke all on public.transport_vehicle_manual_contributions from public,anon;
grant select on public.transport_vehicle_manual_contributions to authenticated;
do $$declare definition text;begin
 definition:=rtrim(pg_get_viewdef('public.transport_vehicle_contributions'::regclass,true),E';\n ');
 execute 'create or replace view public.transport_vehicle_contributions with(security_invoker=true) as select * from ('||definition||') canonical union all select * from public.transport_vehicle_manual_contributions';
end $$;
-- Existing normal reversal preserves links, including repeated accounts on different vehicles.
do $$declare original text;patched text;begin
 original:=pg_get_functiondef('public.reverse_manual_journal_entry(uuid,date,text)'::regprocedure);
 patched:=replace(original,'party_name,debit,credit)','party_name,debit,credit,transport_vehicle_id)');
 patched:=replace(patched,'round(coalesce(jl.debit,0),2) from public.journal_lines jl','round(coalesce(jl.debit,0),2),jl.transport_vehicle_id from public.journal_lines jl');
 if patched=original or position('jl.transport_vehicle_id' in patched)=0 then raise exception 'Vehicle reversal copy patch did not match';end if;
 execute patched;
end $$;
-- Cheap readers support vehicles with opening/manual journals before any Trip exists.
create function public.transport_vehicle_manual_report_page(p_limit integer default 1000,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'accounting','view') or not public.has_module_permission(c,'transport','view')
 or not public.transport_financial_read_allowed('customer') or not public.transport_financial_read_allowed('supplier') then raise exception 'Vehicle financial view permissions required';end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into answer from (
 select x.* from public.transport_vehicle_manual_contributions x where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc
 order by x.event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0))q;
 return answer;
end $$;
create function public.transport_vehicle_opening_profit_rows()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'accounting','view') or not public.has_module_permission(c,'transport','view')
 or not public.transport_financial_read_allowed('customer') or not public.transport_financial_read_allowed('supplier') then raise exception 'Vehicle financial view permissions required';end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into answer from (
 select h.vehicle_id,h.month,h.net_profit,j.entry_no from public.transport_vehicle_historical_profits h
 join public.journal_lines l on l.id=h.source_journal_line_id and l.company_id=c and l.business_unit_id=b and round(l.credit-l.debit,2)=h.net_profit
 join public.journal_entries j on j.id=l.entry_id and j.company_id=c and j.business_unit_id=b and j.operating_location_id=loc and j.status='posted' and j.source_document_type='cutover_opening_balances'
 where h.company_id=c and h.business_unit_id=b order by h.month,h.vehicle_id)q;
 return answer;
end $$;
revoke all on function public.transport_vehicle_manual_report_page(integer,integer),public.transport_vehicle_opening_profit_rows() from public,anon;
grant execute on function public.transport_vehicle_manual_report_page(integer,integer),public.transport_vehicle_opening_profit_rows() to authenticated;
notify pgrst,'reload schema';
commit;
