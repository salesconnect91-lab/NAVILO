-- Synced from verified production migration 20261006213147 (allow_transport_mobile_membership_role).
alter table public.company_memberships
  drop constraint if exists company_memberships_role_check;

alter table public.company_memberships
  add constraint company_memberships_role_check
  check (role = any (array[
    'company_owner'::text,
    'admin'::text,
    'accounts'::text,
    'sales'::text,
    'purchase'::text,
    'store'::text,
    'production'::text,
    'transport'::text,
    'transport_mobile'::text,
    'viewer'::text
  ]));
