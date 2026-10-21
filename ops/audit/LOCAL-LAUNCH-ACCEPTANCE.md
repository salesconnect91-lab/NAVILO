# NAVILO — isolated launch acceptance

**No production database calls or writes.** This launcher refuses anything except local Supabase API `localhost:54321` and local database `localhost:54322/postgres`. It uses the database URL from your *local* `supabase status`; credentials are never logged or checked into Git.

Run from an **isolated local clone**, with Docker, Supabase CLI and PostgreSQL 17 `psql` installed, and local migrations applied:

```bash
npx supabase start
npm run test:launch-local
node scripts/phase2b_local_security_tests.mjs
```

The first command starts local Supabase; the second runs existing rollback SQL rehearsals for company onboarding, sales/purchase VAT posting, purchase-return accounting, journal authorization, transport bulk settlement and transport reporting. The third tests 2 synthetic companies and 8 identities, including forbidden cross-company reads and writes. All data is synthetic/local. Fix any failed test before launch.

Successful local tests do **not** prove production browser UI, actual two-user isolation on hosted Supabase, full company accounting reconciliation, daily PC backup, restore verification, or load capacity. Maintain the separate launch checklist and record each step's evidence.
