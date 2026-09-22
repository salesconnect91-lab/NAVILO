# Phase 2A: migration reconciliation — read-only snapshot 2026-09-22

Sources: development commit `eee4f41ee40a9be1c757e7fe7596450eabe2c3b3`, `supabase/migrations/*.sql`; live `supabase_migrations.schema_migrations` of project `ijdaosaqpbgnqojudjbj`. Full **exact 692-row** source matrix: [NAVILO_PHASE2A_MIGRATION_MATRIX.csv](NAVILO_PHASE2A_MIGRATION_MATRIX.csv) (262 repository files + 430 live history rows). The CSV records each version, name, statement count where available, raw and whitespace-normalized MD5, presence in the other source and duplicate markers. It is a comparison snapshot, never a migration plan.

| Measurement | Result | Meaning |
|---|---:|---|
| Repository SQL files / unique versions | 262 / 253 | Nine version IDs are duplicated across two different filenames. |
| Live history / unique versions | 430 / 430 | Live IDs are individually unique. |
| Exact version intersections | 76 repository files | Name matches on all 76 shared IDs. |
| Repository files whose version is absent live | 186 | 162 have a name present under a different live version; 24 have no exact live name. Never treat 186 as unapplied SQL. |
| Live versions absent by ID in repository | 354 | About 160 live rows have a name present in local files; 194 live names have no exact repository name. Never treat 354 as unrelated live changes without content/schema comparison. |
| Unique-name, one-statement text comparisons | 201 pairs | 140 whitespace-stripped MD5 matches; 61 differ, including 14 with the *same* version. Difference can be comments, statement packaging or SQL; it does not prove live schema drift. |
| Other pairs | 61 repository files | Multiple statements, ambiguous names, or absent names cannot use the simple one-statement hash comparison. |

## Concrete repository defects

`scripts/check_migration_versions.py` returns exit 1 on the current checkout, finding duplicate versions `20260910133500`, `20260912205500`, `20260912222500`, `20260912223000`, `20260913074500`, `20260913075500`, `20260913080000`, `20260913081000`, `20260913081500`; exact filename pairs are in the checker output and CSV. Three empty SQL files: `20260916051517_scope_master_uniqueness_by_company.sql`, `20260916052711_require_master_edit_for_urdu_backfill.sql`, `20260917062341_platform_owner_onboarding_billing_licensing.sql`. Their neighboring nonempty files may be deliberate follow-ups, but the zero-byte files and collisions require an explicit migration-history decision.

Examples of actual content mismatches: `20260915183500_priority1_security_invoker_reporting_views.sql` includes a leading comment and fewer explicit privilege revocations than its live same-name entry `20260915182546`; compare effective view ACL and RLS before proposing a replacement. The local `20260916051517_scope_master_uniqueness_by_company.sql` is empty while the live same-name entry `20260916051608` includes index changes; another nonempty local file `20260916051519_...` contains related SQL. This confirms history/file divergence, **not** that live indexes are missing. The repo name `20260919230000_scope_language_entitlements_to_pakistan_en_ur` appears live as `20260921203948` with matching inspected SQL; the later live-only `20260921204530_limit_company_languages_to_english_urdu` has no repo counterpart.

## Safe resolution before any migration

1. Preserve immutable exports of both version/name/statement histories. Review the 24 repo-only names, 194 live-only names, and 61 hash differences in the matrix against actual live schema definitions; compare compound statement arrays properly.
2. In an isolated clone, explicitly assign unique version IDs to the nine collisions with a documented mapping. Decide whether three empty placeholders should be retained as historical markers or removed from migration input, based on migration ledger and team history. Do not rename a live-applied migration casually.
3. Rehearse clean bootstrap and upgrade from a production-shaped *isolated* database; compare tables, policies, views, functions, indexes and grants, plus tenant/accounting invariants. Fail the release on any unexplained difference.
4. Introduce the filename checker as a CI gate after historical collisions are resolved; it currently fails as intended. No production migration was applied in this audit.
