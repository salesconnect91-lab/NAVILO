-- Enforce fine-grained accounting permissions on accounting configuration tables.
do $do$
declare t text;
begin
  foreach t in array array['accounting_dimensions','accounting_exceptions','company_accounting_policies','currency_rates','document_sequences','inter_unit_account_mappings','posting_rules'] loop
    execute format('drop policy if exists %I on public.%I',t||'_scope',t);
    execute format('drop policy if exists %I on public.%I',t||'_select',t);
    execute format('drop policy if exists %I on public.%I',t||'_insert',t);
    execute format('drop policy if exists %I on public.%I',t||'_update',t);
    execute format('drop policy if exists %I on public.%I',t||'_delete',t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id=public.current_company_id() and public.has_module_permission(company_id,''accounting'',''view''))',t||'_select',t);
    execute format('create policy %I on public.%I for insert to authenticated with check (company_id=public.current_company_id() and public.has_module_permission(company_id,''accounting'',''create''))',t||'_insert',t);
    execute format('create policy %I on public.%I for update to authenticated using (company_id=public.current_company_id() and public.has_module_permission(company_id,''accounting'',''edit'')) with check (company_id=public.current_company_id() and public.has_module_permission(company_id,''accounting'',''edit''))',t||'_update',t);
    execute format('create policy %I on public.%I for delete to authenticated using (company_id=public.current_company_id() and public.has_module_permission(company_id,''accounting'',''delete''))',t||'_delete',t);
  end loop;
end
$do$;

drop policy if exists posting_rule_lines_scope on public.posting_rule_lines;
drop policy if exists posting_rule_lines_select on public.posting_rule_lines;
drop policy if exists posting_rule_lines_insert on public.posting_rule_lines;
drop policy if exists posting_rule_lines_update on public.posting_rule_lines;
drop policy if exists posting_rule_lines_delete on public.posting_rule_lines;
create policy posting_rule_lines_select on public.posting_rule_lines for select to authenticated using (exists(select 1 from public.posting_rules r where r.id=posting_rule_lines.rule_id and r.company_id=public.current_company_id() and public.has_module_permission(r.company_id,'accounting','view')));
create policy posting_rule_lines_insert on public.posting_rule_lines for insert to authenticated with check (exists(select 1 from public.posting_rules r where r.id=posting_rule_lines.rule_id and r.company_id=public.current_company_id() and public.has_module_permission(r.company_id,'accounting','create')));
create policy posting_rule_lines_update on public.posting_rule_lines for update to authenticated using (exists(select 1 from public.posting_rules r where r.id=posting_rule_lines.rule_id and r.company_id=public.current_company_id() and public.has_module_permission(r.company_id,'accounting','edit'))) with check (exists(select 1 from public.posting_rules r where r.id=posting_rule_lines.rule_id and r.company_id=public.current_company_id() and public.has_module_permission(r.company_id,'accounting','edit')));
create policy posting_rule_lines_delete on public.posting_rule_lines for delete to authenticated using (exists(select 1 from public.posting_rules r where r.id=posting_rule_lines.rule_id and r.company_id=public.current_company_id() and public.has_module_permission(r.company_id,'accounting','delete')));
