-- Cover foreign keys used by tenant/feature/payroll/loan workloads.
create index if not exists idx_bu_feature_entitlements_company_id on public.business_unit_feature_entitlements(company_id);
create index if not exists idx_bu_feature_entitlements_feature_key on public.business_unit_feature_entitlements(feature_key);
create index if not exists idx_company_feature_entitlements_feature_key on public.company_feature_entitlements(feature_key);
create index if not exists idx_employee_salary_accruals_employee_id on public.employee_salary_accruals(employee_id);
create index if not exists idx_employee_salary_accruals_journal_entry_id on public.employee_salary_accruals(journal_entry_id);
create index if not exists idx_employee_salary_payments_employee_id on public.employee_salary_payments(employee_id);
create index if not exists idx_employee_salary_profiles_employee_id on public.employee_salary_profiles(employee_id);
create index if not exists idx_loan_party_transactions_journal_entry_id on public.loan_party_transactions(journal_entry_id);

drop index if exists public.idx_fk_journal_entries_journal_entries_operating_location_id_fk;
drop index if exists public.idx_fk_journal_lines_journal_lines_operating_location_id_fkey;

drop policy if exists operating_locations_select_access on public.operating_locations;
drop policy if exists operating_locations_insert on public.operating_locations;
drop policy if exists operating_locations_update on public.operating_locations;
drop policy if exists operating_locations_delete on public.operating_locations;

drop policy if exists platform_features_owner_write on public.platform_features;
create policy platform_features_owner_insert on public.platform_features for insert to authenticated with check (public.is_platform_owner());
create policy platform_features_owner_update on public.platform_features for update to authenticated using (public.is_platform_owner()) with check (public.is_platform_owner());
create policy platform_features_owner_delete on public.platform_features for delete to authenticated using (public.is_platform_owner());

drop policy if exists company_feature_entitlements_owner_write on public.company_feature_entitlements;
create policy company_feature_entitlements_owner_insert on public.company_feature_entitlements for insert to authenticated with check (public.is_platform_owner());
create policy company_feature_entitlements_owner_update on public.company_feature_entitlements for update to authenticated using (public.is_platform_owner()) with check (public.is_platform_owner());
create policy company_feature_entitlements_owner_delete on public.company_feature_entitlements for delete to authenticated using (public.is_platform_owner());

drop policy if exists business_unit_feature_entitlements_owner_write on public.business_unit_feature_entitlements;
create policy business_unit_feature_entitlements_owner_insert on public.business_unit_feature_entitlements for insert to authenticated with check (public.is_platform_owner());
create policy business_unit_feature_entitlements_owner_update on public.business_unit_feature_entitlements for update to authenticated using (public.is_platform_owner()) with check (public.is_platform_owner());
create policy business_unit_feature_entitlements_owner_delete on public.business_unit_feature_entitlements for delete to authenticated using (public.is_platform_owner());

drop policy if exists dashboard_widget_preferences_select on public.dashboard_widget_preferences;
drop policy if exists dashboard_widget_preferences_insert on public.dashboard_widget_preferences;
drop policy if exists dashboard_widget_preferences_update on public.dashboard_widget_preferences;
drop policy if exists dashboard_widget_preferences_delete on public.dashboard_widget_preferences;
create policy dashboard_widget_preferences_select on public.dashboard_widget_preferences for select to authenticated using (user_id=(select auth.uid()) and company_id=public.current_company_id());
create policy dashboard_widget_preferences_insert on public.dashboard_widget_preferences for insert to authenticated with check (user_id=(select auth.uid()) and company_id=public.current_company_id());
create policy dashboard_widget_preferences_update on public.dashboard_widget_preferences for update to authenticated using (user_id=(select auth.uid()) and company_id=public.current_company_id()) with check (user_id=(select auth.uid()) and company_id=public.current_company_id());
create policy dashboard_widget_preferences_delete on public.dashboard_widget_preferences for delete to authenticated using (user_id=(select auth.uid()) and company_id=public.current_company_id());

drop policy if exists operating_location_memberships_select on public.operating_location_memberships;
create policy operating_location_memberships_select on public.operating_location_memberships for select to authenticated using (public.is_platform_owner() or user_id=(select auth.uid()) or public.can_manage_company_access(company_id));

drop policy if exists business_unit_feature_entitlements_read on public.business_unit_feature_entitlements;
create policy business_unit_feature_entitlements_read on public.business_unit_feature_entitlements for select to authenticated using (
  public.is_platform_owner() or exists(select 1 from public.business_unit_memberships bm where bm.business_unit_id=business_unit_feature_entitlements.business_unit_id and bm.user_id=(select auth.uid()) and bm.is_active)
);
