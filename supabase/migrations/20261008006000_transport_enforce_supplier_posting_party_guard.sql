-- Enforce active Supplier at the canonical Transport supplier posting boundary.
-- This does not alter historical posted documents.
create or replace function public.transport_supplier_posting_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.supplier_id is null or not exists(
   select 1 from public.suppliers s
   where s.id=new.supplier_id and s.company_id=new.company_id and s.is_active
 ) then
   raise exception 'Active same-company Supplier required for Transport supplier posting';
 end if;
 return new;
end $$;

drop trigger if exists transport_supplier_document_active_party_guard on public.transport_supplier_documents;
create trigger transport_supplier_document_active_party_guard
before insert on public.transport_supplier_documents
for each row execute function public.transport_supplier_posting_guard();

-- Also protect the canonical Purchase document created by Transport before it can become linked evidence.
create or replace function public.transport_purchase_order_party_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.document_kind='service'
    and exists(select 1 from public.purchase_service_lines l where l.order_id=new.id and l.source_module='transport')
    and (new.supplier_id is null or not exists(
      select 1 from public.suppliers s where s.id=new.supplier_id and s.company_id=new.company_id and s.is_active
    ))
 then raise exception 'Active same-company Supplier required for Transport Purchase invoice';
 end if;
 return new;
end $$;
