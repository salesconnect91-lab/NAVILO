-- Avoid per-row execution of stable tenant context functions while scanning journal entries.
-- The SELECT policy keeps the active-company and accounting-view checks unchanged.
DROP POLICY IF EXISTS business_unit_scope ON public.journal_entries;
CREATE POLICY business_unit_scope
  ON public.journal_entries
  FOR ALL
  USING (business_unit_id = (SELECT public.current_business_unit_id()))
  WITH CHECK (business_unit_id = (SELECT public.current_business_unit_id()));

DROP POLICY IF EXISTS journal_entries_operating_location_scope ON public.journal_entries;
CREATE POLICY journal_entries_operating_location_scope
  ON public.journal_entries
  FOR ALL
  USING (
    ((SELECT public.current_operating_location_id()) IS NULL AND operating_location_id IS NULL)
    OR operating_location_id = (SELECT public.current_operating_location_id())
  )
  WITH CHECK (
    ((SELECT public.current_operating_location_id()) IS NULL AND operating_location_id IS NULL)
    OR operating_location_id = (SELECT public.current_operating_location_id())
  );

DROP POLICY IF EXISTS tenant_select_journal_entries ON public.journal_entries;
CREATE POLICY tenant_select_journal_entries
  ON public.journal_entries
  FOR SELECT
  USING (
    company_id = (SELECT public.current_company_id())
    AND (SELECT public.has_module_permission(public.current_company_id(), 'accounting', 'view'))
  );
