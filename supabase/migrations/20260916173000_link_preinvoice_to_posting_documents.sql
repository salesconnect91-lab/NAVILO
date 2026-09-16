begin;
create table public.preinvoice_external_links(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete restrict,source_document_id uuid not null references public.preinvoice_documents(id) on delete restrict,
 target_type text not null check(target_type in('sales_invoice','purchase_invoice','gate_pass')),target_id uuid not null,quantities jsonb not null default '{}'::jsonb,
 created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),created_at timestamptz not null default now(),unique(company_id,target_type,target_id)
);
create index idx_preinvoice_external_source on public.preinvoice_external_links(source_document_id);
alter table public.preinvoice_external_links enable row level security;
revoke all on public.preinvoice_external_links from anon;revoke insert,update,delete on public.preinvoice_external_links from authenticated;grant select on public.preinvoice_external_links to authenticated;
create policy preinvoice_external_links_select on public.preinvoice_external_links for select to authenticated using(company_id=(select public.current_company_id()) and business_unit_id=(select public.current_business_unit_id()));

create or replace function public.link_preinvoice_posting_document(p_source_document_id uuid,p_target_type text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_source public.preinvoice_documents%rowtype;v_required_type text;v_module text;v_quantities jsonb;v_item text;v_qty numeric;v_available numeric;v_used numeric;v_target_company uuid;v_target_bu uuid;v_target_status text;
begin
 if v_user is null then raise exception 'Authentication is required.';end if;
 select * into v_source from public.preinvoice_documents where id=p_source_document_id for update;
 if v_source.id is null or v_source.company_id<>public.current_company_id() or v_source.business_unit_id<>public.current_business_unit_id() then raise exception 'Source document not found in active company/business unit.';end if;
 if v_source.status<>'posted' then raise exception 'Source document must be posted before final linking.';end if;
 v_required_type:=case p_target_type when 'purchase_invoice' then 'goods_receipt' when 'sales_invoice' then 'dispatch' when 'gate_pass' then 'dispatch' else null end;
 if v_required_type is null or v_source.document_type<>v_required_type then raise exception 'Invalid source/target document combination.';end if;
 v_module:=case when p_target_type='purchase_invoice' then 'purchase' else 'sales' end;
 if not public.has_module_permission(v_source.company_id,v_module,'edit') then raise exception 'Edit permission is required.';end if;
 if p_target_type='sales_invoice' then
  select company_id,business_unit_id,status into v_target_company,v_target_bu,v_target_status from public.sales_orders where id=p_target_id;
  select jsonb_object_agg(item_id::text,qty) into v_quantities from(select item_id,sum(qty) qty from public.sales_order_lines where order_id=p_target_id group by item_id)x;
 elsif p_target_type='purchase_invoice' then
  select company_id,business_unit_id,status into v_target_company,v_target_bu,v_target_status from public.purchase_orders where id=p_target_id;
  select jsonb_object_agg(item_id::text,qty) into v_quantities from(select item_id,sum(qty) qty from public.purchase_order_lines where order_id=p_target_id group by item_id)x;
 else
  select company_id,business_unit_id,status into v_target_company,v_target_bu,v_target_status from public.gate_passes where id=p_target_id;
  select jsonb_object_agg(item_id::text,qty) into v_quantities from(select item_id,sum(coalesce(nullif(actual_qty,0),requested_qty)) qty from public.gate_pass_lines where gate_pass_id=p_target_id group by item_id)x;
 end if;
 if v_target_company is null or v_target_company<>v_source.company_id or v_target_bu<>v_source.business_unit_id then raise exception 'Target document is outside the active company/business unit.';end if;
 if coalesce(v_quantities,'{}'::jsonb)='{}'::jsonb then raise exception 'Target document has no item quantities.';end if;
 for v_item,v_qty in select key,value::text::numeric from jsonb_each(v_quantities) loop
  select coalesce(sum(qty),0) into v_available from public.preinvoice_document_lines where document_id=v_source.id and item_id=v_item::uuid;
  select coalesce(sum((e.value)::text::numeric),0) into v_used from public.preinvoice_external_links l cross join lateral jsonb_each(l.quantities)e where l.source_document_id=v_source.id and e.key=v_item;
  if v_qty>v_available-v_used then raise exception 'Target quantity for item % exceeds remaining source quantity (%).',v_item,v_available-v_used;end if;
 end loop;
 insert into public.preinvoice_external_links(company_id,business_unit_id,source_document_id,target_type,target_id,quantities,created_by) values(v_source.company_id,v_source.business_unit_id,v_source.id,p_target_type,p_target_id,v_quantities,v_user);
 perform public.record_transaction_link(v_source.company_id,v_source.business_unit_id,v_module,v_source.document_type,v_source.id,case when p_target_type='gate_pass' then 'production' else v_module end,p_target_type,p_target_id,'converted_to');
 return jsonb_build_object('success',true,'source_document_id',v_source.id,'target_type',p_target_type,'target_id',p_target_id,'quantities',v_quantities);
end;$$;
revoke all on function public.link_preinvoice_posting_document(uuid,text,uuid) from public,anon;grant execute on function public.link_preinvoice_posting_document(uuid,text,uuid) to authenticated;
notify pgrst,'reload schema';commit;
