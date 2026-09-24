# NAVILO Phase 2B — Migration Dependency Audit

## Windows replay continuation — controlled stock approval chain

Replay reached `20260913072054` before failing on absent `stock_movements.approval_slip_path`. Read-only production catalog and migration history identify the complete missing provenance: `20260906225648_secure_godown_transfer_with_approval_slip`, `20260906230719_require_stock_adjustment_approval_slip`, `20260907074107_enable_controlled_cross_warehouse_stock_transfer`, and `20260907074902_add_stock_transfer_numbers_v2`. Exact live SQL is restored at those versions, providing both nullable columns plus buckets, policies and controlled RPC evolution before later policy consumers. Full local replay is still the acceptance gate.

## Windows replay continuation — sales-posting rename collision

The restored sales core migration now applies, exposing an ordering assumption in the next wrapper migration: it tried to rename `post_sales_invoice(uuid)` to an already restored `post_sales_invoice_core(uuid)`. The wrapper now follows the same replay-safe pattern already used for return notes—rename only when the internal function is absent, then replace the public wrapper. Repository-wide function-rename review found no second unguarded rename-to-existing target.

## Windows replay continuation — restored function terminators

PostgreSQL reached the restored sales-posting function and failed at its following `revoke` because `$function$` lacked a terminating semicolon. Batch scan found the identical defect in the later restored return-note function. Both are corrected to `$function$;`, with a repository sanity guard. This fixes the evidenced syntax form only; complete replay remains the acceptance gate.

## Windows replay continuation — discount helper delimiter

The replay after MIG-08 advanced through `20260906225113`, proving the prior repair, then failed in `20260906232419_commercial_invoice_discounts_accounting.sql`. `discount_amount_for()` contained invalid `AS $` / `$;` delimiters. A scan across every repository migration found no other occurrence of this exact single-dollar pattern. The repair uses `$$` and adds a regression check, but only a complete fresh PostgreSQL replay can establish full syntactic and dependency validity.

## Windows replay continuation — print-language syntax marker

At development SHA `08e53252043e77cedae6e0fd670702b72265807e`, a fresh local start applied through `20260904151609` and failed in `20260904165202_restore_print_language_foundation.sql` on a literal `+create`. This was an accidental diff marker, not a missing schema dependency. The development repair removes only the marker and expands the SQL sanity checker so a leading patch marker before a SQL statement is rejected. The rest of the chain is still unverified pending a fresh Windows replay.

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

## Windows replay continuation — omitted stock movement source foundation

The replay at development SHA `86b452b274d89ffea21d756b9f202b09607a0c35`
successfully applied through `20260913072000`, including the restored stock
approval/transfer migrations, then failed while migration `20260913072054`
compiled a storage policy referencing `stock_movements.source_type`. PostgreSQL
reported `42703` because the fresh table had no such column.

Repository-wide search found consumers from September 6 onward but no local
column provider. Read-only production history identifies the exact omitted
provider as `20260906223502_control_manual_inventory_adjustments`. Its first
statement creates the related `reason`, `remarks`, `unit_cost`, `source_type`
and `source_id` columns and installs the permission-checked adjustment RPC.
Read-only catalog evidence confirms nullable `source_type text` and
`source_id uuid`. The exact historical migration has therefore been restored
before its consumers, and the SQL sanity contract now rejects an incomplete
version of this five-column/RPC foundation.

This is a repository export/history reconciliation only. Production was not
changed and no production rows were copied. Static checks cannot prove the
remaining chain; another genuinely fresh Windows replay is required.

Post-repair evidence: SQL sanity reported 0 findings; migration version check
reported 0 empty files and 0 duplicate IDs; strict dependency and explicit
object-order checks both reported 0 errors; 19 migration-checker unit tests
passed; and `npm run check` passed typecheck, 19 application test files / 81
tests, and Vite build. The known 3,150.13 kB primary bundle warning remains.

## Windows replay continuation — branch-isolation timestamp inversion

The next Windows replay at `0622440bdbc63a1e2131844b03d9e123235e37b7`
applied the restored stock source foundation and continued through
`20260913080500`. It then failed in the locally named branch-index migration
with `42703` because `consolidated_purchase_invoice_charges` did not yet have
`operating_location_id`.

The repository already contained the provider, but under timestamp
`20260913103500`, after the index consumer at `20260913082000`. Read-only live
history proved this was filename drift, not missing or invented SQL. After
removing each repository trailing newline, the three local bodies have the
exact live MD5 and length for:

| Exact live version | Migration | Role |
|---|---|---|
| `20260913073121` | `complete_transaction_branch_isolation_v2` | Adds/backfills child operating-location columns, triggers, RLS and indexes |
| `20260913073519` | `enforce_operating_location_write_scope_globally` | Enforces active-location write scope |
| `20260913081611` | `index_branch_scoped_foreign_keys` | Adds child operating-location indexes |

The development filenames now use those exact live identities, restoring
provider-before-consumer order without changing SQL. The version checker also
rejects the three disproved filenames. Post-reconciliation static evidence is
0 empty files, 0 duplicate IDs, 0 known misversioned files, 0 SQL-sanity
findings, 0 strict-dependency errors and 0 explicit object-order errors; all 22
migration-checker unit tests pass. Full PostgreSQL replay remains unverified.

## Windows replay continuation — already-hardened sales core

Replay at `1f0a957a8b0eaff573b37468e3f80e4e02b77a47` confirmed the reconciled
branch-isolation migrations apply in their live order. It advanced through
`20260914212031`, then migration `20260914225847` raised `P0001` because its
dynamic `pg_get_functiondef` replacement made no change.

This was not evidence that the required security behavior was absent. The
earlier exact core restoration already contains all intended final markers:
invoice selection is scoped to active company and business unit, `v_user_id`
is derived from the locked invoice row, and a missing invoice owner is rejected.
The later patch was written only for a pre-hardening body and was not
idempotent against the final definition.

Development now accepts a no-op only when all four explicit final-state markers
are present. Otherwise the original transformation runs and still raises if its
known legacy pattern does not match. A regression contract protects both the
final-state validation and the fail-closed unknown-pattern path. Static gates
remain clean and 23 migration-checker tests pass; only another full fresh replay
can prove the remaining chain.

## Full fresh replay result — PASS (2026-09-23)

Windows evidence at exact development SHA
`f6b3f4da1f7e29528e1ca9b4fca086e22e285f92` closes the repository dependency
replay gate. `npx supabase start --debug` initialized a new local database,
applied every migration from `20260821163309` through `20260921204530`, then
started the local stack and passed REST/Edge Function health checks. In
particular, the restored stock foundations, corrected branch ordering and
already-hardened sales-core compatibility migration all executed before their
consumers without error.

The warning for absent `supabase/seed.sql` means fixture seeding did not happen;
the Windows Analytics warning concerns an optional service and did not invalidate
the database replay. This result proves clean schema construction only. It does
not prove authenticated RLS/RPC isolation, production-history equivalence,
backup restoration or business-workflow correctness.
