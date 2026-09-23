# NAVILO audit handoff — 2026-09-22

## Latest stop point — Windows replay MIG-12, 2026-09-23

Replay passed all fixes through `20260913072000` and failed at `20260913072054` because the repository lacked `stock_movements.approval_slip_path`. Read-only production evidence traced a four-migration controlled stock chain (`20260906225648`, `20260906230719`, `20260907074107`, `20260907074902`), including approval buckets/RPCs, cross-warehouse transfer and `transfer_no`. Exact live SQL was restored to development and protected by regression snippets. This was not a guessed one-column patch. Production, `main`, Vercel and hosted data remain unchanged. Full replay remains pending.

Verification after restoration: SQL sanity 0 findings; 20 migration-checker tests PASS; migration versions 0 duplicate IDs/0 empty files; strict dependency/object-order checks PASS; typecheck PASS; 19 test files/81 tests PASS; Vite build PASS with the existing large-bundle warning. Windows fresh replay remains the acceptance gate.

## Latest stop point — Windows replay MIG-11, 2026-09-23

Windows replay passed the repaired delimiter and terminator migrations and reached `20260908174200_enforce_sales_post_business_unit_scope.sql`. It failed because the prior reconciled migration had already restored `post_sales_invoice_core(uuid)`, while this migration unconditionally tried to rename the public function to the same name. The development repair conditionally renames only if core is absent and replaces the public wrapper safely. The only other function-rename case is already guarded. Full replay remains pending; production, `main`, Vercel and hosted data are unchanged.

Verification after the replay-safe wrapper repair: SQL sanity 0 findings; 19 migration-checker tests PASS; version/dependency/object-order checks PASS; typecheck PASS; 19 test files/81 tests PASS; Vite build PASS with the known bundle warning. Windows fresh replay remains the next gate.

## Latest stop point — Windows replay MIG-10, 2026-09-23

The replay after the discount-delimiter repair advanced to the restored `post_sales_invoice_core(uuid)` migration, then stopped at the following `revoke` because the `$function$` closing tag lacked `;`. Batch scan found and repaired this file plus the later restored return-note function with the same defect. A regression check is included. Full replay is not yet PASS. Production, `main`, Vercel and hosted data remain unchanged.

Verification after both terminator repairs: SQL sanity 0 findings; 18 migration-checker tests PASS; version/dependency/object-order checks PASS; typecheck PASS; 19 test files/81 tests PASS; Vite build PASS with the existing large-bundle warning. Windows fresh replay remains the next acceptance step.

## Latest stop point — Windows replay MIG-09, 2026-09-23

After pulling `577e1f7b8e41e359a1a83b19451f395615ba0fc8`, Windows fresh replay successfully passed the previously repaired print-language migration and advanced through `20260906225113`. It then failed in `20260906232419_commercial_invoice_discounts_accounting.sql` because `discount_amount_for()` used invalid `AS $` / `$;` delimiters. The next development commit corrects them to `$$`, adds a repository-wide sanity rule and records the result. Production, `main`, Vercel and hosted data remain unchanged. Pull the new SHA and rerun only after the pushed verification summary is reviewed.

Verification after repair: repository-wide malformed-delimiter scan 0 findings; SQL sanity 0 findings; 17 migration-checker tests PASS; migration versions 0 duplicate IDs/0 empty files; strict dependency/object-order checks PASS; typecheck PASS; 19 test files/81 tests PASS; build PASS with the existing 3,150.13 kB minified/882.09 kB gzip warning. Full Docker replay is still not PASS until Windows completes it.

## Latest stop point — Windows replay MIG-08, 2026-09-23

Windows pulled exact development SHA `08e53252043e77cedae6e0fd670702b72265807e`. Fresh `npx supabase start --debug` applied migrations through `20260904151609`, then `20260904165202_restore_print_language_foundation.sql` failed with SQLSTATE 42601 because line 11 began `+create`. The next development commit removes that one accidental marker and adds a general SQL-sanity regression test. Full replay remains unverified; pull the new SHA and rerun local start. No production database, `main`, Vercel deployment or hosted customer data was changed.

Repair verification in the executor: SQL sanity 0 findings; migration filenames 0 empty/0 duplicate IDs; strict dependency 13/13 ordered with 0 unresolved; explicit object-order 0 findings; 16 migration-checker unit tests PASS; `npm run check` PASS with typecheck, 19 test files/81 tests and build. Build retains the known 3,150.13 kB minified/882.09 kB gzip chunk warning. No Docker/Supabase replay ran in the executor, so Windows fresh replay remains the next gate.

## Latest stop point — reconciled after Windows/VS Code continuation

Development reconciliation commit: `72af57202a0acca9ad57685295fc90607b4dfffc`
(`work/dashboard-en-ur-20260921`). This commit contains the migration/object-
order closure and verified report updates described below.

The user's continuation was verified before further edits. Development moved
from `fac95ed2772c10df3ee795f78c04cb50b25f7323` to
`14b3f5e48da4e7a1e43df636ffa9ad941b1eeb4d` through 120 commits. A clean
worktree at that head was used; all user changes were preserved. Production,
Toqeer Builder, `main` and Vercel were not changed.

At `14b3f5e…`, filename and SQL-sanity checks passed, but strict dependency
checking still reported Charge Master out of order, and a new full explicit
object-order scan reported 33 findings. Two apparent `accounts` findings were
false positives because both statements are inside guarded `to_regclass()`
blocks and fresh installations intentionally omit that legacy compatibility
table. The remaining findings were reconciled with exact read-only live
migration/function provenance plus one pre-tenant sales-consolidation provider.

Files prepared on top of the latest branch: 17 migration files, exact Urdu
backfill creator in the existing print-language migration,
`scripts/check_migration_object_order.py`, its tests, and updated dependency
checks/reports. Current executed evidence:

- migration versions: PASS, 0 duplicate IDs / 0 empty files;
- strict dependency manifest: PASS, 13/13 ordered / 0 unresolved;
- SQL sanity: PASS, 0 findings;
- explicit object order: PASS, 0 findings;
- migration checker tests: PASS, 15/15;
- `npm run check`: PASS, typecheck + 19 files/81 tests + build;
- bundle warning remains 3,150.13 kB minified / 882.09 kB gzip;
- local full reset: NOT RUN in this executor;
- authenticated cross-tenant/RPC tests: NOT RUN / blocked by reset.

Safe resume after this checkpoint is committed: on Windows use only the clean
Git clone `C:\NAVILO-latest`, pull the exact development commit, confirm a clean
`git status`, then run one unlinked `npx supabase db reset --debug`. Do not use
`C:\NAVILO-work-dashboard-en-ur-20260921`, do not link to a hosted project, and
do not edit production migration history. Preserve the complete output. The
final commit SHA is recorded in the response after the branch update.

## Latest stop point — batch reconciliation required

At development commit `20b9e313487b733ff6b99dcd16c52efd7bd99d5d`, Windows fresh replay applied 0001–0025 and entered 0026, then failed because ACL statements referenced `apply_stock_movement` before its 0027 creator. 0027 already creates and secures the function, so the next commit removes only the premature redundant ACL and adds regression coverage. A full static function-order pass found 77 candidates and the dependency audit still has nine missing table foundations. Do not ask the Windows operator to repeat one-error-at-a-time indefinitely; reconcile the remaining candidates/live-only migrations in a batch, then request one clean replay. Production/main remain unchanged.

## Latest continuation — migration dependency audit, 2026-09-23

Started from development commit `70ccb704fb67fc38d5d6956107cea3a1f0268b61`. The Windows host had already proved a fresh local start fails at migration 0007 because `public.godowns` is absent. This continuation traced the gap across all Git refs and read-only live history, repaired the evidenced early master baseline in migration 0002, reconciled the nine duplicate version groups to their live versions, removed three empty superseded placeholders, and added dependency/filename regression checks. Read [the dependency audit](docs/NAVILO_PHASE2B_MIGRATION_DEPENDENCY_AUDIT.md) before continuing.

Clean replay is **not PASS**. This executor has no Docker/Supabase CLI runtime, and the strict static audit still finds nine referenced foundations absent. Recover and review the original live DDL before further schema patches; do not guess tables, remove constraints, or edit production migration history. Production was queried only read-only for schema/history provenance; no customer rows were copied. NAVILO production, Toqeer Builder, `main` and Vercel were unchanged. Authenticated negative tests remain blocked until local bootstrap completes.

After pulling the final development commit, the Windows diagnostic is `npx supabase db reset --debug`; preserve the first failure. Exact commands/results and final SHA are in the final response.

Verification in this checkout: `python3 scripts/check_migration_versions.py` PASS (0 empty, 0 duplicate IDs); normal dependency audit PASS (0 repaired-contract errors, 9 explicitly known unresolved foundations); strict dependency gate exit 1 as expected for those 9 blockers; five Python checker tests PASS; `git diff --check` PASS. The first `npm run check` attempt could not find `tsc` because dependencies were absent. After `npm ci --ignore-scripts --no-audit --no-fund` installed 330 packages, `npm run check` PASS: typecheck, 19 test files / 81 tests, and Vite build. Build retains the 3,150.13 kB minified / 882.09 kB gzip primary-chunk warning. No Supabase replay was executed here.

Windows then ran `npx supabase start --debug` from an unlinked fresh clone at commit `81e640784d6a1f17e3697c0b3bd6ac43a502b2ee`. Migrations 0001 and repaired 0002 applied; 0003 failed at statement 3 with SQLSTATE 42601 on `DO PKRPKR BEGIN`. Git history and read-only live history confirmed the token. The next development commit restores both blocks to `DO $$ ... END $$;` and adds a two-test SQL corruption guard. No hosted mutation occurred. Pull that commit and rerun local start; do not claim replay PASS until the full chain finishes.

At commit `94f014ce6c1c57914312465c8fff1dacb4e0aeda`, Windows replay applied 0001 through 0004 and then 0005 failed with SQLSTATE 42703 on `journal_entries.payment_mode` inside `sales_invoice_financials`. Read-only production catalog, frontend types and later posting SQL confirmed omitted pre-history columns on `journal_entries`, `journal_lines` and `sales_orders`. The following development commit restores those exact fields in 0004 and extends the SQL sanity contract. Production remained read-only/unchanged.

At commit `dea6514619bb18ec17ae121b92ab3d56ecf5f89d`, Windows replay applied 0001 through 0024, then 0025 failed with SQLSTATE 42703 because it creates `items_warehouse_id_fkey` before any local creator for `items.warehouse_id`. Read-only live catalog confirmed the nullable UUID and `ON DELETE RESTRICT` FK. The following development commit adds only the missing column to 0002 and preserves 0025 as the constraint migration.

At commit `de2b227f78d1f92a431d518585ac7ba06b939c41`, Windows replay applied 0001 through 0025, then 0026 failed because `warehouse_stock.warehouse_id` was absent; the same migration also requires `godown_id` and both fields on `stock_movements`. Read-only live catalog confirmed all four columns and restrictive FKs. The following development commit restores the complete stock-location foundation in 0002; production remains unchanged.

## Latest continuation: local isolation feasibility — 2026-09-22

Started from clean development SHA `016bda83d84748c8aaf1d6311843c2ff0c08bec3`. User verified Toqeer Builder's separate organization has existing Free project `salesconnect91-lab’s Project` (`ap-southeast-2`, 27 MB database, 1 MAU); neither it nor NAVILO production may be paused, deleted, reset or used for tests. No paid resources. This continuation only updates reports; no cloud SQL, project operations, source fix, migration apply, main merge or deployment.

See [local feasibility and safe sequence](docs/NAVILO_PHASE2B_LOCAL_ISOLATION_FEASIBILITY.md). Tool check here: node/npm/python3 present, docker/podman/supabase/psql/postgres/initdb absent; Windows host not inspected. Executed `python3 -m unittest discover -s scripts -p 'test_check_migration_versions.py' -v`: **2 PASS**; `python3 scripts/check_migration_versions.py`: **exit 1, expected defects (9 duplicates, 3 empty files)**; `node --check scripts/phase2b_negative_tests.mjs`: **PASS syntax only**. No `npm run check` rerun here. No local database/Auth exists in this executor, so migration rehearsal, synthetic identities and cross-company/BU/branch/RPC results remain **BLOCKED**. Current harness rejects localhost; adapt its production guards before executing locally. Initial manual Windows action: PowerShell `wsl --status`, share output without secrets; then assess Docker Desktop/WSL and CLI prerequisites. Continue from the new development SHA, verify exact branch head, and never link local CLI to hosted project. The SHA of this documentation commit is determined after commit.

## Quota-scope investigation and stop point — 2026-09-22

Starting development commit `5155ca33d2939e0a6e92294c41118c38d603165b`. User verified NAVILO's organization has only one project and Toqeer Builder is a separate organization; user forbade pausing/deleting projects and requires explicit cost/isolation information and renewed approval before considering Toqeer organization. Connected Supabase `list_organizations` returned only `mjjubagcqiqqoqujscba` and `list_projects` only NAVILO `ijdaosaqpbgnqojudjbj`. Official [billing guide](https://supabase.com/docs/guides/platform/billing-on-supabase) states two active free projects are counted across **all organizations where the member is Owner/Admin**; [FAQ](https://supabase.com/docs/guides/platform/billing-faq) notes another Owner/Admin member's exhausted quota can also block creation. Prior create error specifically named `salesconnect91-lab` as exhausted. Toqeer's exact ID, owner role, plan, project count, cost quote and accessibility through this connector remain **unverified**. Its project may account for the second slot; do not claim confirmation.

No Toqeer get_cost/create call, project pause/delete, SQL, user/data fixture, replay, test, build, main change or deployment in this continuation. Phase 2B remains BLOCKED. Next: gain read-only connected visibility of Toqeer's exact organization and role/project/plan (or user-provided nonsecret org ID and dashboard evidence), check member quota, quote cost there, explain separate project database/Auth/Storage versus shared organization administrators and billing, then ask for **new specific approval** before creating anything. Under the same exhausted Owner/Admin account, merely changing organization will not free a slot. No paid resource approved. Commit SHA is the development branch head after this documentation update.

## Latest continuation: approved free-project provisioning rejected — 2026-09-22

Starting **remote** development commit: `3ffd3aa1d547190870eea1425813d4d78982a663`. The user authorized only `NAVILO-ISOLATED-UAT` in Supabase organization `mjjubagcqiqqoqujscba`, region `ap-southeast-1`, at $0/month; explicitly disallowed the $0.01344/hour branch and all other paid resources. Live `get_cost(project)` again returned `{"type":"project","recurrence":"monthly","amount":0}`. `confirm_cost` succeeded. `create_project` returned `BadRequestException`: member `salesconnect91-lab` has reached the maximum **two active free projects within organizations it owns/administers** and must pause, delete or upgrade one. This response did not create an isolated ref. The previously listed NAVILO organization showed only production, so do not assume the other slot belongs to that organization.

No isolated Auth users, synthetic data, replay, JWT calls or RPC probes were created/run; these remain BLOCKED. No production database SQL, main merge, live deployment, project pause/delete or paid branch occurred. This continuation changed only these documentation files on the development branch. No typecheck, tests or build rerun; prior 19 files/81 tests, migration checker 9 duplicate IDs/3 empty SQL files, and local script preflight results are historical, not new test results.

**Next necessary user action:** free one slot by pausing or deleting a *different disposable* free project owned/administered by `salesconnect91-lab`, without touching NAVILO production; alternatively connect a separately eligible free organization/project and authorize its use. Do not choose an upgrade/paid branch under current authorization. Once the slot is available, re-quote $0/month before retrying creation, obtain isolated project ref, rehearse repository migrations and synthetic authenticated negative tests, then rerun `npm run check` and commit evidence. No passwords or secrets in chat/repository. The SHA for this documentation continuation is the development branch head after the commit, not self-referential text in this file.

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

## Phase 2B Windows replay checkpoint — stock source context (2026-09-23)

- User replayed exact remote development SHA `86b452b274d89ffea21d756b9f202b09607a0c35` on a fresh local Supabase stack.
- The restored approval-slip/transfer chain applied. Replay reached `20260913072054_correct_stock_approval_scope_and_validate_evidence.sql`, then failed with `42703: column sm.source_type does not exist`.
- Read-only production queries confirmed `stock_movements.source_type text` and `source_id uuid`, both nullable, and traced their exact provider to live migration `20260906223502_control_manual_inventory_adjustments`.
- Restored that exact historical migration on development, including its related `reason`, `remarks`, `unit_cost`, `source_type`, `source_id` columns and controlled adjustment RPC. Added a regression contract for the whole foundation, not just the observed column.
- Verification actually run after the repair: SQL sanity `0` findings; migration versions `0` empty/`0` duplicate IDs; strict dependency `0` errors; explicit object-order `0` errors; migration checker unit suite `19/19` PASS; `npm run check` PASS (typecheck, 19 test files/81 tests, Vite build). Existing primary bundle warning remains: 3,150.13 kB minified / 882.09 kB gzip.
- Production/main/Vercel/Toqeer Builder remained unchanged. Full replay remains **NOT PASS** until the user pulls the resulting commit and a genuinely fresh `npx supabase start --debug` finishes.

## Phase 2B Windows replay checkpoint — branch migration order (2026-09-23)

- Replay at remote SHA `0622440bdbc63a1e2131844b03d9e123235e37b7` applied the restored stock source migration and advanced through `20260913080500`.
- It failed in `20260913082000_index_branch_scoped_foreign_keys.sql` with `42703: consolidated_purchase_invoice_charges.operating_location_id does not exist`.
- Read-only live history proved exact versions `20260913073121` (complete branch isolation v2), `20260913073519` (global operating-location write scope), and `20260913081611` (branch FK indexes). Local SQL bodies matched live MD5 values after removing the single trailing newline; only filenames/order were wrong.
- Development now uses those exact live identities and rejects the three disproved filenames. Static gates: 0 empty, 0 duplicate, 0 misversioned, 0 SQL-sanity findings, 0 strict-dependency errors, 0 explicit object-order errors; 22 migration-checker unit tests PASS.
- Full application gate rerun after reconciliation: `npm run check` PASS — TypeScript typecheck, 19 test files/81 tests, and Vite build. Known primary bundle warning remains 3,150.13 kB minified / 882.09 kB gzip.
- No production/main/Vercel/Toqeer mutation occurred. Fresh Windows replay is still required; authenticated synthetic tenant/BU/branch/RPC tests remain pending.

## Phase 2B Windows replay checkpoint — sales-core idempotency (2026-09-23)

- Replay at remote SHA `1f0a957a8b0eaff573b37468e3f80e4e02b77a47` proved the branch-column provider, write-scope and index migrations execute in correct order and advanced through `20260914212031`.
- It failed at `20260914225847_restore_sales_post_tenant_user_resolution.sql` with `P0001: post_sales_invoice_core patch pattern did not match`.
- The earlier restored core is already in the intended secure final state. Development now no-ops only when company/BU scoping, invoice-row owner resolution and missing-owner rejection are all present; unknown definitions still fail instead of being silently accepted.
- Static gates: 0 empty, duplicate or misversioned files; 0 SQL-sanity, strict-dependency or object-order findings; 23 migration-checker tests PASS. Full application gate and fresh PostgreSQL replay remain required after this change.
- Full application gate rerun: `npm run check` PASS — TypeScript, 19 test files/81 tests and Vite build. Known primary bundle warning remains 3,150.13 kB minified / 882.09 kB gzip.
- Production/main/Vercel/Toqeer remain unchanged. After the next fresh replay, continue to synthetic authenticated company/BU/branch/RPC negative tests before UI redesign implementation.

## Phase 2B clean replay passed; authenticated local tests next — 2026-09-23

- Windows repository: `C:\NAVILO-latest`; branch `work/dashboard-en-ur-20260921`; tested SHA `f6b3f4da1f7e29528e1ca9b4fca086e22e285f92`.
- Actual command: `npx supabase start --debug` on a fresh local volume. It applied the complete chain from `20260821163309` through `20260921204530`, started containers and passed REST/Edge Function health checks. Migration replay is now PASS, not pending.
- Non-blocking warnings: no optional `supabase/seed.sql`; Windows Analytics requires Docker TCP exposure. Neither affected database migration completion. Do not enable insecure Docker TCP merely for Phase 2B authorization tests.
- No synthetic fixtures or authenticated negative calls ran yet. Local endpoint/key values printed by the CLI are development defaults and were not copied into source or reports.
- Added `scripts/phase2b_local_security_tests.mjs`. It accepts only `localhost:54321`, explicitly refuses the production ref, reads local status internally, creates six short-lived synthetic Auth identities with in-memory passwords, provisions 2 companies with 2 BUs and 2 branches each, and exercises positive controls plus foreign-company/customer, unassigned BU/branch, forged owner-only assignment, viewer, revoked-role and anonymous cases. Its output excludes credentials and emails.
- Verification for this continuation: local runner syntax PASS; migration filename/SQL-sanity/strict-dependency/object-order checks all 0 findings; 23 migration-checker unit tests PASS; `npm run check` PASS (TypeScript, 19 test files/81 tests, Vite build). Known main-bundle warning remains 3,150.13 kB minified / 882.09 kB gzip. The actual authenticated test run is still PENDING and must not be reported as PASS until its JSON summary is captured.
- Production Supabase, Toqeer Builder, `main` and Vercel production remain unchanged.

## Phase 2B first authenticated-run attempt — profile insert repair (2026-09-23)

- User pulled exact SHA `885e2cee36cdb838ed7ac6c07ec5da83a6577149` and executed the local-only runner against the already-running clean local stack.
- Local guard/status and Auth Admin creation succeeded. The runner created six synthetic local Auth identities, then stopped on the first `user_profiles` insert with HTTP 400; it did not reach companies, BUs, branches or negative authorization calls.
- Root cause is exact schema inheritance: migration `0005` created required `user_profiles.user_id`; later `create table if not exists` did not remove it. The fixture omitted that column. Development now sets `user_id` equal to the same Auth UUID as `id` for owner and all tenant profiles.
- The Windows `shell:true` invocation was replaced with direct `npx.cmd` execution, removing the Node DEP0190 warning. Future HTTP failures include only sanitized database code/message; secrets and emails remain excluded.
- Existing orphan synthetic users are confined to the disposable local Auth database. A new run uses unique synthetic emails, so no manual cleanup or local reset is required before rerunning.
- Actual authorization matrix remains PENDING. Production/main/Vercel/Toqeer remain unchanged.

## Phase 2B second runner attempt — Windows CLI launcher repair (2026-09-23)

- User pulled exact SHA `ee1f8623aa458bdb980b7cbf02d96f7e91fcb317`. The runner stopped in `readLocalStatus()` before creating any new fixture or running any authorization assertion.
- The preceding local stack had completed successfully and the failure followed the change from `shell:true` to direct `npx.cmd`; this is a Windows Node process-launch compatibility issue, not database evidence.
- Development now uses the Windows command interpreter from `ComSpec` with a fixed `npx supabase status -o env` command and `shell:false`. No user-controlled argument is concatenated. Non-Windows remains direct `npx`.
- Diagnostics now distinguish a launch error, the CLI's exact stopped-stack marker, and other nonzero status without printing local keys or raw stderr.
- Actual authenticated matrix remains PENDING. Production/main/Vercel/Toqeer remain unchanged.

## Phase 2B third runner attempt — default-BU trigger reconciliation (2026-09-23)

- User pulled exact SHA `029437349f5c24dbb78e7c6a7a1622d41f53b85c`. Local CLI discovery, Auth user/profile creation, companies, default/second BUs and company memberships progressed successfully.
- Provisioning stopped before assertions with HTTP 409 / SQLSTATE `23505` on `business_unit_memberships_business_unit_id_user_id_key`.
- Exact cause: `trg_sync_default_business_unit_membership` runs after each company-membership insert and already upserts the default-BU membership. The fixture then tried to insert the identical unique pair.
- Development now upserts on `(business_unit_id,user_id)`, matching the database trigger's conflict target and explicitly preserving the intended role/active state.
- Partial fixtures from failed attempts remain synthetic and local only. Each rerun uses new identities/company codes, so reset is unnecessary. Actual authorization matrix remains PENDING; production/main/Vercel/Toqeer remain unchanged.

## Phase 2B fourth runner attempt — authenticated customer fixture context (2026-09-23)

- User pulled exact SHA `db06c7197449b708d8100d126b93fe9266bbdfed`. Provisioning passed local CLI/Auth/profile/company/BU/branch/membership/module stages.
- It stopped before assertions when a service-role customer insert invoked `tenant_stamp_company_user()` and correctly rejected the missing authenticated company context with `P0001`.
- Development does not disable the tenant trigger. The synthetic Platform Owner now signs in, selects company A/B through `set_current_company(uuid)`, and inserts each customer through authenticated REST, allowing normal RLS and tenant stamping to execute.
- Previous partial fixtures remain isolated synthetic local data; no reset is required. Actual authorization matrix remains PENDING. Production/main/Vercel/Toqeer remain unchanged.

## Phase 2B targeted local security matrix completed — 2026-09-23

- Exact tested development SHA: `f4ddc905ed11fb78d217d4cb08f16ccdc4bd932a`.
- Environment: unlinked local Supabase only; production ref explicitly refused; synthetic data only.
- Fixture: 2 companies × 2 BUs × 2 branches; owner, accounts, sales, viewer, revoked and tenant-B Auth identities.
- Result: **41 total / 41 PASS / 0 FAIL**. Own-company/report and owner positive controls passed. Foreign company/customer rows, forged company/module access, unassigned same-company BU/branch, owner-only forged assignment, viewer post, revoked access and anonymous helper cases all matched expected denial/zero/false outcomes.
- Persistent sanitized evidence: `docs/NAVILO_PHASE2B_LOCAL_SECURITY_RESULTS.md`. Windows also has `C:\NAVILO-latest\phase2b-local-security-results.json`; it contains no credentials or row IDs.
- Migration replay was already PASS through `20260921204530`. Static gates remain 0 empty/duplicate/misversioned/SQL/dependency/order findings; 23 migration-checker tests, TypeScript, 19 files/81 application tests and Vite build passed on the same runner code before this execution. Known large bundle warning remains.
- Phase 2B targeted migration/authentication/isolation gate is complete. Residual risk: this is not dynamic execution of every 103 privileged function and not business-domain UAT for valid invoices, purchases, journals, stock, payments, returns, reversals or reset operations.
- Production database, `main`, Vercel production and Toqeer Builder remained unchanged.

## Phase 3 prepared checkpoint — 2026-09-23

- Baseline before Phase 3 work: development remote `57a0dab635f4a72452633409c3c49961b544932f`; Phase 2B result 41/41 PASS.
- Added `scripts/phase3_local_business_uat.mjs`, which reuses the Phase 2B synthetic topology and refuses every non-loopback endpoint. It tests valid and invalid purchase/sales/stock/AR/AP/journal/return/reversal/period workflows while printing sanitized evidence only.
- Made `scripts/phase2b_local_security_tests.mjs` safely importable; direct Phase 2B behavior is preserved.
- Read-only production catalog evidence exposed replay/catalog drift in three core accounting RPCs. Added `supabase/migrations/20260923180627_restore_live_core_accounting_rpcs.sql` with exact evidenced definitions and explicit ACLs. Production migration history and data were not changed.
- Added SQL-sanity regression guards and one checker test. Local code gates: 0 migration version/sanity/dependency/order findings; 24 checker tests PASS; TypeScript PASS; 19 files/81 Vitest tests PASS; Vite build PASS with existing large-bundle warning.
- **Still pending:** apply the new migration on the already-running Windows loopback stack and run the Phase 3 matrix. Do not report business UAT PASS until its JSON shows the exact totals and evidence.
- Safe resume: use only `C:\NAVILO-latest`, branch `work/dashboard-en-ur-20260921`; pull fast-forward; run the local migration command and Phase 3 runner provided with the Phase 3 checkpoint. Do not link the repo to production and do not use `db push` against any hosted project.
