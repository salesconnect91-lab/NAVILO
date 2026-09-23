# NAVILO evidence-based audit — 2026-09-22

## Phase 2B Windows replay update — missing stock-approval foundations, 2026-09-23

The next Windows replay passed all prior repairs and advanced through `20260913072000`, then failed in `20260913072054_correct_stock_approval_scope_and_validate_evidence.sql` because `stock_movements.approval_slip_path` did not exist. Read-only production catalog confirmed `approval_slip_path text NULL` and `transfer_no text NULL`. Read-only live migration history traced the complete missing chain—not just the column—to four versions: `20260906225648` controlled godown transfer/evidence bucket, `20260906230719` approved manual adjustment, `20260907074107` cross-warehouse transfer, and `20260907074902` transfer numbering. Their exact live SQL is now restored under the original versions on development. No production write occurred.

Post-restoration gates: SQL sanity 0 findings; 20 migration-checker tests PASS; 0 duplicate IDs/0 empty files; strict dependency and explicit object-order checks PASS; typecheck PASS; 19 test files/81 tests PASS; build PASS with the known large-bundle warning.

## Phase 2B Windows replay update — sales core rename collision, 2026-09-23

After both restored-function terminators were repaired, Windows replay advanced through `20260908174000_restore_unrecorded_post_sales_invoice_core.sql` and failed at statement 0 of `20260908174200_enforce_sales_post_business_unit_scope.sql`: that migration unconditionally renamed `post_sales_invoice(uuid)` to `post_sales_invoice_core`, but the immediately preceding reconciled live-history migration had already restored the core function. The wrapper migration is now replay-safe: rename only when the core is absent, then `CREATE OR REPLACE` the public wrapper. A full-chain scan of function renames found one other rename-to-existing-name case, and it was already correctly protected by `to_regprocedure()`.

Post-repair gates: SQL sanity 0 findings; 19 migration-checker tests PASS; migration filename/dependency/object-order checks PASS; typecheck PASS; 19 test files/81 tests PASS; build PASS with the existing large-bundle warning.

## Phase 2B Windows replay update — missing function terminators, 2026-09-23

The next Windows replay reached `20260908174000_restore_unrecorded_post_sales_invoice_core.sql` and PostgreSQL stopped at the `revoke` following `post_sales_invoice_core(uuid)`. The function body closed with `$function$` but lacked the required statement semicolon. A repository-wide scan found the same defect in the later `20260909185000_restore_unrecorded_create_and_post_return_note_internal.sql`. Both exact terminators are repaired together and the sanity checker now rejects this pattern. Full replay remains unverified.

Post-repair gates: SQL sanity 0 findings; 18 migration-checker tests PASS; migration filenames, strict dependency and object-order checks PASS; typecheck PASS; 19 test files/81 tests PASS; build PASS with the known large-bundle warning.

## Phase 2B Windows replay update — discount delimiter, 2026-09-23

After the MIG-08 repair, Windows fresh replay advanced from `20260904165202` through `20260906225113` and then failed in `20260906232419_commercial_invoice_discounts_accounting.sql` with SQLSTATE 42601. `discount_amount_for()` used invalid single-dollar delimiters (`AS $` / `$;`) instead of PostgreSQL dollar quoting (`AS $$` / `$$;`). A repository-wide scan found this as the only occurrence of that exact malformed delimiter pattern. The development repair corrects both delimiters and turns the pattern into a regression failure. Full fresh replay is still required; syntax-pattern coverage is not a substitute for PostgreSQL execution.

Post-repair verification: SQL sanity 0 findings; 17 migration-checker tests PASS; 0 duplicate IDs/0 empty files; strict dependency and object-order checks PASS; `npm run check` PASS (typecheck, 19 files/81 tests, build). The known large primary bundle warning remains.

## Phase 2B Windows replay update — 2026-09-23

Fresh local Supabase startup at development SHA `08e53252043e77cedae6e0fd670702b72265807e` applied migrations through `20260904151609`, then failed in `20260904165202_restore_print_language_foundation.sql` with SQLSTATE 42601. The exact root cause was a committed diff marker (`+create`) before `backfill_company_urdu_names()`. The development-only repair removes that marker and adds a general regression check for patch markers before SQL statements. Full replay remains **not PASS** until Windows reruns the fresh local start. Production, `main`, Vercel and hosted data remain unchanged.

Post-repair local verification: SQL sanity 0 findings; migration filenames 0 empty/0 duplicate IDs; strict dependency 0 unresolved foundations; explicit object-order 0 findings; 16 migration-checker unit tests PASS; `npm run check` PASS (typecheck, 19 test files/81 tests, Vite build). The existing 3,150.13 kB minified/882.09 kB gzip primary-chunk warning remains.

## Phase 2B latest-branch reconciliation — 2026-09-23

The development branch was re-read after the Windows/VS Code continuation.
Remote head had advanced from `fac95ed2772c10df3ee795f78c04cb50b25f7323`
to `14b3f5e48da4e7a1e43df636ffa9ad941b1eeb4d`, 120 commits ahead. Those
changes were preserved and used as the new baseline; none were overwritten.
The commits restore a large part of the unrecorded hosted schema and contain
multiple source-order corrections discovered during local replay.

Fresh static verification of that exact head still found two manifest gaps and
33 explicit object-order findings. `accounts` was confirmed not to be a gap:
its only uses are protected by `to_regclass()` and it is intentionally optional
on fresh installations. The actual remaining gaps were an early Charge Master
provider, sales-consolidation/entity-translation foundations, and privileged
function creators referenced by later ACL migrations.

Development-only reconciliation adds 17 migration files: 15 exact live-history
or live-function definitions, the evidence-based early Charge Master provider,
and the pre-tenant sales-consolidation provider. It also restores the exact
`backfill_company_urdu_names` creator inside the existing print-language
migration and adds a general object-order regression checker. No production
row was copied and no hosted schema/history was changed.

Current measured static result: 0 duplicate IDs, 0 empty SQL files, 0 SQL
corruption findings, 13/13 required manifest foundations ordered, 0 known
missing foundations and 0 explicit relation/function DDL-before-creator
findings. Migration-checker tests pass 15/15. `npm run check` passes typecheck,
19 test files/81 tests and Vite build; the existing 3,150.13 kB minified /
882.09 kB gzip primary-chunk warning remains.

Status remains **IMPLEMENTED BUT UNVERIFIED** until one genuinely fresh,
unlinked Windows `npx supabase db reset --debug` completes. Authenticated
synthetic tenant/RPC tests remain blocked behind that result. Production,
Toqeer Builder, `main` and Vercel were unchanged.

## Phase 2B full-chain preflight correction — 2026-09-23

After replay reached 0026, a redundant ACL block failed because `apply_stock_movement` is created in 0027; 0027 already secures it, so the premature ACL was removed. A complete static function-order pass found 77 ACL/ALTER-before-local-creator candidates plus the nine known missing table foundations. These are triage candidates, not 77 confirmed defects. Further Windows looping is paused until batch reconciliation is complete.

## Phase 2B migration dependency update — 2026-09-23

The Windows failure at migration 0007 is a **confirmed repository bootstrap defect**. Git history, current migrations and read-only production history contain no recorded creator for `godowns`/`warehouses`; the initial repository already assumed these hosted tables existed. An evidence-based minimal foundation for `categories`, `uom`, `warehouses`, `godowns` and `transporters` was added to migration 0002, before first use. No production data or final tenant state was copied.

The next real Windows replay applied 0001/0002 and exposed a separate migration 0003 syntax corruption: two PostgreSQL dollar-quoted blocks had `$$` stored as `PKRPKR`. Initial Git commit and read-only live migration history both contain that token. Development 0003 now restores `DO $$ ... END $$;`, with a regression checker. Replay beyond 0003 is not yet verified.

The subsequent replay applied 0001–0004, then 0005 failed because the exported bootstrap omitted legacy journal/payment columns that 0005 and 0007 consume. Read-only live column order/constraints, frontend types and later migrations corroborate the exact journal, journal-line party, and sales payment/account fields. Migration 0004 now restores them after COA creation. Replay beyond 0005 remains unverified.

The next replay applied 0001–0024 and exposed another omitted legacy column: 0025 defines the `items.warehouse_id` restrictive FK without creating the column. Read-only live catalog confirms the nullable UUID and exact FK. Migration 0002 now restores the column within the warehouse foundation; replay beyond 0025 is not yet verified.

Replay then applied 0001–0025; 0026 failed because both stock tables lacked warehouse/godown UUID columns it immediately makes mandatory. Read-only live catalog confirms all four columns and restrictive FKs, with no later repository creator. Migration 0002 now restores them nullable with exact FKs, leaving 0026 to enforce NOT NULL. Later replay remains unverified.

All nine duplicate timestamp groups were reconciled to the exact distinct versions recorded live, and three zero-byte placeholders with known non-empty/live counterparts were removed. The filename checker now passes with 0 duplicate IDs and 0 empty files. Full clean replay is still **NOT VERIFIED**: at least nine referenced foundations remain absent, and the multi-service foundation is only a marker while live history holds substantial DDL. See [the dependency audit](docs/NAVILO_PHASE2B_MIGRATION_DEPENDENCY_AUDIT.md). Production/main/deployment were unchanged.

## Phase 2B local alternative — 2026-09-22

User independently verified Toqeer Builder's separate organization contains an existing Free project `salesconnect91-lab’s Project` in `ap-southeast-2` (27 MB database; 1 MAU). Neither it nor NAVILO production is a test environment; no pause/delete/reset or paid hosted project is authorized. [Local feasibility and test sequence](docs/NAVILO_PHASE2B_LOCAL_ISOLATION_FEASIBILITY.md) records prerequisites and limits. This executor has Node/Python but no Docker/Podman, Supabase CLI or local PostgreSQL. A fresh checker run still reports 9 duplicate migration IDs and 3 empty SQL files; checker unit tests (2) and harness syntax passed. **No local migration replay or authenticated tenant/RPC probe ran.** The existing hosted-only negative-test harness must gain a loopback-only local mode before use. User's Windows host requires read-only prerequisite check `wsl --status` as the first manual action; Windows runtime status is unknown.

## Free-project quota investigation — 2026-09-22

Supabase current [billing guide](https://supabase.com/docs/guides/platform/billing-on-supabase) says the two-active-free-project limit is aggregated across **all organizations in which a member is Owner or Administrator**. Its [billing FAQ](https://supabase.com/docs/guides/platform/billing-faq) additionally says another Owner/Admin member can block creation in a free organization if their own limit is exhausted. This directly explains why a NAVILO organization with one visible project may reject another: the previous error named `salesconnect91-lab` at its two-project limit. User reports Toqeer Builder is a different organization; it **could** be the second counted project if the same member is Owner/Admin there, but the connected Supabase tool lists only NAVILO organization/project and cannot confirm Toqeer membership, its project status, plan, ID or quoted cost. The $0/month NAVILO quote did not override the account-wide quota.

Creating in Toqeer Builder's organization under the same quota-exhausted Owner/Admin would ordinarily be rejected as well. No Toqeer cost quote or create attempt was made, and no organization or project data changed. A separate project would have independent database/Auth/Storage and separate credentials, but organization administrators and billing/usage governance would be shared with Toqeer. The user requires exact organization, $0/month quote and renewed approval **before** any attempt there. Current authenticated migration/RPC tests stay BLOCKED.

## Phase 2B provisioning attempt — 2026-09-22

The user authorized only a separate synthetic-data project named `NAVILO-ISOLATED-UAT` in organization `mjjubagcqiqqoqujscba`, region `ap-southeast-1`, at $0/month. Supabase `get_cost(type=project)` returned $0/month again; `confirm_cost` succeeded. `create_project` then returned `BadRequestException`: organization member `salesconnect91-lab` has reached the **two active free projects per owner/administrator limit**; the provider suggested delete, pause or upgrade. Creation failed; no isolated project reference exists. The prior list for this organization showed only one active production project; the error describes a per-member limit across organizations, so the second project is not identified here. No paid branch, production SQL, test data, migration or deployment action occurred.

**Phase 2B authenticated migration replay and cross-tenant/RPC negative tests remain BLOCKED.** A zero-cost free project slot must first be made available by an authorized owner without pausing/deleting NAVILO production, or an independently owned free organization/project must be connected and explicitly authorized. Do not infer an exploitable security issue from this block. See [Phase 2B results](docs/NAVILO_PHASE2B_TEST_PLAN_AND_RESULTS.md). Previous local checker/unit/typecheck/build outputs are historical results from the preceding continuation, not rerun now.

## Phase 2B update — isolated test environment blocked

The [Phase 2B test plan and results](docs/NAVILO_PHASE2B_TEST_PLAN_AND_RESULTS.md) records the provisioning decision, synthetic fixture requirements and expected/actual status. No Supabase branch or project was created: connected organization is free with one existing production project, quoted separate-project cost $0/month, branch $0.01344/hour, and provider requires organization selection plus cost confirmation before project creation. This executor has no Docker/PostgreSQL/Supabase CLI. No production data was used as a test fixture. Therefore migration replay and authenticated cross-tenant/BU/branch tests remain **BLOCKED**, not failed or passed.

Prepared `scripts/phase2b_negative_tests.mjs` for a future isolated project. Its syntax and no-ref/production-ref rejection preflight passed; no user credentials or real data were committed. Existing `npm run check` again passed typecheck, 81 tests and build. The migration filename checker still reports the 9 duplicate IDs and 3 empty files as an expected failure. No confirmed security exploit and no database remediation were produced in Phase 2B.

## Phase 2A update — 2026-09-22

Development baseline and all three original reports were confirmed on remote branch commit `eee4f41ee40a9be1c757e7fe7596450eabe2c3b3`; remote `main` was `a7879524ab0f2bb404e640edd784a9a9b545b1e0`. The complete read-only version/name comparison is [migration reconciliation](docs/NAVILO_PHASE2A_MIGRATION_RECONCILIATION.md) with [692 source rows](docs/NAVILO_PHASE2A_MIGRATION_MATRIX.csv). It confirms nine duplicate local version IDs and three empty local migration files. Among 201 uniquely named single-statement pairs, 140 whitespace-normalized texts match and 61 differ; semantic equivalence and current schema parity are still unproven. **No live migration was applied.**

The [103-function matrix](docs/NAVILO_PHASE2A_RPC_MATRIX.md) and [security review](docs/NAVILO_PHASE2A_SECURITY_REVIEW.md) capture live definition fingerprints, grants, path and individual static triage. All 103 have direct authenticated grants and no anonymous/PUBLIC grant; 37 of 37 public views use security invoker, 150 of 150 public tables have RLS. Targeted bodies show owner, company and module guards in many cases. **No critical exploitable RPC flaw was confirmed** and no authenticated cross-tenant negative test was run. A local filename checker was prepared as a prospective CI gate; it fails on the known 3 empty/9 duplicate fixtures. `npm run check` again passed typecheck, 19 files/81 tests and build, retaining the large-bundle warning. Release gate remains OPEN.

## Executive decision

**Release gate OPEN. Audit coverage PARTIAL.** This is a repository-wide inventory and sampled code/database audit, not an authenticated A-to-Z UAT. Do not merge or deploy on this evidence. The development checkout was `salesconnect91-lab/NAVILO`, `work/dashboard-en-ur-20260921`, `2f4549737d0258d7d7e2daf596353d775cd7b43b`. Vercel's latest production-target deployment metadata identifies `main` SHA `a7879524ab0f2bb404e640edd784a9a9b545b1e0`, READY; the preview at development SHA is also READY. Production alias mapping was not independently verified. The live login page rendered, but no authenticated screen was inspected. Current main ref was not fetched independently. No percentage is defensible: implementation presence, behavior and UAT are different denominators.

## Scope and evidence

Inspected `src/App.tsx`, `src/components/Layout.tsx`, module filenames/routes, package scripts, `.github/workflows/build.yml`, `docs/NAVILO_MASTER_RULES.md`, `docs/NAVILO_UNIFIED_RELEASE_GATE.md`, selected code searches, live Supabase aggregate metadata, security advisors, Vercel deployment metadata, and public login screen. The repository contains 502 tracked/searchable files, 262 local migration SQL files and 19 test files. Live database reported 430 migration-history entries, latest `20260921204530`; local latest filename is `20260919230000_scope_language_entitlements_to_pakistan_en_ur.sql`. This is a **migration reconciliation risk**, not proof that any particular migration is missing or extra: compare complete version sets and live definitions before changes.

`npm ci --ignore-scripts --no-audit --no-fund` succeeded; `npm run check` succeeded: TypeScript, 19 test files/81 tests and Vite build (3005 modules). Build warns that the primary JS chunk is 3,150.13 kB minified / 882.09 kB gzip and CSS is 270.33 kB / 38.96 kB gzip. This is local development-branch evidence only; there is no authenticated UAT or CI-run evidence for this SHA. `.github/workflows/build.yml` only triggers pushes to `main`, `work/navilo-unified-release-audit-*`, and PRs to main: a push to the present development branch alone is outside its configured push filter.

Live read-only SQL: 150 public tables, zero without RLS; 37 public views; 103 public SECURITY DEFINER routines executable by `authenticated`, zero by `anon` according to role privilege checks. Security advisor also flags the 103 authenticated routines. This is an attack-surface review priority, not evidence of an exploit: audit each function's context, permissions and parameter ownership. Live aggregates: 2 companies, 2 business units, 1 membership, 3 sales orders, 22 journal entries, 2104 audit-log rows. These counts do not verify company-to-row isolation. No production data was changed.

## Inventory and status

Status reflects only the stated evidence. `IMPLEMENTED BUT UNVERIFIED` means route/component or schema exists, with behavior untested; `PARTIAL` means a demonstrated gap in required coverage. Nested route maps are in `src/App.tsx`, each module router, and `src/components/Layout.tsx`.

| Area | Screens/workflow and database dependency sampled | Status | Next acceptance evidence |
|---|---|---|---|
| Platform Owner | `/owner`, onboarding, billing, subscriptions, company/BU/branch, branding, deletion/reset controls; `supabase/functions/platform-admin/index.ts`, company/membership tables | IMPLEMENTED BUT UNVERIFIED | Owner vs tenant negative UAT, subscription expiry and destructive-action preview without executing deletion |
| Auth/permissions | Login/reset, route guards, `src/auth/*`, feature registry, company switcher | IMPLEMENTED BUT UNVERIFIED | Two-tenant/BU/branch negative tests and RPC direct-call authorization |
| Master data | `/master-data/*`, customer/supplier/item/UOM/category/employee/warehouse/transporters; corresponding public tables | IMPLEMENTED BUT UNVERIFIED | Duplicate race, import, rename historical snapshot and cross-tenant checks |
| Sales | `/sales/*`, invoices, consolidation, charges, order book, pre-invoice workflow; sales orders/lines and allocation tables | IMPLEMENTED BUT UNVERIFIED | Draft/post/receipt/return/reversal, totals, tax, numbering, printed output |
| Purchase | `/purchase/*`, order book, consolidated invoices, pre-invoice; purchase orders/lines and payment allocations | IMPLEMENTED BUT UNVERIFIED | Requisition→GRN→invoice→AP→payment, posted locks |
| Accounting | `/accounting/*`: COA, mappings, journal, ledgers, trial balance, P&L, balance sheet, cash flow, periods, VAT, payroll, loans; journal/ledger/account tables | IMPLEMENTED BUT UNVERIFIED | Balanced posting, immutable history, period close, AR/AP/GL reconciliation |
| Inventory/warehouse | `/godown/*`, stock movements, advanced controls; stock/valuation tables | IMPLEMENTED BUT UNVERIFIED | Purchase receipt→transfer→sale→return, valuation and negative-stock cases |
| Steel manufacturing | `/production/*`, `/cutting/*`, furnace, work orders, gate pass; production/cutting tables | IMPLEMENTED BUT UNVERIFIED | Yield/scrap/QC posting and stock/GL reconciliation; route is steel-only |
| Transport | `/transport/*`; business-unit transport type gating | IMPLEMENTED BUT UNVERIFIED | Booking/dispatch/billing and permission UAT |
| HR/assets | Employee master and payroll ledger present; no dedicated assets register/depreciation or broad HR lifecycle route found in App/layout inventory | PARTIAL | Specify HR/assets pack, register→depreciation→disposal test |
| Reports | `/reports/*`, sales person, customer statement, supplier aging, steel reports; `Reports.tsx` registry of view/RPC dependencies | IMPLEMENTED BUT UNVERIFIED | Header/cell/export/print order and tenant scope for every report |
| Audit log | `/accounting/audit-trail`, public `audit_logs` rows | IMPLEMENTED BUT UNVERIFIED | Actor/source/tenant completeness and immutable log test |
| Integrations | Edge functions `company-admin`, `platform-admin`, `send-payment-reminder`; no general-purpose public integration catalog established | PARTIAL | Signed API/webhook/retry/error and data minimization requirements |
| Backup/recovery | Release-gate requirements documented; no installed Windows/USB/Drive agent or isolated restore proof presented | BLOCKED | Evidence of encrypted backup, manifest, offsite copy and isolated restoration |
| Localization | Runtime and document language files/tests exist; fixed English/Urdu strings in App/Layout | CONFIRMED BUG | English-only, Urdu-only, bilingual selection across UI and documents with no third language |
| Desktop/tablet/mobile visual design | Public login visibly rendered; authenticated screens inaccessible | BLOCKED | Captured authenticated viewport matrix and print/PDF review |

## Design assessment and proposed system

Code evidence: `Layout.tsx` defines 252 px sidebar, 68 px collapsed width, three levels of nested navigation, 12.5–13 px labels and mixed bilingual text in every node. Long expanded navigation and untranslated always-bilingual labels conflict with a compact language-aware enterprise shell. Actual dashboard proportions, table overflow, accessibility, loading/empty states, invoice and print rendering across 1440, 1280, 768 and 390 px are **BLOCKED**, not visually verified. The public login is available but cannot stand in for those screens.

Specification proposal: a restrained neutral surface and one primary action color; 8 px spacing scale; type roles for page title, section, body, label and data; 44 px minimum touch targets; visible focus and keyboard traversal; density choice for data tables; semantic color tokens for status; shared page header, filter bar, searchable selectors, table with column model, form field, skeleton, empty/error state, modal, document header and print token set. Navigation: six to eight first-level groups with favorites/recent items and command search, one expansion level at a time, user-controlled collapse persisted per device, role/industry filtering, mobile drawer and breadcrumb. Keep Owner separate. Use shared templates for master records, transactions and reports, while invoice line editor, factory execution and financial statements retain specialized layouts. Validate actual screenshots and keyboard/screen-reader behavior before implementing.

## Shared rules and correctness

`docs/NAVILO_MASTER_RULES.md` marks name/code, language, report parity and historical snapshots as in progress. Direct code evidence confirms hardcoded mixed-language loading, error and navigation text in `src/App.tsx` and `src/components/Layout.tsx`, even though the default/single language rule requires one language. The passing language tests do not cover those literal surfaces. SearchableSelect has one test, not module-wide verification. No authenticated transaction, print, CSV/Excel, PDF, RLS negative test, posted immutability, VAT arithmetic, stock valuation, closed-period or balance reconciliation was executed. Database RLS enabled on all public tables is positive structural evidence, not tenant isolation proof. Reconcile every public view and 103 exposed privileged RPCs with their actual grants and guards.

## Pakistan multi-industry roadmap

Common core: tenant/company/BU/branch, contacts and catalog, configurable tax and numbering, sales/purchase, stock, GL/AR/AP, approvals, audit, reports, language, billing, reliable backup. Optional packs: wholesale/distribution (price lists, route van, credit limits, delivery reconciliation); retail/POS (barcode, tills, shifts, refunds, offline sync and applicable POS integration); services (time/expense, contracts, milestone billing); construction (projects, BOQ, subcontractors, retention, progress billing and job costing); manufacturing (BOM, routing, WIP, QC, maintenance, scrap and standard/actual cost); trading (landed costs, multi-warehouse, quotations). Steel-specific furnace/cutting/weighbridge stays a pack, not the default core. These are gap proposals, not claims that existing screens lack every part.

Official FBR STGO 01/2026 states specified registered persons must integrate digital sales tax invoicing through licensed integrators and gives 72-hour correction rules for integrated invoices ([FBR order](https://download1.fbr.gov.pk/Docs/2026331133557466STGO01of2026.pdf)). Applicability and phased deadlines depend on current orders and taxpayer category; determine them per customer with tax counsel. Punjab services tax has a distinct provincial registration/invoice regime ([PRA FAQ](https://pra.punjab.gov.pk/FAQs/Index)); inspect other provinces separately. NAVILO's `src/lib/jurisdictionConfig.ts` has Pakistan tax labels, but no code or live integration test here proves FBR/PRA compliance. Commercial launch should initially be scoped to validated customer types and tax workflows; integrations and specialized packs follow after exact legal/technical applicability and end-to-end validation.

## Release gates and remaining coverage

Local typecheck/test/build **passed**. Every other gate in `docs/NAVILO_UNIFIED_RELEASE_GATE.md` remains open: branch/live migration parity, privileged-function review, authenticated cross-tenant/BU/branch tests, full AMK UAT, print/export evidence, isolated migration rehearsal, backup and isolated restore, performance budget, exact production alias verification. No production deployment, migration or data mutation was attempted. See `NAVILO_ISSUES.md` and `NAVILO_HANDOFF.md`.

## Phase 2B Windows replay: stock movement traceability foundation — 2026-09-23

Fresh Windows replay at development SHA `86b452b274d89ffea21d756b9f202b09607a0c35` applied through `20260913072000` and then failed in `20260913072054_correct_stock_approval_scope_and_validate_evidence.sql` because `stock_movements.source_type` did not exist (`42703`). This proves the preceding controlled-transfer approval restoration executed, but the full replay still is **NOT PASS**.

Read-only production catalog evidence confirms nullable `source_type text` and `source_id uuid`. Read-only production migration history identifies the omitted original provider as `20260906223502_control_manual_inventory_adjustments`; it creates `reason`, `remarks`, `unit_cost`, `source_type`, and `source_id` together and installs the controlled adjustment RPC. That exact historical foundation is now restored on the development branch before all consumers. No production write or customer-data copy occurred. Static/unit/application gates passed after the repair; a new genuinely fresh Windows replay is still required.

## Phase 2B Windows replay: branch-isolation version reconciliation — 2026-09-23

Fresh replay at SHA `0622440bdbc63a1e2131844b03d9e123235e37b7` proved the stock source foundation and continued through `20260913080500`, then failed in the locally named `20260913082000_index_branch_scoped_foreign_keys.sql` because `consolidated_purchase_invoice_charges.operating_location_id` did not yet exist (`42703`). Read-only live history and byte-level comparison established that the SQL was correct but three repository timestamps were wrong: the exact live bodies are `20260913073121_complete_transaction_branch_isolation_v2`, `20260913073519_enforce_operating_location_write_scope_globally`, and `20260913081611_index_branch_scoped_foreign_keys`. The repository files are now reconciled to those live versions, placing the column provider before the indexes. No SQL body or production schema was changed. Full replay remains pending.

## Phase 2B Windows replay: sales-core dynamic patch compatibility — 2026-09-23

Fresh replay at SHA `1f0a957a8b0eaff573b37468e3f80e4e02b77a47` proved the three branch-isolation migrations now execute in the correct order and advanced through `20260914212031`. It failed in `20260914225847_restore_sales_post_tenant_user_resolution.sql` with `P0001: post_sales_invoice_core patch pattern did not match`. The earlier restored core already contains the intended secure final state: active company/BU lookup, `v_user_id := v_order.user_id`, and a null owner-context rejection. The later dynamic migration incorrectly treated an already-hardened definition as failure. Development now accepts only that explicitly verified final state as a no-op; otherwise it runs the original transformation and still fails on an unknown pattern. Full replay remains pending.

## Phase 2B fresh local migration replay PASS — 2026-09-23

The user pulled exact development SHA `f6b3f4da1f7e29528e1ca9b4fca086e22e285f92` into `C:\NAVILO-latest` and ran `npx supabase start --debug` against a newly initialized local database volume. Every repository migration applied in order, including the repaired `20260914225847` migration and all remaining files through `20260921204530_preserve_company_selected_languages.sql`. The CLI then started the containers and reported `Started supabase local development setup` with healthy local REST and Edge Function checks. This is direct evidence that the repository migration chain can build a fresh local schema; DB-01 migration replay is now **VERIFIED WORKING** for this SHA.

The missing optional `supabase/seed.sql` warning and Windows Analytics TCP warning did not stop schema replay or health checks. They do mean no business fixture was seeded and Analytics was not verified. Authenticated tenant/RPC behavior is still unverified: no synthetic user, company, BU, branch or JWT-backed call occurred in that replay. A new local-only runner now prepares exactly those synthetic fixtures, obtains local credentials internally from the CLI, refuses every non-loopback endpoint and prints no password/key/email. Its syntax is verified; execution on the running Windows stack remains the next gate.

Post-change verification also passed: migration filename, SQL-sanity, strict-dependency and explicit object-order checks all reported zero findings; 23 migration-checker unit tests passed; `npm run check` passed TypeScript, 19 test files/81 tests and the Vite build. The known 3,150.13 kB primary bundle warning remains a performance issue, not a failed build.

## Phase 3 business-UAT preparation and accounting catalog drift — 2026-09-23

Phase 2B is closed for its measured scope: clean local replay plus 41/41 targeted authenticated isolation assertions. The next release gate is valid-document business UAT, not UI redesign or production deployment.

Read-only live catalog comparison confirmed that clean repository replay did not reproduce three current tenant-aware accounting RPC definitions: `initialize_default_coa()`, `post_journal_entry(uuid)` and `reverse_manual_journal_entry(uuid,date,text)`. Live definitions enforce authenticated/current-company context, and the posting/reversal functions include current-BU and accounting permission controls. The historical live migration versions that supplied the final definitions are absent from the repository. Development migration `20260923180627_restore_live_core_accounting_rpcs.sql` restores the exact evidenced definitions and ACLs without changing production history.

A loopback-only synthetic runner now covers purchase, sales, stock, AR/AP payments, journals, returns, reversals, posted immutability, period close and wrong-role/cross-tenant denials. Pre-execution gates pass: 0 migration version/sanity/dependency/order findings, 24 checker tests, TypeScript, 19 files/81 application tests and production build. The actual new migration and business matrix are **PENDING Windows local execution** and are not claimed PASS. See `docs/NAVILO_PHASE3_TEST_PLAN_AND_RESULTS.md`.

The first Windows execution at `5a17460…` proved the accounting-RPC reconciliation migration applies locally, then stopped before assertion 1 with `PGRST204` on missing `customers.account_id`. Repository inspection confirms neither customer nor supplier control-account column has a creator, although later RPCs and UI require both. Read-only production catalog confirms nullable UUID columns and foreign keys to `chart_of_accounts(id)`. Development now restores that missing baseline in `20260923182230_restore_customer_supplier_account_foundation.sql`; business UAT remains pending rerun.

## Phase 2B local fixture runner: profile compatibility repair — 2026-09-23

The first execution of the local-only runner at SHA `885e2cee36cdb838ed7ac6c07ec5da83a6577149` passed its local endpoint/key discovery and created the six synthetic Auth identities, then stopped before company/data creation with HTTP 400 on the first `user_profiles` insert. Static schema trace confirms the exact cause: `20260828150000_0005_professional_erp_foundation.sql` created both `id` and a separate `user_id uuid not null`; the later `20260902160000_complete_accounting_controls.sql` used `create table if not exists`, so it did not replace that existing layout. The fixture supplied `id` but omitted required `user_id`.

The runner now supplies identical synthetic Auth UUIDs to both columns. It also invokes `npx.cmd` directly on Windows instead of using an unescaped shell and reports only sanitized database error code/message details. This was a test-harness compatibility bug, not evidence of a tenant-isolation bypass. The authenticated matrix remains pending until the repaired runner is executed.

The next Windows attempt at SHA `ee1f8623aa458bdb980b7cbf02d96f7e91fcb317` stopped before local status discovery. This was traced to Node/Windows process launching: `.cmd` shims cannot be relied on as direct executables with `shell:false`. The runner now invokes the fixed, argument-free Supabase status command through Windows `ComSpec` with `shell:false`; no user-controlled value is interpolated. It distinguishes CLI launch failure, genuinely stopped local containers and a nonzero CLI status without printing stderr or keys. No Auth or authorization test ran in this attempt.

At SHA `029437349f5c24dbb78e7c6a7a1622d41f53b85c`, the repaired launcher and profile inserts succeeded. Provisioning then stopped on SQLSTATE `23505` for unique `(business_unit_id,user_id)`. This is expected interaction with `trg_sync_default_business_unit_membership`: inserting a company membership automatically creates or updates the matching default-BU membership. The runner incorrectly attempted a second plain insert. It now uses the same unique key as an idempotent upsert, preserving the trigger-created row and explicitly setting the intended role/active state. No authorization assertion ran in this attempt.

At SHA `db06c7197449b708d8100d126b93fe9266bbdfed`, provisioning progressed through locations and module configuration, then service-role customer insertion failed closed with `P0001: No active company selected.` The exact source is `tenant_context_stamp` / `tenant_stamp_company_user()`, which requires an authenticated active-company context even when `company_id` is explicitly supplied. The fixture now signs in the synthetic Platform Owner, selects each synthetic company through `set_current_company(uuid)`, and creates its customer through the ordinary authenticated REST path. The tenant trigger and RLS stay enabled; this is closer to the production write flow than bypassing them.

## Phase 2B targeted authenticated isolation matrix PASS — 2026-09-23

At exact development SHA `f4ddc905ed11fb78d217d4cb08f16ccdc4bd932a`, the Windows local runner completed against the clean-replayed schema with **41/41 PASS and 0 failures**. It provisioned two synthetic companies, two BUs and two branches per company, plus owner, accounts, sales, viewer, revoked and second-tenant Auth identities. Positive controls returned true for own-company/report access and Platform Owner identity. Negative cases returned zero foreign company/customer rows, false for forged foreign-company helpers/module permissions, HTTP 400 for unassigned same-company BU/branch switching and forged owner-only BU assignment, false/zero for viewer and revoked access, and HTTP 401 for anonymous helper execution.

The complete sanitized expected/actual evidence is [Phase 2B local security results](docs/NAVILO_PHASE2B_LOCAL_SECURITY_RESULTS.md). This verifies the targeted company/BU/branch/RLS/helper matrix; it does not dynamically certify every one of the 103 privileged functions or replace accounting, stock and document-lifecycle UAT. Clean migration replay and this targeted authentication/isolation gate are now **VERIFIED WORKING** locally. No production/main/Vercel/hosted Supabase mutation occurred.
