-- Restrict software-owner cancellation audit visibility to platform owner only.
-- Company owners and delegated Owner Control users cannot view these privileged records.
drop policy if exists owner_posted_control_owner_read on public.owner_posted_control_events;
create policy owner_posted_control_owner_read on public.owner_posted_control_events
for select to authenticated
using (
  company_id = public.current_company_id()
  and business_unit_id = public.current_business_unit_id()
  and public.is_platform_owner()
);
