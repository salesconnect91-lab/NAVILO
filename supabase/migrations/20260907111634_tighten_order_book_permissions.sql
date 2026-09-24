drop policy if exists order_book_commitments_all on public.order_book_commitments;
create policy order_book_commitments_select on public.order_book_commitments for select to authenticated using (
 company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and exists (
   select 1 from public.order_book_headers h where h.id=order_id and
   ((h.order_type='sales' and public.has_module_permission(h.company_id,'sales','view')) or (h.order_type='purchase' and public.has_module_permission(h.company_id,'purchase','view')))
 ));
create policy order_book_commitments_insert on public.order_book_commitments for insert to authenticated with check (
 company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and exists (
   select 1 from public.order_book_headers h where h.id=order_id and h.company_id=public.current_company_id() and h.business_unit_id=public.current_business_unit_id() and
   ((h.order_type='sales' and public.has_module_permission(h.company_id,'sales','create')) or (h.order_type='purchase' and public.has_module_permission(h.company_id,'purchase','create')))
 ));
create policy order_book_commitments_update on public.order_book_commitments for update to authenticated using (
 company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and exists (
   select 1 from public.order_book_headers h where h.id=order_id and
   ((h.order_type='sales' and public.has_module_permission(h.company_id,'sales','edit')) or (h.order_type='purchase' and public.has_module_permission(h.company_id,'purchase','edit')))
 )) with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id());
create policy order_book_commitments_delete on public.order_book_commitments for delete to authenticated using (
 company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and exists (
   select 1 from public.order_book_headers h where h.id=order_id and
   ((h.order_type='sales' and public.has_module_permission(h.company_id,'sales','delete')) or (h.order_type='purchase' and public.has_module_permission(h.company_id,'purchase','delete')))
 ));

drop policy if exists order_book_rate_history_all on public.order_book_rate_history;
create policy order_book_rate_history_select on public.order_book_rate_history for select to authenticated using (
 company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and exists (
  select 1 from public.order_book_commitments c join public.order_book_headers h on h.id=c.order_id where c.id=commitment_id and ((h.order_type='sales' and public.has_module_permission(h.company_id,'sales','view')) or (h.order_type='purchase' and public.has_module_permission(h.company_id,'purchase','view')))
 ));
create policy order_book_rate_history_insert on public.order_book_rate_history for insert to authenticated with check (
 company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and exists (
  select 1 from public.order_book_commitments c join public.order_book_headers h on h.id=c.order_id where c.id=commitment_id and ((h.order_type='sales' and public.has_module_permission(h.company_id,'sales','edit')) or (h.order_type='purchase' and public.has_module_permission(h.company_id,'purchase','edit')))
 ));

drop policy if exists order_book_allocations_all on public.order_book_allocations;
create policy order_book_allocations_select on public.order_book_allocations for select to authenticated using (
 company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and exists (
  select 1 from public.order_book_commitments c join public.order_book_headers h on h.id=c.order_id where c.id=commitment_id and ((h.order_type='sales' and public.has_module_permission(h.company_id,'sales','view')) or (h.order_type='purchase' and public.has_module_permission(h.company_id,'purchase','view')))
 ));
create policy order_book_allocations_insert on public.order_book_allocations for insert to authenticated with check (
 company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and exists (
  select 1 from public.order_book_commitments c join public.order_book_headers h on h.id=c.order_id where c.id=commitment_id and ((h.order_type='sales' and public.has_module_permission(h.company_id,'sales','edit')) or (h.order_type='purchase' and public.has_module_permission(h.company_id,'purchase','edit')))
 ));
revoke update,delete on public.order_book_rate_history,public.order_book_allocations from authenticated;