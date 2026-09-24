# NAVILO Work Mode handoff — 2026-09-24

This is a checkpoint, not a release certificate. Production database changes were not made in this work session. No production data was copied to local Supabase.

## Exact state

| Environment | State |
| --- | --- |
| GitHub `main` | Permission route fixes `5561d15ad4e19c81b55348fb83443e52cc1ea472` (custom module view override) and `0cd6e7cfcb4241e417fea5423c3903dccafc2ac2` (Salesperson Ledger requires Reports access). Local `npm run check` passed: 26 files, 100 tests, TypeScript and Vite build. |
| GitHub `work/fiscal-manufacturing-rehearsal-20260924` | Fiscal/manufacturing migrations, onboarding fix `fedb7e9c021dbb8e8b0f9ace0c6ddeac6933bff6`, rollback-only local unit test `cc902191af835d61d8b157d6926c7d5307527a98`, non-tax sales guard `594d58f5989c4fdb0eb14674495b515045470ce2`, and latest BU RPC authorization migration `566aa5d33710288a88ac1b71d67b4a34d9d74581`. The handoff commit follows these. |
| User's Windows rehearsal | `C:\NAVILO-rehearsal-20260924`; local Supabase API port 55431 and DB port 55432. Full `supabase db reset` replay passed through migration 20260924163000. Default BU SQL test returned PASS and ROLLBACK. Migration 20260924163500 has NOT been replayed or role-tested yet. |
| Supabase production | Read-only review only. None of the rehearsal migrations below was applied. |
| Vercel production | Release status of latest main commits not confirmed; GitHub Actions commit lookup returned no associated PR-triggered workflow runs. Do not infer that a GitHub commit is deployed. |

## Rehearsal migrations not applied to production

1. `20260924142500_restore_item_category_link.sql`: missing item/category link from original migration export.
2. `20260924145738_company_tax_currency_foundation.sql`: append-only tax events, as-of tax lookup, currency registry, company base currency and FX rates.
3. `20260924161000_preserve_work_order_planned_quantity.sql`: avoid overwriting planned work-order quantity with accepted production output.
4. `20260924162000_scope_item_category_to_company.sql`: future item/category links must share company (NOT VALID FK leaves historical rows unvalidated).
5. `20260924162500_sync_accounting_base_currency.sql`: align company and accounting-policy base currency without changing posted journals.
6. `20260924163000_enforce_non_tax_sales_effective_date.sql`: prohibit new Tax Invoices in an effective Non-Tax period; existing posted rows are untouched.
7. `20260924163500_enforce_business_unit_rpc_entitlements.sql`: require active BU membership and enabled BU module for backend module permission. SQL parser passed; local replay and synthetic role tests pending.

These seven migrations and the onboarding Edge Function change must be reviewed together before any production promotion. The new `company_tax_events` table is used by onboarding; deploying the function independently of its database migration is unsafe. Replaying migrations verifies installation only, not functional correctness or safety on existing production rows.

## Known gaps and risks

- `has_module_permission` formerly fell back to company membership when an active BU had no membership, and did not check `business_unit_modules`. The new migration closes these paths but needs isolated authenticated role tests; generic feature-level entitlement checks still require mapping each RPC/table operation to a feature.
- SECURITY DEFINER advisor warnings remain; do not bulk-revoke execution from operational RPCs. Audit each privileged function's grants, active-company/BU checks, and callable roles.
- Tax events are append-only and date-based; the sales guard covers main and consolidated sales. Purchase treatment, credit notes, returns, and a full Non-Tax to Registered end-to-end posting scenario still need verification. Existing posted documents retain stored invoice type and amounts; that historical invariant has not yet been proved with synthetic posting tests.
- `company_exchange_rates` and older `currency_rates` both exist. Transaction currency, journal rate snapshots, base-amount balancing, realized/unrealized FX gains and reporting are not complete. Do not enable foreign-currency posting until the journal bridge is implemented and tested.
- Manufacturing reserved material/quantity migrations replay, but material issue, output, scrap/rework, costs and accounting have not passed a full synthetic posting chain.
- The onboarding Edge Function fix reuses the database-created default BU and its membership. Local SQL verified the default BU update; full Auth/Edge Function onboarding transaction is untested.
- The item/category composite FK is `NOT VALID`: it enforces future writes but historical mismatches need a read-only production preflight before validation.
- Production deployment and production DB promotion have not been verified or performed. Never claim NAVILO live or complete on the strength of local build/replay.

## Remaining work by execution mode

### A. Normal ChatGPT + local PowerShell/browser, manual phase

- Run the exact local DB replay and the rollback-only BU SQL test below. Send errors and final output. Later test authenticated company-owner, employee and revoked-role sessions in local rehearsal, including direct URLs and direct API calls.
- Manual browser UAT: invoices, reports, language, print/PDF, Excel, layout, Fleet, bank import, emails/WhatsApp after provider setup, and Backup/Restore. Keep this outside remaining Work Mode credits.
- Inspect production deployment commit and perform release review after all backend gates; no production DB writes without a reviewed migration plan.

### B. Work Mode / connected tools later

- Automate two-company/two-BU/two-branch RLS and RPC authorization checks for viewer, accountant, owner, revoked user and platform owner; resolve findings.
- Synthetic tax-transition posting with document dates before/after effective date and historical posted-row comparisons; include returns and credit notes.
- Implement transaction currency, posting-time immutable FX snapshot, base amount journal balance and FX gain/loss bridge; reconcile the older `currency_rates` table.
- Synthetic sales/purchase/returns/manufacturing stock-to-journal posting assertions and ledger reconciliation; repair proven discrepancies.
- Review SECURITY DEFINER functions and Edge Function authorization individually; validate untrusted IDs and direct API access.
- Correct report formulas/data and build saved/custom report backend if not safely achievable manually; performance/index profiling of confirmed hotspots.

### C. External provider/account required

- Email/WhatsApp sending requires provider accounts, API keys, verified sender/domain/number and delivery-webhook setup.
- Production deployment verification requires healthy Vercel build availability; no paid upgrade was authorized.

## Exact next local test sequence

In the existing VS Code PowerShell terminal for the rehearsal clone only:

```powershell
Set-Location C:\NAVILO-rehearsal-20260924
git pull
npx.cmd supabase db reset
Get-Content -Raw .\supabase\tests\onboarding_default_unit_rehearsal.sql | docker exec -i supabase_db_NAVILO-rehearsal-20260924 psql -U postgres -d postgres -v ON_ERROR_STOP=1
npm.cmd ci
npm.cmd run check
```

Expected DB lines: `Applying migration 20260924163500...`, `Finished supabase db reset`, `PASS: one default unit bootstrapped and updated in place`, `ROLLBACK`. The SQL test rolls back its synthetic company. Stop on any error and inspect it before proceeding. Do not use `supabase db push`, link to production, or copy production records.

After this, prepare a separate isolated synthetic authentication fixture for the BU-RPC matrix; running SQL as `postgres` alone bypasses RLS and cannot prove tenant isolation. Production promotion requires a fresh read-only schema/data preflight and release decision.
