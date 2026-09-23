# NAVILO Phase 2B — Migration Dependency Audit

Date: 2026-09-23  
Baseline: `70ccb704fb67fc38d5d6956107cea3a1f0268b61` on `work/dashboard-en-ur-20260921`

## Latest branch verification — 2026-09-23

Windows/VS Code work advanced the development branch by 120 commits to
`14b3f5e48da4e7a1e43df636ffa9ad941b1eeb4d`. This work was preserved and
independently checked before adding anything. On that exact head, the original
filename and SQL-sanity gates passed, while strict manifest checking retained
two apparent gaps and the expanded explicit-object scan found 33 order issues.
The optional guarded `accounts` compatibility table was removed from the
required manifest; Charge Master was a real pre-consumer gap.

The dependency closure added the early Charge Master and sales-consolidation
providers, exact missing live migrations, two exact `pg_get_functiondef`
providers for routines with no recorded creator, and the missing creator body
inside the existing print-language migration. Static closure is now 0 known
missing foundations and 0 explicit table/view/function DDL order findings.
Dynamic SQL remains outside the lexical check, so only a fresh reset can close
the runtime gate. Replay PASS is not claimed here.

## Result and root cause

The Windows fresh-start failure is a confirmed source-order defect. Migration
`20260830083000_0007_harden_sales_godown_posting.sql` references
`public.godowns`, but the repository contained no creator for `godowns` or its
parent `warehouses`. This is not a Docker/CLI problem.

No deleted creator was found: all-ref `git log -G/-S` searches returned nothing,
and initial commit `7b4c4f1` already contained the Godown/Warehouse UI and later
hardening migrations without the foundational DDL. Read-only production
migration history also has no recorded creator for these two tables. The
supported root cause is an incomplete migration export from a database where
the legacy master tables already existed.

Development migration 0002 now creates the earliest evidenced shape of
`categories`, `uom`, `warehouses`, `godowns` and `transporters`, before their
first consumers. Columns, defaults and `godowns.warehouse_id` were corroborated
from original UI/types, later constraint migrations and the read-only live
catalog. It does not copy production data or manufacture later tenant/language
state. Later migrations remain authoritative for that hardening.

Fresh replay is still **NOT VERIFIED / release-blocked**. This executor has no
Docker/Supabase CLI runtime, and later foundational DDL remains absent.

## Full known dependency chain

| Foundation | First local consumer / provenance | Status |
|---|---|---|
| `categories`, `uom`, `transporters` | `20260830233000_0020_secure_master_data.sql` | Repaired in 0002; ordering PASS |
| `warehouses`, `godowns` | `20260830083000_0007_harden_sales_godown_posting.sql` | Repaired in 0002; ordering PASS |
| `accounts` | `20260902123000_live_schema_compatibility.sql` | Creator missing |
| `charge_master` | `20260902090000_0046_hawala_aware_sales_posting.sql` | Legacy foundation restored at `20260902220000_restore_charge_master_foundation.sql` from verified live schema + later migration assumptions; clean replay pending |
| `companies` | local `20260904173000_saas_production_hardening.sql`; live creation `20260902214504 platform_owner_company_access_core` | Restored locally from exact read-only live migration history at `20260902214504_platform_owner_company_access_core.sql`; clean replay still pending |
| multi-service core: `operating_locations`, approvals and related accounting tables | local `20260905140000_multi_service_core_accounting_foundation.sql` is comments only; live `20260905103638` has 28,008-character DDL | DDL missing locally |
| consolidated purchase foundation | live `20260904112720 purchase_consolidated_invoice_workflow` has 21,361-character DDL | Live-only divergence |
| `user_language_preferences` | first local use `20260909082000...`; live creation `20260906161422` | Creator missing locally |
| `order_book_headers`/commitments | first local use `20260909082000...`; live creation `20260907111147` | Creator missing locally |
| `gate_pass_loading_instructions` | first local use `20260910013000...`; live creation `20260909214800` | Creator missing locally |
| `company_language_entitlements` | first local use `20260915183000...`; live creation `20260914181332` | Creator missing locally |

The live statements are provenance, not automatically safe patches: some
contain functions, policies and data updates. Recover them verbatim, review
dependencies and rehearse locally. Never edit production migration history.

## Duplicate IDs and empty files

Live history supplies distinct versions for all files involved in the nine
duplicate local timestamps. SQL bodies were not changed; filenames now use:

| Migration | Live version |
|---|---:|
| gate pass controlled reopen | `20260910103629` |
| first-kanta tare guard | `20260910111643` |
| journal location scope / write scope / numbering / fiscal close | `20260912191153`, `20260912191841`, `20260912192112`, `20260912192616` |
| company resource limits / anonymous definer revoke | `20260912203828`, `20260912205333` |
| language pairs / audit immutability / stock storage / number uniqueness | `20260913050702`, `20260913071342`, `20260913071528`, `20260913071713` |
| stock approval scope / branch isolation / parent lookup | `20260913072054`, `20260913072243`, `20260913075847` |
| permission helper / legacy owner helper / zero-discount guards | `20260913080206`, `20260913080248`, `20260913080418` |

Three zero-byte placeholders were removed because the matching non-empty change
and live version are known: scope-master uniqueness `20260916051608`, Urdu
backfill permission `20260916052758`, and owner onboarding/billing
`20260917063002`.

## Regression evidence and next step

`scripts/check_migration_versions.py` now reports 0 duplicate IDs and 0 empty
files. `scripts/check_migration_dependencies.py` verifies the five repaired
foundations and preserves nine known missing table foundations as explicit
debt. Normal mode detects regressions to the repaired contract; `--strict`
remains a failing release gate until all foundations are recovered.

After pulling this commit on Windows, run `npx supabase db reset --debug` against
the unlinked local stack and preserve the first failure. Do not reuse hosted
projects, remove foreign keys, or invent substitute tables. A complete replay
must not be reported PASS until a genuinely fresh database finishes.

## Windows replay continuation — migration 0003

The first actual replay after the foundation repair successfully applied 0001
and 0002, then failed in 0003 with `syntax error at or near "PKRPKR"`. The file
contained two `DO PKRPKR BEGIN ... END PKRPKR;` blocks from initial commit
`7b4c4f1`. Read-only production migration history records the same corrupted
text, confirming historical export/import corruption rather than a local edit.
PostgreSQL dollar quoting was restored to `DO $$ ... END $$;` in both blocks.
`scripts/check_migration_sql_sanity.py` and two tests now prevent that token from
returning. This repair does not prove later migrations replay successfully.

## Windows replay continuation — migration 0005

After the 0003 repair, Windows replay applied migrations 0001 through 0004 and
then failed while 0005 created `sales_invoice_financials`: column
`journal_entries.payment_mode` did not exist. Repository history contains no
creator, while the read-only production catalog shows legacy journal metadata
at ordinals 8–14, legacy journal-line party columns at ordinals 8–10, and sales
payment/account columns before later tenant fields. Frontend types and later
posting migrations require the same fields. Migration 0004 now restores these
columns after `chart_of_accounts` exists and before 0005/0007 consume them.
Foreign keys match the read-only live catalog. No production row or schema was
changed. The SQL sanity contract now fails if this legacy foundation regresses.

## Windows replay continuation — migration 0025

After the accounting-column repair, the actual fresh replay applied migrations
0001 through 0024. Migration 0025 then failed while adding
`items_warehouse_id_fkey` because `items.warehouse_id` did not exist. The
read-only live catalog confirms a nullable UUID column and a restrictive FK to
`warehouses(id)`; 0025 already defines that FK. Migration 0002 now restores only
the missing column alongside the legacy warehouse foundation, leaving 0025 to
apply the constraint. A regression contract checks the chronological provider.

## Windows replay continuation — migration 0026

The next fresh replay applied migrations 0001 through 0025. Migration 0026 then
failed while setting `warehouse_stock.warehouse_id`/`godown_id` NOT NULL because
the exported table lacked both columns; its next statement requires the same
pair on `stock_movements`. Read-only live catalog confirms all four UUID columns
and restrictive foreign keys to `warehouses`/`godowns`. No later repository
migration creates those constraints. Migration 0002 now restores the nullable
location columns and exact FKs; 0026 remains responsible for NOT NULL and stock
integrity. Regression checks cover both tables.

## Full-chain static pass after 0026 ACL failure

Replay then failed because 0026 revoked `apply_stock_movement` before 0027
creates it. Migration 0027 already applies the same PUBLIC/anon revokes and
authenticated grant, so only the premature 0026 ACL block was removed. A full
repository static pass was then run: it found the nine documented missing table
foundations and 77 ACL/ALTER-before-local-creator candidates. Those 77 are
triage candidates, not automatically confirmed defects; some are conditional
or depend on live-only migrations. Batch reconciliation is required before the
next replay is treated as a final attempt.
