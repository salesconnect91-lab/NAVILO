# NAVILO prioritized issue register — 2026-09-22

## MIG-12 / P0 release gate — missing stock approval/transfer migration chain

- **Evidence:** fresh replay advanced through `20260913072000`, then storage policy compilation in `20260913072054` failed with SQLSTATE 42703 on missing `stock_movements.approval_slip_path`.
- **Root cause:** four live-applied foundational migrations were absent from the repository: `20260906225648`, `20260906230719`, `20260907074107`, and `20260907074902`. They create the nullable evidence/transfer-number columns, private storage buckets/policies, controlled adjustment/transfer RPCs, cross-warehouse behavior and numbering.
- **Evidence boundary:** definitions and types were obtained through read-only production catalog/migration-history queries. No customer rows were copied and no hosted DDL/DML was executed.
- **Fix:** restore the exact four live statements at their original versions and add regression contracts for the linked foundation; do not synthesize only the missing column.
- **Acceptance:** static/version/dependency tests pass and fresh local replay proceeds through both stock-approval policy migrations and the complete remaining chain.

## MIG-11 / P0 release gate — sales posting core rename collision

- **Evidence:** fresh replay applied `20260908174000_restore_unrecorded_post_sales_invoice_core.sql`, then `20260908174200_enforce_sales_post_business_unit_scope.sql` failed with SQLSTATE 42723 because `post_sales_invoice_core(uuid)` already existed.
- **Root cause:** reconciliation restored the live-only core definition before a historical wrapper migration whose original assumption was that only `post_sales_invoice(uuid)` existed.
- **Batch review:** all repository `ALTER FUNCTION ... RENAME TO` statements were checked. The return-note rename has an existing `to_regprocedure()` guard; this sales rename was the only unguarded collision.
- **Fix:** guard the rename when the core is absent and use `CREATE OR REPLACE` for the public permission/BU-scoped wrapper. Preserve existing core implementation and later ACL hardening.
- **Acceptance:** regression contract passes and fresh replay proceeds beyond `20260908174200` through the complete chain.

## MIG-10 / P0 release gate — missing semicolons after restored function bodies

- **Evidence:** Windows replay reached the restored `post_sales_invoice_core(uuid)` definition and failed when PostgreSQL encountered the following `revoke`; the body ended with `$function$` instead of `$function$;`.
- **Batch scope:** repository-wide scan found two instances: `20260908174000_restore_unrecorded_post_sales_invoice_core.sql` and `20260909185000_restore_unrecorded_create_and_post_return_note_internal.sql`.
- **Root cause/impact:** live function definitions were restored as migration text without SQL statement terminators, blocking clean installation and all later isolation tests.
- **Fix/test:** add only the two required semicolons; add a checker and unit test for a dollar-quoted body immediately followed by another SQL statement without `;`.
- **Acceptance:** static gates pass and a genuine fresh local replay completes both migrations and the remaining chain.

## MIG-09 / P0 release gate — malformed discount helper delimiter

- **Evidence:** Windows fresh replay after commit `577e1f7b8e41e359a1a83b19451f395615ba0fc8` advanced through `20260906225113`, then migration `20260906232419_commercial_invoice_discounts_accounting.sql` failed at statement 10 with SQLSTATE 42601 on `AS $`.
- **Root cause:** `discount_amount_for()` was committed with single-dollar opening/closing delimiters. PostgreSQL requires paired `$$` or matching named tags. A prior commit message claimed a delimiter fix but its commit was empty; the SQL body remained unchanged.
- **Impact/severity:** P0 migration/recovery gate; fresh environments cannot reach later schema or authenticated isolation tests.
- **Fix/evidence:** replace only `AS $` / `$;` with `AS $$` / `$$;`; scan all migrations for the same malformed form; extend SQL sanity checks and unit coverage.
- **Acceptance:** static checks pass and Windows fresh local replay completes the entire chain. Until that actual replay finishes, migration status remains **PARTIAL**.

## MIG-08 / P0 release gate — stray diff marker in print-language migration

- **Evidence:** Windows fresh local start at `08e53252043e77cedae6e0fd670702b72265807e` applied through `20260904151609` and failed at statement 3 of `20260904165202_restore_print_language_foundation.sql` with SQLSTATE 42601 at `+create or replace function public.backfill_company_urdu_names()`.
- **Root cause:** an accidental patch marker was committed as SQL; the prior sanity checker only detected the known `PKRPKR` corruption token and required snippets.
- **Impact/severity:** P0 migration/release gate; clean installations cannot pass this migration. No production impact was observed because no hosted migration was applied.
- **Fix:** remove only the leading `+`; make `scripts/check_migration_sql_sanity.py` reject diff markers before SQL statement keywords; add a unit regression test.
- **Acceptance:** checker/unit suite passes, then a genuinely fresh Windows local Supabase start applies this migration and the full remaining chain without error. Until then, replay status is **PARTIAL**, not PASS.

## Phase 2B latest checkpoint — 2026-09-23

| ID / priority | Evidence | Current status / acceptance |
|---|---|---|
| MIG-03 / P0 release gate | Latest remote head was 120 commits ahead and preserved. It reduced earlier dependency gaps substantially, but a fresh full-chain scan still found two manifest gaps and 33 explicit object-order findings. Development reconciliation now reports 0/0. | **IMPLEMENTED BUT UNVERIFIED.** One fresh unlinked reset must complete; static checks cannot prove dynamic SQL/runtime behavior. |
| MIG-09 / P0 release gate | New `check_migration_object_order.py` covers explicit ALTER/policy/trigger/index/table grants and function ACL/ALTER ordering. It reports 0 findings after reconciliation; 3 regression tests pass. | Static acceptance PASS. Runtime acceptance is the clean reset. |
| TEST-03 / P0 | No synthetic authenticated tenant/BU/branch/RPC calls were executed in this environment. | After reset PASS, provision only synthetic identities/data and execute positive controls plus forged-ID/revoked-role negative cases. |

## Full-chain preflight after repeated replay failures

| ID / priority | Evidence | Fix / acceptance |
|---|---|---|
| MIG-08 / P0 confirmed | 0026 references `apply_stock_movement` before 0027 creates it; 0027 already contains identical least-privilege ACL. | Remove only premature 0026 ACL; 0026/0027 must apply sequentially and final grants remain authenticated-only. |
| MIG-09 / P0 release gate | Full static pass found 77 ACL/ALTER-before-local-creator candidates and nine missing table foundations. Candidates are not all confirmed defects. | Reconcile each with live history/conditional SQL, recover reviewed foundations, then run one uninterrupted clean reset with zero unexplained strict findings. |

## Phase 2B migration dependency result — 2026-09-23

| ID / priority | Evidence / root cause | Required fix | Acceptance test |
|---|---|---|---|
| MIG-02 / P0 confirmed | 0007 references `public.godowns`; no `godowns`/`warehouses` creator existed in any Git ref or recorded live migration. | Minimal evidenced legacy master foundation added to 0002 on development only. | Dependency ordering checker passes; a clean local replay advances beyond 0007 without 42P01. |
| MIG-03 / P0 release gate | Creators remain absent for `accounts`, `charge_master`, `companies`, multi-service core, language/order-book/loading/entitlement tables. Local multi-service migration is comments only. | Recover exact live DDL, review functions/policies/data updates, add chronologically, and rehearse locally. Never rewrite production history. | Strict dependency check and a genuinely fresh `supabase db reset` both pass. |
| MIG-01 / P0 partially resolved | Live history maps duplicate filenames to distinct versions; three empty placeholders have matching non-empty changes/live versions. | Filenames reconciled and empty superseded placeholders removed. | Filename checker exits 0 (current PASS); this does not establish replay PASS. |
| MIG-04 / P0 confirmed | Actual Windows replay applied 0001/0002 then 0003 failed on `DO PKRPKR`; initial Git commit and read-only live history contain the same corrupted token. | Restore PostgreSQL `$$` delimiters in both 0003 blocks and reject the token in regression checks. | SQL sanity checker passes and fresh replay applies 0003; later replay remains separately gated. |
| MIG-05 / P0 confirmed | Replay then applied 0001–0004; 0005 failed on absent `journal_entries.payment_mode`. No repository creator exists; live ordinal/constraint evidence shows pre-history journal, party and sales payment/account columns. | Restore the corroborated legacy columns in 0004 after COA exists, before 0005/0007 consumers; enforce with SQL sanity contract. | Fresh replay applies 0005; later chain remains separately gated. |
| MIG-06 / P0 confirmed | Replay applied 0001–0024; 0025 failed because it adds an FK on absent `items.warehouse_id`. Live catalog confirms nullable UUID plus restrictive warehouse FK. | Add the missing legacy column in 0002; retain 0025 as FK owner and guard provider ordering. | Fresh replay applies 0025; later chain remains separately gated. |
| MIG-07 / P0 confirmed | Replay applied 0001–0025; 0026 requires warehouse/godown UUIDs on `warehouse_stock` and `stock_movements`, but no local creator exists. Live catalog confirms four columns and restrictive FKs. | Restore nullable columns/FKs in 0002; keep 0026 as NOT NULL/integrity owner and enforce regression contract. | Fresh replay applies 0026; later chain remains separately gated. |

Exact mappings and provenance: [migration dependency audit](docs/NAVILO_PHASE2B_MIGRATION_DEPENDENCY_AUDIT.md).

## Local isolation path — Phase 2B

| ID / priority | Evidence / root cause | Required fix or dependency | Acceptance test |
|---|---|---|---|
| ENV-03 / P0 release gate | This executor lacks Docker/Podman, Supabase CLI and PostgreSQL tools; Windows host state unknown. Two existing Free projects belong to different organizations and neither may be used for tests. | Use a disposable **unlinked local** Supabase CLI stack on user's Windows host after `wsl --status` prerequisite check; no hosted project, paid branch, remote flags, production credentials or data. See [local plan](docs/NAVILO_PHASE2B_LOCAL_ISOLATION_FEASIBILITY.md). | Local Postgres/Auth actually start on loopback and both existing cloud project references remain unchanged. |
| TEST-02 / P1 | `scripts/phase2b_negative_tests.mjs` requires a hosted 20-character project ref and `<ref>.supabase.co` hostname; local URL is rejected. Existing calls are only a subset of 103 RPCs. | Implement guarded explicit local loopback mode and fixture provisioning with synthetic Auth users, positive controls, mutation denial and per-function coverage; keep remote production exclusion. | Fake remote/production endpoint refused; local signed-in roles obtain expected positive results and foreign/revoked/forged calls are denied with recorded actual results. |

Migration version collisions/empty placeholders (MIG-01) remain confirmed; no clean local replay or security vulnerability was inferred.

## ENV-02 root cause refinement — 2026-09-22

Official Supabase [billing guide](https://supabase.com/docs/guides/platform/billing-on-supabase) aggregates two active free projects across organizations where a member is Owner/Admin; [FAQ](https://supabase.com/docs/guides/platform/billing-faq) says every Owner/Admin member's limit is checked on creation. The failed NAVILO creation specifically named `salesconnect91-lab`; connector lists one NAVILO project and does not expose the separate Toqeer Builder organization. Thus account-wide quota is documented and implicated by the error, while Toqeer's membership/status/plan/project ID and any Toqeer-specific $0 quote are **unverified**. Do not treat a separate organization as an automatic free slot or attempt creation under the existing NAVILO authorization. No project will be paused/deleted. Acceptance for a future isolated environment: verify Toqeer org ID and membership, current plan, member-wide availability and project cost; obtain user approval specific to that organization, then provision without touching existing projects.

## Phase 2B free-project quota blocker — confirmed 2026-09-22

| ID / severity | Evidence and root cause | Impact and dependency | Resolution and acceptance test |
|---|---|---|---|
| ENV-02 / P0 release gate, provider quota (not a product security vulnerability) | Supabase project cost was re-quoted at $0/month for organization `mjjubagcqiqqoqujscba`; `confirm_cost` succeeded; `create_project(name=NAVILO-ISOLATED-UAT, region=ap-southeast-1)` returned `BadRequestException` that owner/admin `salesconnect91-lab` reached its two active free-project limit. No project ID was created. | Prevents migration replay, two-tenant synthetic fixtures and authenticated RPC negative tests. No source file/RPC/migration fix can bypass the account quota safely. | Owner frees a slot by pausing/deleting **another disposable project** (never NAVILO production), or connects a separate eligible free organization/project and authorizes its use. No paid option approved. Acceptance: project created at verified $0/month, different ref from production, isolated schema replay and JWT-backed denials actually executed and logged. |

Earlier ENV-01 wording that only cost/organization consent blocked provisioning is superseded by this attempted creation and quota response. All prior unexecuted test statuses remain BLOCKED.

## Phase 2B gate

**TEST-ENV-01 / P0 BLOCKED:** There is no isolated Supabase project/branch and no local PostgreSQL runtime. Project creation is quoted $0/month but requires user selection of organization and explicit cost confirmation; branch creation is quoted $0.01344/hour and was not requested. `docs/NAVILO_PHASE2B_TEST_PLAN_AND_RESULTS.md` records the exact next decision and fixture plan. Without an isolated environment, DB-01/DB-02 replay and TEN-01/SEC-01 authenticated negative cases are unexecuted. `scripts/phase2b_negative_tests.mjs` is a prepared safe harness; its production-ref guard passed locally, but its authorization outcomes are **not tested**.

## Phase 2A decisions

**DB-01 is now a confirmed repository integrity defect, not merely a count discrepancy.** Exact filenames, name mappings, hash comparison and three empty files appear in [the reconciliation](docs/NAVILO_PHASE2A_MIGRATION_RECONCILIATION.md) and [full CSV](docs/NAVILO_PHASE2A_MIGRATION_MATRIX.csv). Severity P0 release gate: nine duplicate version IDs can make clean migration playback ambiguous. `scripts/check_migration_versions.py` is a prepared, read-only guard that fails with all 12 findings; integrate it in CI only once historical version handling is resolved. Do not auto-rename live-applied versions or apply the 186 locally unmatched IDs to production.

**SEC-01 is a high-impact unverified exposure, not 103 confirmed vulnerabilities.** The [per-function review](docs/NAVILO_PHASE2A_RPC_MATRIX.md) and [guard analysis](docs/NAVILO_PHASE2A_SECURITY_REVIEW.md) show 103 direct authenticated grants, no anonymous/PUBLIC grants, fixed search paths and representative guards. No exploit was reproduced. Retain P0 **verification gate** for isolated role/tenant negative tests and nested call-graph review; do not revoke functions based on count alone.

**DB-02 / P0 — 61 textual differences in uniquely named, one-statement migration pairs.** Fourteen retain the same version ID; differences include comments/format or SQL, so semantic drift is not yet confirmed. Dependency: compare SQL AST or exact effective catalog, including RLS, functions, grants and indexes in isolated environments. Acceptance: every difference explained with a source-to-live mapping and reproducible isolated bootstrap/upgrade.

No issue below implies an unrun workflow passed. Severity is based on potential business impact and evidence; `BLOCKED` entries are evidence gaps, not demonstrated defects.

| ID / priority | Status; exact evidence | Root cause / business impact | Dependency, proposed fix and acceptance test |
|---|---|---|---|
| SEC-01 / P0 | PARTIAL: live SQL finds 103 `public` SECURITY DEFINER functions executable by authenticated; Supabase advisor flags same, zero anonymous | Elevated functions may bypass RLS; exploitability **unverified** | Export actual definitions/grants and assess each function's caller membership, company/BU/branch ownership, search_path and mutation guards; least privilege migration only after isolated rehearsal. Negative direct RPC calls from second tenant and restricted roles must fail without data changes. |
| DB-01 / P0 | BLOCKED: live `supabase_migrations.schema_migrations` count 430, latest 20260921204530; 262 SQL files locally, latest 20260919230000 | Branch/database version sets may differ; timestamps alone do not prove drift | Compare exact version/name lists and schema hashes against main/development; identify out-of-repo migrations and reconcile in a reviewed non-destructive plan. Rehearsal against isolated database passes before deployment. |
| TEN-01 / P0 | BLOCKED: RLS enabled on all 150 public tables, but only aggregate counts queried; `src/auth/FeatureAccess.tsx`, `src/App.tsx`, policies/RPCs need full review | Route hiding cannot enforce tenant isolation | Prepare two tenant users, two BU/branch roles and direct SQL/API denial matrix; verify all 37 views, 103 privileged RPCs, report exports and storage. No cross-tenant rows returned or mutated. |
| BAK-01 / P0 | BLOCKED: backup/restore only in `docs/NAVILO_UNIFIED_RELEASE_GATE.md`; no installed scheduler/USB/Drive or isolated restore evidence | Recovery cannot be asserted; destructive actions have irreversible loss risk | Inventory Supabase plan, database/storage volume, Windows device/USB/Drive access; design encrypted backup and retention; restore to isolated environment and reconcile accounting and tenant partitions. Never run on production as a test. |
| LANG-01 / P1 | CONFIRMED BUG: `src/App.tsx:99-100`, `src/components/Layout.tsx:17-97` hardcode English/Urdu simultaneously including navigation and loading/error states | Literal labels bypass selected-language runtime; English-only and Urdu-only display third/mixed text | Route all shell and fallback strings through verified selected packs; test en-only, ur-only and exact bilingual pairs in all states, including print/export. No dummy fallback. |
| CI-01 / P1 | CONFIRMED CONFIG GAP: `.github/workflows/build.yml` push filter excludes `work/dashboard-en-ur-20260921` | Branch pushes do not run the primary Build workflow | Include relevant development branches or require PR gate; confirm GitHub check on exact head SHA before release. |
| PERF-01 / P1 | CONFIRMED BUILD WARNING: `npm run check` generated 3,150.13 kB primary JS chunk (882.09 kB gzip) | `src/App.tsx` statically imports broad route tree; likely hurts loading especially mobile, performance effect unmeasured | Route splitting, lazy report/PDF/XLSX libraries, budget and real-device measurement. Verify routes still load and bundle budget met. |
| DES-01 / P1 | PARTIAL code evidence, visual BLOCKED: `src/components/Layout.tsx` 252/68 px sidebar with three nested levels and always bilingual long labels | Navigation density and hierarchy undermine scalability; actual appearance unverified | Apply shared design system and compact context-aware navigation after four-viewport screenshots and keyboard audit. Confirm scanability, overflow, focus, print isolation. |
| TAX-01 / P1 | BLOCKED: tax labels in `src/lib/jurisdictionConfig.ts`; no verified FBR integration/compliance evidence | Incorrect digital invoicing or provincial service tax applicability can prevent customer launch | Tax counsel defines customer/sector requirements using current FBR orders and provincial rules; trace invoice→integrator acknowledgment→correction/return. Validate sandbox then live authorized acceptance. |
| FLOW-01 / P1 | IMPLEMENTED BUT UNVERIFIED: sales/purchase/stock/accounting/returns/period controls across modules and migrations | Local unit tests do not establish posted accounting integrity | Isolated end-to-end fixtures: invoice/payment/return→stock→AR/AP→GL/VAT/report/print; balance and snapshots stay consistent; posted edit and closed-period attempts fail. |
| REP-01 / P2 | IMPLEMENTED BUT UNVERIFIED: `src/modules/reports/Reports.tsx`, `src/components/reports/ReportCustomizer.tsx` | Shared column order/export/print claims not measured | For every report compare displayed headers/cells/totals and CSV/PDF/print in both languages and role scopes. |
| IND-01 / P2 | PARTIAL: `src/App.tsx` gates production/cutting to steel; no dedicated construction project, POS or assets routes inventoried | Broad multi-industry offer needs distinct workflows | Launch common core with explicit supported sectors; specify and UAT separate retail, services, distribution, manufacturing and construction packs. |
| VIS-01 / P2 | BLOCKED: production browser opened login only; no authenticated AMK access | Dashboard, invoice, report and mobile/print quality cannot be asserted | Provide non-owner AMK test login through secure browser flow and safe fixture; capture 1440/1280/768/390 px plus PDF/print. |

## Cross-cutting verification matrix

- Owner/company/BU/branch: direct API read/write, forged IDs, role downgrade, revoked memberships, company switch and exports.
- Accounting: opening balance, balanced journal, immutable posting, reversal, close, AR/AP and inventory/COGS reconciliation.
- Documents: cash/credit/partial, With/Without Tax, fixed configured rate, charge and discount arithmetic, unique numbering, VAT print and authorized correction.
- Master names: duplicate concurrent creation, name-only selectors, posted snapshots after renaming, import/export round trip.
- Language: English default; single means exactly one pack; bilingual exactly two; UI, report, invoice, print/PDF and CSV/XLSX.

All these are acceptance tests to execute, not results.

## MIG-13 — Missing stock-movement traceability foundation blocks fresh replay

- **Status:** Confirmed bug; development repair prepared; fresh replay pending.
- **Severity:** Critical release blocker.
- **Evidence:** Windows fresh replay at `86b452b274d89ffea21d756b9f202b09607a0c35` failed in `20260913072054_correct_stock_approval_scope_and_validate_evidence.sql` with `42703: column sm.source_type does not exist`. Repository consumers existed before any local column creator. Read-only production history identifies exact omitted migration `20260906223502_control_manual_inventory_adjustments`; production catalog confirms nullable `source_type text` and `source_id uuid`.
- **Root cause:** Historical production migration existed but was absent from the repository export. The omitted migration provides five related columns (`reason`, `remarks`, `unit_cost`, `source_type`, `source_id`) plus the controlled adjustment RPC.
- **Fix:** Restore the exact evidenced migration as `supabase/migrations/20260906223502_control_manual_inventory_adjustments.sql`; require all columns, permission assertion and RPC markers in the SQL sanity gate.
- **Acceptance:** On a genuinely fresh local database, the migration applies before all consumers; the complete repository chain finishes; catalog assertions confirm the five columns; authenticated inventory tests prove tenant/BU/branch scope and denied forged/revoked-role calls.
- **Dependencies:** Windows Docker/Supabase CLI replay, then synthetic authenticated fixtures. Production migration history must remain unchanged.

## MIG-14 — Branch-isolation migrations exported under wrong versions

- **Status:** Confirmed bug; development filename reconciliation prepared; fresh replay pending.
- **Severity:** Critical release blocker.
- **Evidence:** Fresh replay at `0622440bdbc63a1e2131844b03d9e123235e37b7` failed with `42703` while indexing `consolidated_purchase_invoice_charges.operating_location_id`. The local column provider sorted later as `20260913103500`. Read-only live history records the same SQL bodies under versions `20260913073121`, `20260913073519`, and `20260913081611`; local bodies match their live MD5 values after ignoring the repository trailing newline.
- **Root cause:** Three correct historical SQL bodies were committed with incorrect timestamps, reversing provider/consumer execution order on a fresh database.
- **Fix:** Rename to exact live identities: `20260913073121_complete_transaction_branch_isolation_v2.sql`, `20260913073519_enforce_operating_location_write_scope_globally.sql`, and `20260913081611_index_branch_scoped_foreign_keys.sql`. Add a filename regression gate rejecting the three disproved identities.
- **Acceptance:** Fresh replay applies the branch column provider, global write scope, and indexes in order; the complete repository chain finishes; authenticated branch-negative tests pass. Production history remains unchanged.

## MIG-15 — Sales-core hardening migration rejects an already-hardened function

- **Status:** Confirmed replay compatibility bug; development repair prepared; fresh replay pending.
- **Severity:** Critical release blocker.
- **Evidence:** Fresh replay at `1f0a957a8b0eaff573b37468e3f80e4e02b77a47` advanced through `20260914212031` and failed in `20260914225847_restore_sales_post_tenant_user_resolution.sql` with SQLSTATE `P0001`. The restored `post_sales_invoice_core(uuid)` already has company/BU scoping, derives `v_user_id` from the locked invoice row, and rejects missing owner context, so the transformation correctly produced no text change but the migration raised unconditionally.
- **Root cause:** A later dynamic `pg_get_functiondef` text patch was non-idempotent against the exact secure final function definition restored earlier for clean-replay completeness.
- **Fix:** Treat only the explicitly verified secure final markers as a no-op. Otherwise retain the original transformation and mismatch exception. Add regression snippets/test so the final-state guard cannot be removed silently.
- **Acceptance:** Fresh replay applies `20260914225847` and the entire remaining chain; catalog definition still contains company/BU scope and invoice-owner resolution; authenticated cross-tenant/forged-invoice calls are denied without mutation.

## Phase 2B replay closure and next security gate — 2026-09-23

| ID / severity | Status and evidence | Remaining requirement |
|---|---|---|
| MIG-15 / P0 | **RESOLVED for clean replay.** At exact SHA `f6b3f4da1f7e29528e1ca9b4fca086e22e285f92`, fresh local initialization applied `20260914225847` and every later migration through `20260921204530`, then passed local service health checks. | Keep the fail-closed regression contract; run authenticated forged-invoice/RPC behavior tests before release. |
| DB-01 / P0 | **VERIFIED WORKING locally.** Complete clean migration replay passed on Windows Docker/Supabase CLI 2.117.0. | Hosted-production history remains intentionally unchanged; parity and deployment planning are separate gates. |
| TEST-03 / P0 | **PENDING, environment now available.** No JWT-backed tenant/BU/branch/RPC call was part of `supabase start`. | Run `scripts/phase2b_local_security_tests.mjs` on the local stack, record every expected/actual result, then expand failures and high-risk RPC coverage. |
| TEST-04 / P1 | Prepared local runner has a strict loopback `localhost:54321` guard, creates six Auth identities through the local Auth Admin API, provisions 2 companies × 2 BUs × 2 branches, keeps generated passwords in memory and prints no secrets/emails. `node --check` passes. | Actual execution is not yet a PASS. Confirm positive controls, foreign-company denial, same-company unassigned BU/branch denial, owner-only RPC denial, viewer denial, revoked membership denial and anonymous-grant denial. |
| TEST-05 / P1 | **Confirmed harness compatibility bug; repaired in development.** First run created only synthetic Auth identities, then first profile insert returned HTTP 400. Final local schema retains required `user_profiles.user_id` from migration `0005`; the runner provided only `id`. | Runner now sets `id=user_id` for every synthetic profile, avoids Windows `shell:true`, and exposes sanitized error code/message if another schema mismatch occurs. Acceptance requires rerun; no authorization result is claimed yet. |
| TEST-06 / P1 | **Confirmed Windows launcher regression; repaired in development.** At SHA `ee1f862…`, direct `spawnSync('npx.cmd', ..., shell:false)` returned nonzero before status parsing and was incorrectly summarized as stopped Supabase. | Use fixed `cmd.exe /d /s /c "npx supabase status -o env"` through `ComSpec`, with no interpolated input. Distinguish process launch failure, actual `supabase start is not running`, and other status exit. Rerun remains required. |
| TEST-07 / P1 | **Confirmed fixture idempotency bug; repaired in development.** At SHA `0294373…`, company membership trigger `trg_sync_default_business_unit_membership` created the default-BU row, then the runner's duplicate plain insert failed with `23505`. | Upsert BU memberships on the schema's exact `(business_unit_id,user_id)` unique key. Rerun must reach the authorization assertions before any security result is claimed. |
| TEST-08 / P1 | **Confirmed fixture context bug; repaired in development.** At SHA `db06c71…`, service-role customer insert hit the intended tenant trigger and failed with `P0001: No active company selected.` | Do not disable/bypass the trigger. Sign in the synthetic owner, call `set_current_company` separately for A/B, and insert each customer through authenticated REST. Rerun remains required. |

## Phase 2B targeted authentication result — 2026-09-23

| ID / severity | Final status and evidence | Remaining boundary |
|---|---|---|
| TEST-03 / P0 | **RESOLVED for targeted Phase 2B matrix.** Exact SHA `f4ddc905…`; 41/41 expected/actual tests PASS with positive controls and zero failures across two companies, BUs, branches, five tenant-role states and owner. | Do not generalize to all business-document RPCs or all 103 SECURITY DEFINER functions dynamically. |
| TEN-01 / P0 | **VERIFIED WORKING for tested surfaces.** Foreign company/customer reads returned zero; forged company/module helpers false; unassigned BU/branch switches denied. | Expand during domain UAT to reports/exports/storage and valid transaction rows. |
| SEC-01 / P0 | **VERIFIED WORKING for tested privilege cases.** Forged owner-only BU assignment denied for accounts/sales/viewer/tenantB; viewer post false; revoked access false/zero; anonymous helper HTTP 401. | High-impact posting, payment, reversal, reset and posted-document workflows require valid-document regression cases. |

## Phase 3 business correctness and replay/catalog reconciliation — 2026-09-23

| ID / severity | Status, evidence and root cause | Fix / acceptance |
|---|---|---|
| MIG-16 / P0 | **CONFIRMED BUG; development patch prepared.** Read-only production `pg_get_functiondef` shows tenant-aware `initialize_default_coa`, `post_journal_entry` and `reverse_manual_journal_entry` definitions not reproduced by the clean repository chain. Four relevant live migration versions are absent locally, so migration replay success alone masked effective-catalog drift. | Exact evidenced definitions plus fail-closed ACLs are restored in `20260923180627_restore_live_core_accounting_rpcs.sql`; SQL-sanity regression markers pass. Acceptance: apply on a fresh/local-only schema, compare function guards/ACLs, run journal and nested posting workflows. Never edit production migration history. |
| TEST-09 / P0 | **PREPARED, NOT EXECUTED.** Phase 2B did not test valid sales/purchase documents, balanced GL, stock/COGS, payments, returns, reversals, posted locks or closed periods. | Run `scripts/phase3_local_business_uat.mjs` only against loopback local Supabase. Every expected/actual assertion must be recorded; fix confirmed failures on development and rerun. |
| PERF-01 / P1 | **CONFIRMED.** Build passes but main JS is 3,150.13 kB minified / 882.09 kB gzip; CSS 270.33 kB / 38.96 kB gzip. | Add route/module code splitting and a measured bundle budget after correctness/security gates; acceptance requires browser performance evidence, not just a successful build. |
| MIG-17 / P0 | **CONFIRMED BUG; development repair prepared.** First Phase 3 run stopped before assertions with `PGRST204` because clean replay lacks `customers.account_id`. No repository migration creates the corresponding customer or supplier column, while later RPCs/UI require both. Live read-only catalog confirms nullable UUID columns plus `customers_account_id_fkey` and `suppliers_account_id_fkey` to `chart_of_accounts(id)`. | Restore both columns and exact constraints idempotently in `20260923182230_restore_customer_supplier_account_foundation.sql`. Acceptance: local migration applies, PostgREST sees both columns, fixture links AR/AP, and Phase 3 business assertions execute. Production remains unchanged. |
| TEST-10 / P1 | **CONFIRMED HARNESS BUG; repaired.** Second run reached warehouse creation, then `PGRST204` because the generic master fixture supplied `user_id`; repository and live catalog confirm `warehouses`/`godowns` have no owner column. | Remove explicit `user_id` from the shared master payload and rely on authenticated defaults only for legacy tables that require it. Acceptance: master fixture completes and business assertions begin. No schema migration. |
