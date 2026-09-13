drop policy if exists tenant_select_entity_translations on public.entity_translations;
drop policy if exists tenant_insert_entity_translations on public.entity_translations;
drop policy if exists tenant_update_entity_translations on public.entity_translations;
drop policy if exists tenant_delete_entity_translations on public.entity_translations;

create policy tenant_select_entity_translations on public.entity_translations
for select to authenticated
using (company_id=public.current_company_id() and (public.has_module_permission(company_id,'master','view') or public.has_module_permission(company_id,'settings','view')));

create policy tenant_insert_entity_translations on public.entity_translations
for insert to authenticated
with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'master','create'));

create policy tenant_update_entity_translations on public.entity_translations
for update to authenticated
using (company_id=public.current_company_id() and public.has_module_permission(company_id,'master','edit'))
with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'master','edit'));

create policy tenant_delete_entity_translations on public.entity_translations
for delete to authenticated
using (company_id=public.current_company_id() and public.has_module_permission(company_id,'master','delete'));
