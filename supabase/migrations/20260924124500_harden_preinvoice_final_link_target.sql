create or replace function public.validate_preinvoice_external_link_target()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_source public.preinvoice_documents%rowtype; v_target_status text; v_target_party uuid; v_expected_source text;
begin
 select * into v_source from public.preinvoice_documents where id=new.source_document_id;
 if v_source.id is null then raise exception 'Commercial source document does not exist.'; end if;
 if v_source.status <> 'posted' then raise exception 'Commercial source document must be posted before final linking.'; end if;
 v_expected_source:=case new.target_type when 'purchase_invoice' then 'goods_receipt' when 'sales_invoice' then 'dispatch' when 'gate_pass' then 'dispatch' else null end;
 if v_expected_source is null or v_source.document_type<>v_expected_source then raise exception 'Invalid commercial source/final document combination.'; end if;
 if new.target_type='sales_invoice' then
  select status,customer_id into v_target_status,v_target_party from public.sales_orders where id=new.target_id and company_id=new.company_id and business_unit_id=new.business_unit_id;
 elsif new.target_type='purchase_invoice' then
  select status,supplier_id into v_target_status,v_target_party from public.purchase_orders where id=new.target_id and company_id=new.company_id and business_unit_id=new.business_unit_id;
 else
  select status,customer_id into v_target_status,v_target_party from public.gate_passes where id=new.target_id and company_id=new.company_id and business_unit_id=new.business_unit_id;
 end if;
 if v_target_status is null then raise exception 'Final document was not found in the same company/business unit.'; end if;
 if new.target_type in ('sales_invoice','purchase_invoice') and v_target_status<>'posted' then raise exception 'Final invoice/order must be posted before linking.'; end if;
 if v_source.party_id is not null and v_target_party is distinct from v_source.party_id then raise exception 'Final document party must match the commercial source document party.'; end if;
 return new;
end; $$;
revoke all on function public.validate_preinvoice_external_link_target() from public,anon,authenticated;
drop trigger if exists trg_validate_preinvoice_external_link_target on public.preinvoice_external_links;
create trigger trg_validate_preinvoice_external_link_target before insert or update of source_document_id,target_type,target_id on public.preinvoice_external_links for each row execute function public.validate_preinvoice_external_link_target();