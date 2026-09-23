# Phase 3 local business UAT — plan and evidence

Date: 2026-09-23

Environment boundary: unlinked loopback Supabase only; synthetic data only

Production ref refused by runner: `ijdaosaqpbgnqojudjbj`

## Why this phase exists

Phase 2B proved a clean migration replay and 41 targeted authentication/isolation assertions. It did not prove valid business-document behavior. Phase 3 therefore exercises purchase, sales, inventory, AR, AP, journal, reversal, return, immutability, period-control and role/tenant-denial workflows with valid synthetic documents.

## Catalog reconciliation required before execution

Read-only production `pg_get_functiondef` evidence showed that repository replay did not reproduce the live tenant-aware definitions of three core accounting RPCs. Live fingerprints recorded during reconciliation were:

| Function | Live definition MD5 | Relevant live guard |
|---|---|---|
| `initialize_default_coa()` | `40dacec5...` | authenticated legacy user, current company and `accounting/create` |
| `post_journal_entry(uuid)` | `daf4a8ce...` | `accounting/post`, current company and current BU |
| `reverse_manual_journal_entry(uuid,date,text)` | `ed3b47fb...` | authenticated user, current company/BU, manual-only reversal |

Live migration versions `20260903004324`, `20260903010055`, `20260904221853` and `20260904222225` are absent from the repository. The repository later carried only partial/dynamic restoration logic, so a clean replay could pass while its effective catalog differed from production. `20260923180627_restore_live_core_accounting_rpcs.sql` restores the exact read-only catalog definitions and explicit authenticated/service-role ACLs on the development branch. It does not edit production history.

## Prepared local assertions

`scripts/phase3_local_business_uat.mjs` imports the already-proven Phase 2B local fixture code. It refuses non-loopback endpoints, creates new generated Auth credentials in process memory, prints no emails/passwords/keys/row IDs, and records sanitized expected/actual evidence.

The prepared matrix covers:

- valid purchase posting, stock increase, balanced AP journal and duplicate-post atomicity;
- posted purchase edit/delete denial, partial supplier payment, overpayment denial and reversal;
- valid credit sale, stock/COGS/revenue/AR journal, duplicate-post atomicity and immutability;
- partial customer receipt, over-allocation denial and reversal;
- cross-tenant and wrong-role posting attempts, revoked membership and anonymous RPC denial;
- sales and purchase returns plus over-return denial;
- unbalanced journal denial, balanced manual journal, immutability and single reversal;
- current-period close, closed-period posting denial and synthetic period reopen.

Independent areas continue after a failed positive workflow so one execution retains broad diagnostic value. A failed prerequisite marks its dependent return area failed instead of fabricating results.

## Verification completed before database execution

| Gate | Actual result | Status |
|---|---|---|
| Node syntax/import | Both runners parse; Phase 2B module imports without executing | PASS |
| Migration versions | 0 empty, 0 duplicate, 0 known misversioned files | PASS |
| SQL sanity | 0 findings, including tenant-guard markers for the restored RPCs | PASS |
| Strict dependency scan | 0 unresolved foundations | PASS |
| Explicit object order | 0 errors | PASS |
| Checker tests | 24 tests | PASS |
| TypeScript/application tests | Typecheck; 19 files / 81 tests | PASS |
| Production build | 3005 modules built | PASS with known 3,150.13 kB main-chunk warning |
| New migration on local Postgres | Requires Windows local stack | PENDING |
| Phase 3 expected/actual matrix | Requires Windows local stack | PENDING |

No Phase 3 database assertion is reported as passing until the generated JSON is captured. Production, `main`, Vercel and both hosted Supabase projects remain unchanged.

## First Windows execution — missing party account foundation

At exact development SHA `5a17460df05de4f400309b633c3de3b35e3c0fa9`, local migration `20260923180627` applied successfully and the local history reported up to date. The runner then stopped during fixture setup before its first assertion: PostgREST returned `PGRST204` because `customers.account_id` did not exist in the local schema cache.

This is a confirmed repository foundation defect, not a failed business assertion. Later receipt, payment, journal, opening-balance and UI code all require `customers.account_id` and `suppliers.account_id`, but no repository migration creates either column. Read-only production catalog evidence confirms both as nullable UUID columns with named foreign keys to `public.chart_of_accounts(id)` and no delete action. Their ordinal position immediately after the original table columns establishes that they belong to the missing pre-versioned baseline rather than a new feature.

Development migration `20260923182230_restore_customer_supplier_account_foundation.sql` restores both exact columns and constraints idempotently, then reloads the PostgREST schema. The Phase 3 business matrix remains **0 assertions executed / PENDING** until the repaired local rerun.

## Second Windows execution — master fixture shape repair

At exact SHA `5b9335260e33901fad6e87c92e8de3939f043912`, the party-account foundation migration applied successfully and PostgREST accepted the customer AR link. Fixture setup then stopped before assertion 1 with `PGRST204` because the shared master payload supplied `user_id` to `warehouses`.

Read-only production catalog and the repository table foundation agree that `warehouses` and `godowns` are company-scoped and have no `user_id`. This is a test-runner defect, not a missing database column. The runner no longer supplies `user_id` in the shared master payload. Legacy local tables that retain a required owner column populate it through their authenticated `auth.uid()` default; explicit `company_id` and the normal tenant trigger remain active. No schema migration was added for this error. Business assertions remain **0 executed / PENDING**.

## Third Windows execution — polymorphic trigger row contracts

At exact SHA `0e119a5477493a32f3d66b511ea094734f646bba`, fixture provisioning completed and the runner entered all five independent test areas. The result was **0/5 areas passed**: purchase, sales and role/tenant tests hit `42703: record "new" has no field "invoice_no"`; manual journal hit `42703: record "new" has no field "source_id"`; returns could not run because posted sale/purchase prerequisites failed. These five area results do not represent five independent defects.

Repository trace identifies two shared trigger row-contract defects. `apply_document_discount_total()` was attached to main and consolidated document tables but evaluated `NEW.order_no` and `NEW.invoice_no` in one SQL `CASE`; main sales/purchase rows have only `order_no`. `navilo_link_posting_traceability()` and `sync_commercial_transaction_link()` were attached to journal and stock tables but used table-specific fields in compound `AND`/`ELSIF` expressions; journal rows have `source_document_id`, not `source_id`.

Read-only production catalog confirms the intended column contracts and shows already-safer definitions for the discount and posting-link functions. It also exposes the same latent compound-condition risk in production's transaction-link synchronizer; production was not changed. Development migration `20260923183710_harden_polymorphic_trigger_row_contracts.sql` uses JSON field extraction for the main/consolidated document number and isolates every table-specific field behind a procedural `TG_TABLE_NAME` branch. It preserves `SECURITY DEFINER`, pinned `search_path`, existing triggers and revoked public/authenticated execution.

Post-change non-database gates: SQL sanity **0 findings**; **26/26** migration-checker tests; TypeScript; **19 files / 81 tests**; production build. The known 3,150.13 kB bundle warning remains. Actual migration execution and business assertions remain **PENDING Windows local rerun**; no business-UAT pass is claimed.

## Fourth Windows execution — 16/19 pass and two posting defects isolated

At exact SHA `01e0dd105582f0e63e127ba2a34f187cb918165e`, migration `20260923183710` applied successfully and the polymorphic-trigger failures disappeared. The repeat run was stable at **19 total / 16 pass / 3 fail**. Tenant isolation, viewer/accounts/sales/revoked/anonymous denials, unbalanced-journal atomicity, balanced posting, journal immutability, reversal and duplicate-reversal protection, accounting-year setup, period close, closed-period denial and reopen all passed.

The three failures reduce to two independent posting defects. Sales posting reads `sales_order_lines.description`, but clean replay lacks that column even though the read-only production catalog and frontend line editor contain it. Purchase posting changes the header to `posted`; an AFTER header trigger then writes historical-name snapshots to its child lines and is correctly rejected by the posted-line immutability trigger. Returns are only prerequisite-blocked because both source documents failed to post.

Development migration `20260923185524_restore_line_descriptions_and_prelock_snapshots.sql` restores the exact nullable `description text` columns evidenced on both live sales and purchase lines. It also moves both main-document line-snapshot triggers from AFTER to BEFORE the status transition, so snapshot writes occur while the parent is still draft and normal post-commit immutability remains intact. The Phase 3 runner now supplies a description and verifies item/unit/godown snapshots for each posted main document. Production remains unchanged; local execution is pending.
