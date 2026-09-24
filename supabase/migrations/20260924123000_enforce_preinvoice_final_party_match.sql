begin;

create or replace function public.validate_preinvoice_external_link_party()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_source_party uuid;
  v_target_party uuid;
begin
  select party_id
    into v_source_party
  from public.preinvoice_documents
  where id = new.source_document_id
    and company_id = new.company_id
    and business_unit_id = new.business_unit_id;

  if v_source_party is null then
    return new;
  end if;

  if new.target_type = 'sales_invoice' then
    select customer_id into v_target_party
    from public.sales_orders
    where id = new.target_id
      and company_id = new.company_id
      and business_unit_id = new.business_unit_id;
  elsif new.target_type = 'purchase_invoice' then
    select supplier_id into v_target_party
    from public.purchase_orders
    where id = new.target_id
      and company_id = new.company_id
      and business_unit_id = new.business_unit_id;
  elsif new.target_type = 'gate_pass' then
    select customer_id into v_target_party
    from public.gate_passes
    where id = new.target_id
      and company_id = new.company_id
      and business_unit_id = new.business_unit_id;
  end if;

  if v_target_party is distinct from v_source_party then
    raise exception 'Final document party must match the commercial source document party.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_preinvoice_external_link_party() from public, anon, authenticated;

drop trigger if exists trg_validate_preinvoice_external_link_party on public.preinvoice_external_links;
create trigger trg_validate_preinvoice_external_link_party
before insert or update of source_document_id, target_type, target_id
on public.preinvoice_external_links
for each row execute function public.validate_preinvoice_external_link_party();

commit;
