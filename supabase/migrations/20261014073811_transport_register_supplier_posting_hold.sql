-- Configuration only: skip selected imported supplier conversions without deleting evidence.
begin;
create table public.transport_register_supplier_posting_holds (
 company_id uuid not null references public.companies(id),
 business_unit_id uuid not null references public.business_units(id),
 operating_location_id uuid not null references public.operating_locations(id),
 supplier_id uuid not null references public.suppliers(id),
 is_active boolean not null default true, reason text not null,
 updated_by uuid not null, updated_at timestamptz not null default now(),
 primary key(company_id,business_unit_id,operating_location_id,supplier_id)
);
alter table public.transport_register_supplier_posting_holds enable row level security;
revoke all on public.transport_register_supplier_posting_holds from public,anon,authenticated;
grant select on public.transport_register_supplier_posting_holds to authenticated;
create policy register_supplier_holds_read on public.transport_register_supplier_posting_holds for select to authenticated using(
 company_id=(select public.current_company_id()) and business_unit_id=(select public.current_business_unit_id())
 and operating_location_id=(select public.current_operating_location_id())
 and public.has_module_permission(company_id,'transport','view'));
create function public.transport_set_register_supplier_posting_hold(p_supplier uuid,p_hold boolean,p_reason text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id();
begin
 perform public.assert_admin_posted_record_control(c);
 perform public.assert_module_permission('accounting','post');
 if auth.uid() is null or c is null or b is null or loc is null or p_hold is null or nullif(btrim(p_reason),'') is null
 or not exists(select 1 from public.suppliers where id=p_supplier and company_id=c) then raise exception 'Active scope, supplier and reason required';end if;
 insert into public.transport_register_supplier_posting_holds values(c,b,loc,p_supplier,p_hold,btrim(p_reason),auth.uid(),now())
 on conflict(company_id,business_unit_id,operating_location_id,supplier_id) do update
 set is_active=excluded.is_active,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
end $$;
revoke all on function public.transport_set_register_supplier_posting_hold(uuid,boolean,text) from public,anon;
grant execute on function public.transport_set_register_supplier_posting_hold(uuid,boolean,text) to authenticated;
do $patch$ declare f text; marker text:='q.side=p_side and'; begin
 f:=pg_get_functiondef('public.transport_convert_register_invoice_batch(text,integer,boolean)'::regprocedure);
 if strpos(f,marker)=0 then raise exception 'Conversion selector changed; inspect before applying';end if;
 execute replace(f,marker,marker||' not exists(select 1 from public.transport_opening_invoice_documents od join public.transport_register_supplier_posting_holds h on h.company_id=od.company_id and h.business_unit_id=od.business_unit_id and h.operating_location_id=od.operating_location_id and h.supplier_id=od.party_id and h.is_active where od.id=q.document_id and q.side=''supplier'') and');
end $patch$;
notify pgrst,'reload schema';
commit;
