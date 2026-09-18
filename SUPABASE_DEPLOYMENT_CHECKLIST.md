# NAVILO — Supabase Release Safety Checklist

> Release status: **NOT APPROVED**. This checklist is a verification procedure, not permission to run migrations, reset data, merge `main`, or deploy production.

## Scope and release rules

- GitHub development branch: `work/navilo-unified-release-audit-20260918`; production reference: `main`.
- Supabase project: `ijdaosaqpbgnqojudjbj`. Treat this as a live database: perform read-only discovery first, preserve all existing records and company/business-unit/branch isolation, and never run historical migrations again merely because they appear in this document.
- Do not merge into `main` or deploy `https://navilo.vercel.app` until build, automated tests, database safety, backup **and restore verification**, and A-to-Z user acceptance testing (UAT) all pass. Record evidence and approvals for each gate.

## 1. Compare migrations before any change

The previous MetalForge checklist listed only 15 September 2 migrations and asserted an expected count of 15. That is obsolete. A read-only check on September 18, 2026 found **428** recorded migrations and latest version `20260917122115`. These are a dated observation, **not** an invariant or a command to replay migrations.

Run the following read-only queries against the intended project and compare the complete output with migration files on the exact development commit. Investigate missing, divergent, or out-of-order migrations; do not infer safety from the latest version alone.

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;

select count(*) as migration_count, max(version) as latest_version
from supabase_migrations.schema_migrations;
```

Before proposing any DDL, inspect the relevant migration and current live schema, review dependencies and tenant-scoped RLS, and prepare a reviewed forward-only migration with a rollback/recovery plan. Never apply a migration to production solely to make its history match the repository.

## 2. Database security and functional checks

Run read-only inspections of table RLS **and policies**, view security (`security_invoker`), RPC execution grants and `SECURITY DEFINER` authorization, triggers, indexes, and tenant isolation. RLS enabled by itself does **not** prove that a policy correctly separates tenants. Test normal users, cross-company access, business units/branches, and Platform Owner-only operations with isolated test identities; do not use real customer data as a test fixture.

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

Inspect Supabase Security and Performance Advisors, triage each finding, and record accepted risks. Do not blindly revoke function grants, change RLS, or add/drop indexes without checking callers and query plans. Verify accounting posting, tax, receipts, stock movements, reporting, permissions, and backup/restore behavior after relevant changes.

## 3. Release gates — all required

- [ ] Exact development commit and complete migration diff reviewed; production data and tenant isolation preserved.
- [ ] `npm ci`, `npm run check` (typecheck, automated tests, build), and relevant integration/security tests pass on that commit.
- [ ] Database migrations reviewed, safely tested on a separate environment, and checked against live migration history; security/performance findings triaged.
- [ ] A recoverable backup exists and an actual restore has been verified in a separate environment, including data integrity and access controls.
- [ ] A-to-Z UAT passes for accounting, sales/purchase, inventory, reports, permissions, Platform Owner controls, selected-language behavior, print/export, and backup/restore.
- [ ] Release evidence and explicit go-live approval recorded before one controlled merge/deployment; verify deployed commit and production smoke tests afterward.

**Do not mark a gate complete based only on HTTP 200, a successful SQL connection, enabled RLS, or a green build.**
