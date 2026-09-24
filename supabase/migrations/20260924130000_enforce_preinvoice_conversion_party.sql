create or replace function public.validate_preinvoice_conversion_party()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_source public.preinvoice_documents%rowtype;
begin
 if new.source_document_id is null then return new; end if;
 select * into v_source from public.preinvoice_documents where id=new.source_document_id;
 if v_source.id is null then raise exception 'Upstream commercial document does not exist.'; end if;
 if v_source.company_id<>new.company_id or v_source.business_unit_id<>new.business_unit_id then raise exception 'Upstream document must belong to the same company/business unit.'; end if;
 if v_source.party_id is distinct from new.party_id then raise exception 'Converted document party must match the upstream document party.'; end if;
 return new;
end; $$;
revoke all on function public.validate_preinvoice_conversion_party() from public,anon,authenticated;
drop trigger if exists trg_validate_preinvoice_conversion_party on public.preinvoice_documents;
create trigger trg_validate_preinvoice_conversion_party before insert or update of source_document_id,party_id on public.preinvoice_documents for each row execute function public.validate_preinvoice_conversion_party();