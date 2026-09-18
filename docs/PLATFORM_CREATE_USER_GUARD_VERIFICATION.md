# Platform Owner create_user guard verification

The development-only workflow `.github/workflows/apply-platform-create-user-guards.yml` runs the exact-match script `scripts/patch-platform-create-user-guards.py` and commits the resulting change only to `work/navilo-unified-release-audit-20260918`. Verify the resulting commit and Build workflow before treating this patch as applied.

Expected guard: reject missing company, company lookup errors, membership count errors, null counts, invalid max_users, and full company limits **before** `admin.auth.admin.createUser`. Preserve existing membership and profile writes and rollback logic.

Remaining risks: two simultaneous create_user requests can both pass a non-atomic count; enforce the quota atomically in the database or serialized provisioning before commercial release. Check errors on business-unit and branch lookups separately; review onboarding rollback, user-role validation and tenant isolation. No live DB, production deployment, or end-to-end UAT is implied by a green frontend Build workflow.
