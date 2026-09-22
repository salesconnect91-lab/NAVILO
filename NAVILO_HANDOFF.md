# NAVILO audit handoff — 2026-09-22

## Phase 2B continuation — 2026-09-22

Starting remote development commit `40ae959fd3a8c056b7c8295ed0a37d7ff97ca212` was verified via connected GitHub. This local checkout still points to `eee4f41…` but has the Phase 2A files as working-tree contents identical to the remote commit; preserve them in the next remote tree rather than restarting investigation. Phase 2B added [test plan and results](docs/NAVILO_PHASE2B_TEST_PLAN_AND_RESULTS.md) and a production-ref-denying synthetic test harness `scripts/phase2b_negative_tests.mjs`. No isolated project was created because the project connector requires user-selected organization and quoted-cost confirmation. Organization `mjjubagcqiqqoqujscba` has one free-plan production project; separate project quoted $0/month, branch $0.01344/hour. No local Docker, psql, postgres, initdb or Supabase CLI. No production SQL or deployment action.

Actually run: `node --check` PASS; no-ref and explicit production-ref invocation both exited 1 with the expected refusal before network; 2 migration-checker unit tests PASS; `npm run check` exit 0 with 19 files/81 tests and build, large JS chunk warning. Migration checker on existing repository remains expected FAIL (9 duplicate version IDs, 3 empty files). **No migration replay or authenticated security test was run.** No synthetic users/data were created, no passwords/keys written. To resume, obtain user decision on the separate free test project and its organization/cost, create it, then use secure Auth provisioning and synthetic fixtures described in Phase 2B plan. Never run the harness against production or put credentials in chat/repo. Resolve final remote Phase 2B SHA from the development branch after this update.

## Phase 2A continuation — 2026-09-22

Starting remote audit SHA `eee4f41ee40a9be1c757e7fe7596450eabe2c3b3` confirmed on `work/dashboard-en-ur-20260921`; remote main SHA `a7879524ab0f2bb404e640edd784a9a9b545b1e0` confirmed by `git ls-remote`. This continuation wrote only reports, a full migration matrix, a per-function RPC matrix and a read-only local migration filename checker; no production SQL, main merge or deployment.

Read [migration reconciliation](docs/NAVILO_PHASE2A_MIGRATION_RECONCILIATION.md), [692-row matrix](docs/NAVILO_PHASE2A_MIGRATION_MATRIX.csv), [103-function matrix](docs/NAVILO_PHASE2A_RPC_MATRIX.md) and [security review](docs/NAVILO_PHASE2A_SECURITY_REVIEW.md) before implementation. Live history: 430 versions; repository 262 SQL files / 253 unique versions; exact version overlap 76; repo-only version occurrences 186, live-only 354. Twenty-four repository filenames and 194 live history names have no exact name counterpart. Nine repo version collisions and three empty SQL files are confirmed. One-statement unique-name comparisons: 140 normalized text matches, 61 mismatches; current effective schema parity needs isolated validation. Live 103 direct authenticated grants, zero anonymous/PUBLIC, 37/37 invoker views and 150/150 RLS-enabled public tables. No critical exploitable RPC bug confirmed, no authenticated negative calls run.

Verification: `npm run check` exited 0 (typecheck, 19 test files/81 tests, build with 3150.13 kB primary JS warning). `python3 scripts/check_migration_versions.py` exited **1 as intended**, reporting 3 empty files and 9 duplicated version IDs; it is a proposal, not yet a CI gate. For cross-tenant tests, provision the isolated fixtures specified in the security review; do not use real customer data. First resolve migration-file identity in an isolated rehearsal, then execute role/tenant/BU/branch negative tests and trace nested privileged helpers. Final Phase 2A documentation commit SHA is the remote development branch head after this report update; resolve with `git ls-remote origin refs/heads/work/dashboard-en-ur-20260921`.

## Exact identity and mutations

- Repository: `salesconnect91-lab/NAVILO` (GitHub connector confirmed, push permission present).
- Checkout: `work/dashboard-en-ur-20260921`, initial SHA `2f4549737d0258d7d7e2daf596353d775cd7b43b`.
- Vercel metadata: latest production-target READY deployment `dpl_CaV1LJUbF76WDQBxbyUuyW5dw7uC` from `main` `a7879524ab0f2bb404e640edd784a9a9b545b1e0`; later READY preview `dpl_GN4FZyLzc7TRvA4vttYMMpgqBG7q` from development SHA `2f45497…`. Exact production domain alias not independently checked.
- Supabase project `ijdaosaqpbgnqojudjbj` ACTIVE_HEALTHY at inspection. Live latest migration entry `20260921204530`; local latest migration file `20260919230000_scope_language_entitlements_to_pakistan_en_ur.sql`. Migration sets not reconciled.
- This audit created only `NAVILO_AUDIT.md`, `NAVILO_ISSUES.md`, `NAVILO_HANDOFF.md` on development branch. No source fix, SQL change, merge or production deployment. Record final audit commit SHA below if committed.

## Actions and actual outputs

`npm ci --ignore-scripts --no-audit --no-fund`: exit 0, 330 packages. `npm run check`: exit 0; typecheck passed, 19 files/81 tests passed, Vite build passed (3005 modules); primary JS bundle 3150.13 kB/882.09 kB gzip and chunk-size warning. This is local branch validation only. Browser visited `https://navilo.vercel.app` and rendered login fields; authenticated screens were not visited. Live SQL read-only: 150 public tables, 0 without RLS, 37 views, 103 authenticated-executable public SECURITY DEFINER routines, 0 anonymous; 430 migration rows; 2 companies, 2 BUs, 1 membership, 3 sales orders, 22 journal entries, 2104 audit logs. Advisor flags 103 privileged routines. No backup, restore, tenant-negative or AMK end-to-end test executed.

## Coverage and blockers

Inventory covers top-level routes/modules and selected supporting files. The audit has **not** read every component, 262 migration bodies, 37 view definitions or 103 RPC bodies, nor verified every workflow. Therefore A-to-Z completion is **not claimed**. Read-only browser is blocked at login for authenticated views; no credentials were supplied. Current GitHub `main` head and exact alias binding remain to be fetched. Production data boundaries were sampled only as aggregate counts.

## Safe resume order

1. Refresh GitHub branch/main heads, deployed production alias and migration version lists; compare definitions before editing.
2. Review all 103 privileged functions, 37 views, RLS/grants, storage policies and company/BU/branch negative cases, using isolated accounts; triage actionable findings.
3. Inspect actual authenticated desktop/laptop/tablet/mobile screens and documents; finish module-by-module code/RPC/report inventory.
4. Define industry-specific MVP and applicable tax scope with official FBR/provincial sources and expert review.
5. Prove safe encrypted backup and isolated restore; rehearse migrations outside production.
6. Present audit closure and implementation proposal for owner's approval. Then implement on development branch with tests. Only after gates pass consider main merge and production deployment, both outside this audit authorization.

## Owner manual actions

For full visual and live AMK UAT, arrange a normal non-owner AMK test account via secure sign-in flow; do not paste a password into this document. Supply access/evidence to Windows backup host, USB and Google Drive capacity if backup/restore is to be verified. Confirm supported initial customer sectors and obtain qualified Pakistan tax review before claiming compliance. These actions are needed to close gates, not to read the current reports.

## Audit commit

The audit commit is the newest commit that adds these three files on `work/dashboard-en-ur-20260921`. Resolve its exact SHA with `git log -1 --format=%H` before resuming; this document deliberately does not claim a self-referential commit SHA.
