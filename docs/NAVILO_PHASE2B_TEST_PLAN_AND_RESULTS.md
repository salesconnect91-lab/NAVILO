# Phase 2B isolated testing: preparation and truthful results — 2026-09-22

## Local Supabase path — 2026-09-22

After user confirmed a second existing Free project in the separate Toqeer Builder organization (region `ap-southeast-2`), neither existing project may be used, paused, deleted or reset. A disposable **unlinked local** Supabase CLI + Docker-compatible stack can provide independent Postgres/Auth without a paid Supabase project; this executor lacks the runtime, and user's Windows host prerequisites remain unverified. Read the [local isolation feasibility report](NAVILO_PHASE2B_LOCAL_ISOLATION_FEASIBILITY.md) for exact test scope, guard requirements and safe setup. Checker 2 unit tests and Node harness syntax passed on current code; migration checker exits 1 with 9 duplicate IDs and 3 empty SQL files. No DB replay/JWT/RPC test executed this continuation.

## Quota scope clarification — 2026-09-22

Supabase official [billing guide](https://supabase.com/docs/guides/platform/billing-on-supabase) applies its two-active-free-project quota across all organizations where the member is Owner/Admin, and its [FAQ](https://supabase.com/docs/guides/platform/billing-faq) also checks every Owner/Admin member's free limit. The rejection named member `salesconnect91-lab`. User says Toqeer Builder is a separate organization, but the connected list returns only NAVILO's organization and NAVILO project; the Toqeer organization ID, role, subscription, project status, availability and exact cost have **not** been verified. Earlier $0/month quote applied to the NAVILO organization only. An isolated project in Toqeer would use distinct Postgres/Auth/Storage but share that organization's administrators and billing governance. No project creation attempted in Toqeer. New Toqeer-specific authorization is required after read-only ID/plan/cost verification. All migration and authenticated-negative tests remain BLOCKED; no test rerun in this continuation.

## Provisioning result after user authorization — 2026-09-22

The user approved `NAVILO-ISOLATED-UAT` in `mjjubagcqiqqoqujscba`, `ap-southeast-1`, only at $0/month. A fresh project cost quote returned `$0/month`, and cost confirmation succeeded. The project creation attempt failed with `BadRequestException`: `salesconnect91-lab` has reached the maximum **two active free projects** across organizations it owns/administers; provider proposed deleting, pausing or upgrading a project. No isolated project ref exists, and no paid branch or replacement was attempted. The earlier paragraph below describes the historical preparation state and is superseded as to authorization and the attempted creation.

| Operation | Expected | Actual | Status |
|---|---|---|---|
| Quote separate project | Exactly $0/month | Supabase returned type project, recurrence monthly, amount 0 | PASS |
| Confirm quoted cost | Confirmation returned | Confirmation ID returned (not stored in repo) | PASS |
| Create approved project | New isolated ref, no paid cost | Provider rejected with member free-project quota error | BLOCKED |
| Migration replay and authenticated tenant/RPC tests | Synthetic isolated evidence | No isolated project exists | BLOCKED |

Next step requires owner action outside this repository: make one free project slot available by pausing/deleting a different disposable project, never production, or provide an eligible separate free organization/project and authorization. Re-quote before any retry. Existing local test results below were **not rerun** in this continuation.

## Isolation decision

Connected Supabase organization `mjjubagcqiqqoqujscba` (salesconnect91-lab's Org) is on the **free** plan. Its project list shows one active project, `ijdaosaqpbgnqojudjbj` (production), and zero development branches. The provider quoted **$0/month** to create a separate project in that organization and **$0.01344/hour** for a branch. The project creation connector requires the user to select an organization and confirm the quoted cost before creation. Neither new environment nor cost confirmation was performed. Docker, PostgreSQL server/client and Supabase CLI are unavailable in this executor. Therefore there was no safe isolated database to run migrations or authenticated RPC tests. The production project was never used as a test environment.

**One necessary user decision:** confirm that a new project named `NAVILO-ISOLATED-UAT` should be created in organization `salesconnect91-lab's Org` (`mjjubagcqiqqoqujscba`), region `ap-southeast-1`, at the quoted $0/month. It must contain synthetic data only. A project quota or provider confirmation may still block creation; do not silently switch to the paid branch. The name and region are proposals; user can specify another organization or region. No password or API secret should be pasted into chat.

## Already performed checks

| Test | Expected | Actual | Status |
|---|---|---|---|
| Production exclusion preflight, `node scripts/phase2b_negative_tests.mjs` with no test ref | Stop before network | Throws `A separate nonproduction project ref is required. Production ref is refused.` | PASS (local guard only) |
| `node --check scripts/phase2b_negative_tests.mjs` | Valid syntax | Exit 0 | PASS |
| Explicit production-ref rejection | Stop before network | Exit 1, `Production ref is refused.` | PASS (local guard only) |
| Existing `npm run check` | Typecheck, unit tests, build | Exit 0; 19 files/81 tests, 3005 modules built; primary JS 3150.13 kB / 882.09 kB gzip warning | PASS (local code only) |
| `python3 -m unittest discover -s scripts -p 'test_check_migration_versions.py' -v` | Checker fixture tests pass | 2 tests, OK | PASS |
| Migration version checker against repository | Flag collisions/empty files | Known 9 duplicates and 3 empty SQL files | EXPECTED FAIL; must resolve before clean replay |
| Isolated migration replay | Apply ordered files without errors | No isolated PostgreSQL | BLOCKED |
| Owner/accounts/sales/viewer/revoked-role authentication | Distinct synthetic JWTs | No isolated Auth project or users | BLOCKED |
| Cross-company/BU/branch negative probes | Denied or zero foreign rows | No isolated project or synthetic IDs | BLOCKED |
| Forged privileged RPC calls | No unauthorized mutation | No isolated project | BLOCKED |

## Synthetic fixture specification

Create two test companies `PHASE2B-A` and `PHASE2B-B`, each with two active business units and two active branches, one disposable customer per company and a draft invoice/journal/stock row for each scope. Roles: one platform owner, company A accounts, company A sales, company A viewer, company A user with deactivated membership, and company B tenant. Use the isolated Auth service, not SQL-inserted passwords. No production dump or AMK data. Keep credentials in short-lived local environment variables or secret manager; commit only UUID fixture references if explicitly synthetic, and keep test response evidence free of names/emails/tokens.

Prepared `scripts/phase2b_negative_tests.mjs` rejects the production ref even if configured, matches the URL host to the isolated ref, signs in with scoped test identities and records expected/actual results without printing credentials. It covers foreign-company rows, customer rows, BU, branch, company and module helpers, owner-only assignment, revoked-role reads and viewer post denial. A passing result on this small subset would not certify all 103 functions. Expand to domain-specific forged IDs and posted-document immutability after the isolated database works.

## Migration rehearsal method, not yet executed

1. Provision empty isolated project; record its ref and verify it differs from production. Export empty baseline metadata and set up disposable Auth users only after schema exists.
2. Copy repository migrations to a scratch-only worktree. Resolve nine duplicate IDs *in that scratch copy* with explicit unique ordering; decide how the three zero-byte placeholders map to their nonempty follow-ups. Record old→new mapping; never edit production history.
3. Run clean replay and record first failing migration, SQLSTATE, failing statement and schema state. Compare effective schema with live *read-only* catalog fingerprints, especially 61 text-different pairs, 24 repo-only names and 194 live-only names. A matching name or hash alone is not a semantic comparison.
4. Only after a successful isolated replay and regression tests, prepare versioned remediation files on the development branch. Do not apply any of them to production in Phase 2B.

## Confirmed root cause and limitations

Duplicate timestamps came from separate committed files: `20260910133500_fix_first_kanta_before_second_kanta.sql` was introduced by `2cd1abb`, while `20260910133500_gate_pass_controlled_reopen_for_correction.sql` came from `a9c5d9c`. Likewise `20260913081500_enforce_branch_read_write_isolation_on_operational_tables.sql` came from `22f05f9` and `20260913081500_enforce_navilo_language_pairs.sql` from `fc12d4c`. Empty `20260916051517_scope_master_uniqueness_by_company.sql` was committed in `73934ee`, alongside a later nonempty file `20260916051519_...`. This explains the repository filename collision/placeholder pattern; it does **not** prove which SQL ran live or establish a safe final numbering scheme. Actual migration playback and authorization behavior remain blocked.

## Executed clean replay and local Auth test preparation — 2026-09-23

The earlier blocked/duplicate state above is historical. After explicit dependency restoration and version reconciliation, the user ran a genuinely fresh local initialization at SHA `f6b3f4da1f7e29528e1ca9b4fca086e22e285f92`. Every migration applied through repository latest `20260921204530`, containers started and local REST/Function health checks passed. Clean migration replay is therefore **PASS**. Production history was not edited and no hosted project was used.

| Test | Expected | Actual | Status |
|---|---|---|---|
| Fresh repository migration replay | Entire ordered chain applies to empty local DB | Applied first through latest migration; local setup started and health checks completed | PASS |
| Optional seed | Seed synthetic fixtures | `supabase/seed.sql` absent | NOT RUN / not a replay failure |
| Authenticated negative matrix | JWT-backed expected/actual evidence | No identities or fixtures existed during start | PENDING |
| Local runner syntax | Valid Node script without external package dependency | `node --check scripts/phase2b_local_security_tests.mjs` exit 0 | PASS |

The local runner obtains the local API/publishable/secret values by invoking `supabase status -o env` itself and never prints them. It hard-refuses any hostname other than `localhost`/`127.0.0.1` on port `54321`, generates six synthetic Auth identities through the Auth Admin API, retains passwords only in process memory, and prints sanitized expected/actual evidence. It provisions two companies, two business units and two branches per company; tests foreign-company/customer access, unassigned same-company BU/branch switching, forged owner-only assignment, viewer post denial, revoked access, owner positive control and anonymous helper denial. This subset does not certify all 103 functions.
