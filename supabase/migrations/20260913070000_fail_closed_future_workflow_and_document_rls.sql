-- Keep future approval workflows fail-closed until a customer-facing approval feature is enabled.
drop policy if exists approval_workflows_scope on public.approval_workflows;
drop policy if exists approval_steps_scope on public.approval_steps;
drop policy if exists approval_requests_scope on public.approval_requests;

drop policy if exists approval_workflows_select on public.approval_workflows;
drop policy if exists approval_workflows_insert on public.approval_workflows;
drop policy if exists approval_workflows_update on public.approval_workflows;
drop policy if exists approval_workflows_delete on public.approval_workflows;
create policy approval_workflows_select on public.approval_workflows for select to authenticated using (company_id=public.current_company_id() and public.can_manage_company_access(company_id));
create policy approval_workflows_insert on public.approval_workflows for insert to authenticated with check (company_id=public.current_company_id() and public.can_manage_company_access(company_id));
create policy approval_workflows_update on public.approval_workflows for update to authenticated using (company_id=public.current_company_id() and public.can_manage_company_access(company_id)) with check (company_id=public.current_company_id() and public.can_manage_company_access(company_id));
create policy approval_workflows_delete on public.approval_workflows for delete to authenticated using (company_id=public.current_company_id() and public.can_manage_company_access(company_id));

drop policy if exists approval_steps_select on public.approval_steps;
drop policy if exists approval_steps_insert on public.approval_steps;
drop policy if exists approval_steps_update on public.approval_steps;
drop policy if exists approval_steps_delete on public.approval_steps;
create policy approval_steps_select on public.approval_steps for select to authenticated using (exists(select 1 from public.approval_workflows w where w.id=approval_steps.workflow_id and w.company_id=public.current_company_id() and public.can_manage_company_access(w.company_id)));
create policy approval_steps_insert on public.approval_steps for insert to authenticated with check (exists(select 1 from public.approval_workflows w where w.id=approval_steps.workflow_id and w.company_id=public.current_company_id() and public.can_manage_company_access(w.company_id)));
create policy approval_steps_update on public.approval_steps for update to authenticated using (exists(select 1 from public.approval_workflows w where w.id=approval_steps.workflow_id and w.company_id=public.current_company_id() and public.can_manage_company_access(w.company_id))) with check (exists(select 1 from public.approval_workflows w where w.id=approval_steps.workflow_id and w.company_id=public.current_company_id() and public.can_manage_company_access(w.company_id)));
create policy approval_steps_delete on public.approval_steps for delete to authenticated using (exists(select 1 from public.approval_workflows w where w.id=approval_steps.workflow_id and w.company_id=public.current_company_id() and public.can_manage_company_access(w.company_id)));

drop policy if exists approval_requests_select on public.approval_requests;
drop policy if exists approval_requests_insert on public.approval_requests;
drop policy if exists approval_requests_update on public.approval_requests;
drop policy if exists approval_requests_delete on public.approval_requests;
create policy approval_requests_select on public.approval_requests for select to authenticated using (company_id=public.current_company_id() and public.can_manage_company_access(company_id));
create policy approval_requests_insert on public.approval_requests for insert to authenticated with check (company_id=public.current_company_id() and public.can_manage_company_access(company_id));
create policy approval_requests_update on public.approval_requests for update to authenticated using (company_id=public.current_company_id() and public.can_manage_company_access(company_id)) with check (company_id=public.current_company_id() and public.can_manage_company_access(company_id));
create policy approval_requests_delete on public.approval_requests for delete to authenticated using (company_id=public.current_company_id() and public.can_manage_company_access(company_id));

-- Attachments and document links inherit permissions from their source module.
-- Unknown source modules are denied automatically until added to module permissions.
drop policy if exists transaction_attachments_scope on public.transaction_attachments;
drop policy if exists transaction_links_scope on public.transaction_links;

drop policy if exists transaction_attachments_select on public.transaction_attachments;
drop policy if exists transaction_attachments_insert on public.transaction_attachments;
drop policy if exists transaction_attachments_update on public.transaction_attachments;
drop policy if exists transaction_attachments_delete on public.transaction_attachments;
create policy transaction_attachments_select on public.transaction_attachments for select to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and source_module in ('master','sales','purchase','inventory','production','transport','accounting','reports','settings') and public.has_module_permission(company_id,source_module,'view'));
create policy transaction_attachments_insert on public.transaction_attachments for insert to authenticated with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and uploaded_by=(select auth.uid()) and source_module in ('master','sales','purchase','inventory','production','transport','accounting','reports','settings') and (public.has_module_permission(company_id,source_module,'create') or public.has_module_permission(company_id,source_module,'edit')));
create policy transaction_attachments_update on public.transaction_attachments for update to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and source_module in ('master','sales','purchase','inventory','production','transport','accounting','reports','settings') and public.has_module_permission(company_id,source_module,'edit')) with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and source_module in ('master','sales','purchase','inventory','production','transport','accounting','reports','settings') and public.has_module_permission(company_id,source_module,'edit'));
create policy transaction_attachments_delete on public.transaction_attachments for delete to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and source_module in ('master','sales','purchase','inventory','production','transport','accounting','reports','settings') and public.has_module_permission(company_id,source_module,'delete'));

drop policy if exists transaction_links_select on public.transaction_links;
drop policy if exists transaction_links_insert on public.transaction_links;
drop policy if exists transaction_links_update on public.transaction_links;
drop policy if exists transaction_links_delete on public.transaction_links;
create policy transaction_links_select on public.transaction_links for select to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and source_module in ('master','sales','purchase','inventory','production','transport','accounting','reports','settings') and public.has_module_permission(company_id,source_module,'view'));
create policy transaction_links_insert on public.transaction_links for insert to authenticated with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and source_module in ('master','sales','purchase','inventory','production','transport','accounting','reports','settings') and (public.has_module_permission(company_id,source_module,'create') or public.has_module_permission(company_id,source_module,'edit')));
create policy transaction_links_update on public.transaction_links for update to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and source_module in ('master','sales','purchase','inventory','production','transport','accounting','reports','settings') and public.has_module_permission(company_id,source_module,'edit')) with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and source_module in ('master','sales','purchase','inventory','production','transport','accounting','reports','settings') and public.has_module_permission(company_id,source_module,'edit'));
create policy transaction_links_delete on public.transaction_links for delete to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and source_module in ('master','sales','purchase','inventory','production','transport','accounting','reports','settings') and public.has_module_permission(company_id,source_module,'delete'));
