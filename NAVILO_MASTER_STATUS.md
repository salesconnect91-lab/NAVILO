# NAVILO Master Status & Handoff

Last updated: 2026-10-28  
Source of truth: repository `salesconnect91-lab/NAVILO`, branch `main`  
Production URL: https://navilo.vercel.app

> This is a living checklist, not a claim that every item is complete. Mark an item **PASS** only after evidence (tests, code inspection, or authenticated UAT) is recorded. Never make destructive production changes as part of an audit. Preserve existing NAVILO modules, tenant data, and Transport Register logic; do not rebuild the ERP.

## Current code / release checkpoint

- Journal Import continuation-date fix: PR [#33](https://github.com/salesconnect91-lab/NAVILO/pull/33), branch `fix/journal-import-continuation-date`, commit `689e9af8b6ac6358f6b26bc853f28cf98ed12bfa`.
- CI for PR #33: [run 40744990942](https://github.com/salesconnect91-lab/NAVILO/actions/runs/40744990942) — **PASS** as of this update. PR is still open; do not treat the fix as live until merged and production deployment verified.
- Existing detailed records: [NAVILO_AUDIT.md](NAVILO_AUDIT.md), [NAVILO_ISSUES.md](NAVILO_ISSUES.md), [NAVILO_HANDOFF.md](NAVILO_HANDOFF.md), [SUPABASE_DEPLOYMENT_CHECKLIST.md](SUPABASE_DEPLOYMENT_CHECKLIST.md). Keep these detailed evidence logs; this file is the top-level index.

## Priority 0 — Launch blockers

- [ ] **IMP-01 — Journal Import date validation:** reproduce the user's file with `2026-09-02`; first row must validate as ISO `YYYY-MM-DD`; continuation rows with blank dates inherit only within the same journal; a new journal with a blank first-row date must still fail. Test XLSX and CSV.
- [ ] **IMP-02 — Confirm the canonical import template:** user-requested visible template is exactly `entry_no, entry_date, account_name, line_description, debit, credit`. Remove `party`, `party_type`, `party_name`, and `vehicle_no` from the visible JE import pattern unless a documented, user-approved reason requires them. Update sample/template, parser, validation, and tests together.
- [ ] **ACC-01 — Accounting source and mapping:** invoices are the source of income/expense and VAT; journal entries are for money movements. Validate COA mappings, posting paths, VAT, GL, Trial Balance, P&L, Balance Sheet, and Cash Flow against the same test transactions.
- [ ] **REP-01 — P&L presentation:** vehicle rows show vehicle number and vehicle type in the required sequence; show Other Income (trip services) and Expenses; provide Balance-Sheet-like show/hide-zero-row customization. Verify totals reconcile to the ledger.
- [ ] **TR-01 — Transport Register end-to-end:** audit actual register data, filters/reset, all 28-column layout, add/edit/delete, rates, customer/supplier, vehicle/driver/route/location/owner, PPR/remarks/charges, popup save/cancel/reopen/refresh, and company scoping. Do not assume prior work is complete without current verification.
- [ ] **TR-02 — Billing lifecycle:** user-entered invoice numbers; combine multiple trips into one invoice and split/reassign trips later; drafts remain drafts until posted; draft deletion; customer/supplier parity; credit/debit note clears the register invoice reference as specified; cash counter updates; posted invoice updates ledger/VAT/P&L.
- [ ] **SEC-01 — Posted-data permissions:** only main owner/admin and explicitly delegated company admins may edit/delete posted records; ordinary users blocked; tenant-scoped authorization enforced server-side; audit history records actor, time, before/after and restore/open/edit visibility. No reversal-entry workaround.
- [ ] **REL-01 — Release verification:** CI/build pass, relevant regression tests pass, production deployment points to expected commit, authenticated smoke tests pass, and no critical console/network/runtime errors. Do not declare launch-ready until evidence is recorded.

## Priority 1 — Transport operations and performance

- [ ] **TR-03 — Workflow/statuses:** verify Draft → Incomplete → Complete → Locked → Settled; prevent premature posting/settlement.
- [ ] **TR-04 — Cash Counter:** finalized customer receivables and supplier payables only; trace every displayed amount to source trips/invoices and ledger; test cash and credit cases.
- [ ] **TR-05 — All-company parity:** fix once for all companies, not only Gondal test company. Specifically recheck Twakkal Al Khaleej trip visibility after clearing filters; distinguish an actual missing-data defect from a filter state.
- [ ] **TR-06 — Responsiveness:** measure search, sort, filter, popup open, import/export and bulk operations with representative large data (target scale up to 200,000 trips); no duplicate popup opening or long UI freezes; show progress where an operation is legitimately long.
- [ ] **TR-07 — VAT and rates:** cash trip VAT zero; credit trip VAT automatic per company setting; editable before posting; supplier bills support recoverable VAT without forcing AP when paid cash.
- [ ] **TR-08 — Audit and data integrity:** verify add/edit/delete and invoice regrouping leave correct audit history and no orphaned invoice/register references.

## Priority 1 — Accounting rules and controls

- [ ] **ACC-02 — Vehicle accounting:** one ledger/account per vehicle with debit and credit activity; do not create separate vehicle revenue/expense accounts or an extra “vehicle expense” section. P&L must still show vehicle number and type.
- [ ] **ACC-03 — Chart of Accounts dropdowns:** show posting accounts, hide non-postable group headers; no duplicate/hidden group account entries; no account codes alongside account names where not wanted.
- [ ] **ACC-04 — Voucher numbering:** short editable `JE-000001` style, editable from entry form, not long generated IDs.
- [ ] **ACC-05 — Payments/receipts:** generate professional payment/receipt voucher slips; verify opening balances can be cleared through correct payment/receipt flows and ledgers reconcile.
- [ ] **ACC-06 — Opening balances and period:** opening balances begin 2026-09-01 from August closing balances; SAR currency and Head Office branch; VAT rate is company-configurable (Orbit currently 15%, not a global hard-coded assumption).
- [ ] **ACC-07 — Posted record control:** main admin/owner and delegated company admin only; preserve audit trail and do not use reversal entries as a substitute for authorized editing/deletion.

## Priority 1 — Reports, UI and module-wide audit

- [ ] **UX-01 — Compact professional ERP layout:** remove unnecessary whitespace/oversized cards and duplicate controls; maximize useful rows at 1366×768; consistent dark headers and subtle gridlines; keep working module logic intact.
- [ ] **UX-02 — Shared table behavior:** verify search, sort, filter, column resize/move/show-hide and compact display across operational tables.
- [ ] **UX-03 — Module-by-module audit:** Dashboard, Sales, Purchase, Accounting, Inventory/Godown, Production/Cutting, Steel, Transport, Master Data, Reports, Imports, Settings and Owner Controls; remove duplicates and missing links without creating parallel accounting engines.
- [ ] **REP-02 — Report integrity:** reconcile report totals to ledger/source transactions; show/hide zero rows, saved presentation settings, vehicle type/number, and correct ordering; test CSV/Excel/print output.
- [ ] **UX-04 — Responsive review:** visual/authenticated checks at desktop, tablet and mobile widths. Existing report changes in historical docs are not considered production-verified without fresh evidence.

## Priority 2 — Security, infrastructure and operations

- [ ] **SEC-02 — Tenant isolation:** test owner, company admin, delegated admin and ordinary user roles across company boundaries; verify server-side/RLS enforcement, not just hidden buttons.
- [ ] **OPS-01 — Backups/restore:** document and test daily database backups to local USB/OneDrive; confirm retention, encryption and a restore drill. Existing local backup setup notes include `E:\NAVILO-Backups` and a 1 TB USB drive; verify current state rather than assuming jobs are running.
- [ ] **OPS-02 — Performance/stability:** track Supabase resource pressure and timeouts (support reference SU-511039); measure slow queries and bulk operations before changing indexes/configuration.
- [ ] **OPS-03 — Release/rollback:** record source commit, deployment ID, smoke-test evidence, and rollback path for each production release.

## Acceptance rules

1. No production database writes, schema/RPC/config changes, or destructive data edits during forensic audit without explicit approval for that exact change.
2. Use synthetic/test company data for destructive A–Z tests where possible; preserve real records.
3. Every defect should have evidence, root cause, impact, affected file/function, proposed fix, and regression test; use stable IDs (e.g. IMP-01, TR-01, ACC-01).
4. Do not mark a feature PASS based only on code presence or a successful build. Include authenticated UAT evidence for workflows and permissions.
5. A PR passing CI is not the same as merged, deployed, or production-verified.
6. Continue in this repository and existing application; no rebuild, unrelated modules, duplicate accounting systems, or MetalForge/Bolt branding.

## Next action

1. Finish review of PR #33, including the edge case where a new journal starts with a blank date.
2. Resolve the canonical six-column JE import template and test CSV/XLSX using the user's exact file pattern.
3. Continue P0 Transport Register, P&L and posted-permission checks, recording evidence and status here and in the detailed issue register.
