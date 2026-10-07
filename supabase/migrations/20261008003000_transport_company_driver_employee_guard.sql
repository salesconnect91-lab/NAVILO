-- Company Driver integrity is enforced by the canonical Master save UI and operational Trip assignment RPCs.
-- Keep legacy/unclassified Driver rows replayable; do not rewrite historical evidence.
alter table public.transport_drivers
  drop constraint if exists transport_company_driver_employee_check;

comment on column public.transport_drivers.employee_id is
  'Company Driver employee link. Required by current Transport Master/operational assignment flows; legacy rows may remain unlinked.';
