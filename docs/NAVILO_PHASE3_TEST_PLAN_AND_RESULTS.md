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
