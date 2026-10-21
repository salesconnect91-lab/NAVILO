# NAVILO — Multi-company launch gates

Status: **verification required for each new live company**. This document does not approve a release or authorize production migrations.

## Release gate A: infrastructure and recovery

- CI for the exact intended SHA passes. Production Vercel deployment uses that same SHA; no unresolved failed deploy.
- Supabase is reachable and health/performance advisories have been triaged.
- An independent encrypted database archive is created *daily* and **a full restore into an isolated database has succeeded**. Verify critical counts, account balances, and a documented recovery owner/time.
- A read-only security review has been run from `ops/audit/NAVILO-Tenant-Security-ReadOnly.sql`. Privileged function wrappers must be reviewed end-to-end; an executable function is not automatically vulnerable.
- No production schema or financial data changes without explicit acceptance. Never restore onto production as an experiment.

## Release gate B: company setup

- Company, owner, unique code, correct jurisdiction/currency, tax registration date (including historical dates if registered), licence expiry, and first active location validated.
- Correct type-specific modules (Transport; Steel/Production; Retail; Fuel; Construction; General Business), core accounting, mandatory mappings, active business unit and permissions.
- New owner login tested. Existing owner login reusable without overwriting credentials or losing access to other companies; failure cleanup verified **in isolated tests**.
- For live companies, test-company purge must never be used, even for a company being piloted with non-disposable financial records.
- Missing owner/branch/mapping checks return clear actionable errors, not silent defaults.

## Release gate C: finance and modules

- Test one Draft -> Post -> GL -> Report -> Payment -> Reconciliation journey for Sales and Purchase in an **isolated test tenant**.
- Journal bulk import: debit-credit, vehicle dimension, date, duplicate detection, validation messages, and double-post prevention.
- Currency, VAT, posted-document immutability, reversal flow, cash/bank, and opening balances reconciled with canonical GL.
- Steel/Production: inventory movement and valuation; Transport: original 28-column Register, trip/service accounting, PPR and vehicle P&L. Other business types must get a tailored acceptance matrix.
- Dashboard, Reports Center, Import Center, masters, all search dropdowns, and export/print verified for the enabled modules.
- Confirm invoice number policy and missing references company by company before any corrections. Do not transform test company findings into production corrections without approval.

## Release gate D: isolation / concurrency

- Two **authorized test accounts** scoped to separate disposable companies: Company A cannot read, update, export or search Company B's customers, ledgers, trips, invoice documents, payments, or files; repeat vice versa.
- Staff role cannot reach owner-only functions by direct RPC. Confirm company/BU/location permissions for every financial API.
- Simulate simultaneous saves/posts and duplicate imports in isolated environments; no double journal, duplicate allocation or cross-company contamination.
- Benchmark realistic dataset including the 16k+ trip scenario against acceptable UI timings; review I/O/timeouts and optimize without affecting accounting invariants.
- Record evidence (screenshots/logs where appropriate) and exact git SHA/DB migration baseline.

## Acceptance decision

**GO** only after all gates have evidence and no unresolved critical findings. Otherwise **NO GO** for new company activation, while existing safe business use can continue under monitoring. License renewal for Orbit Usman is handled by the customer and excluded from engineering scope.

Security note: as of the 21-Oct-2026 read-only audit, the three flagged SECURITY DEFINER views all contain company, BU, location and permission checks and have no anonymous SELECT grant. These are static indicators, *not proof* of effective RLS isolation for actual users; no privileges were changed.
