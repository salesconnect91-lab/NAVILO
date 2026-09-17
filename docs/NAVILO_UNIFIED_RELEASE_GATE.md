# NAVILO unified release gate

Status: **OPEN — NOT APPROVED FOR PRODUCTION**. This register is a scope and evidence checklist, not a claim that any item is implemented, tested or deployed. Keep `main` and production unchanged until all mandatory gates pass. Update `docs/NAVILO_MASTER_RULES.md` when implementing a new permanent rule.

## Evidence convention

For every row record: code path/commit, database migration or RPC, automated test output, isolated UAT evidence, production verification, owner, and status (`not inspected`, `existing / unverified`, `fix required`, `verified`, `blocked`). Never mark verified based solely on UI appearance, a checkbox or a successful HTTP response. Preserve working behavior; investigate root cause before patching.

## Workstreams (all mandatory)

1. **Baseline and ownership:** capture exact GitHub main SHA, deployed Vercel SHA, Supabase migration state, tenant inventory and permissions. Identify existing functionality before changing it. Verify owner/company/BU/branch isolation, onboarding, role entitlements, branding, subscriptions, audit logs, Platform Reports and owner-only deletion controls.
2. **Language and master data:** single-language English must not render unenabled Urdu/Arabic in screen, print, PDF or export; bilingual only selected packs. Names render without appended internal account codes. Verify shared selectors, rename snapshots on posted documents, auto-conversion, duplicates, imports and historical integrity.
3. **Accounting:** COA hierarchy and bank accounts, mapping UI, opening balances, draft/post/reversal, period close, AR/AP, cash/bank, VAT, inventory, COGS, journal/ledger/trial balance/P&L/balance sheet and reconciliations. Never mutate posted records through an ordinary reset/correction.
4. **Sales and purchase:** With Tax/Without Tax independent of payment mode; fixed tax; VAT on preview/print; main and consolidated documents distinct; purchase-order/invoice parity; charges by weight; document numbering; cash/credit/tax history in the same customer ledger; refunds/returns and posted locks.
5. **Operations:** stock in/out, warehouse transfers, purchase receipt, sales dispatch, cutting, loading, work orders, furnace yield, scrap, valuation and BU/branch isolation.
6. **UI and reporting:** unified dashboard/search, headers/action ordering, print layout/logo/page breaks, report column/header/total/export parity, salesperson receipts and debit/credit totals, filter and column visibility, CSV/Excel/PDF/Word/print capability checks, responsive and error states.
7. **Security and SaaS:** RLS, grants, SECURITY DEFINER RPC review, least-privilege owner controls, company provisioning, subscription limits, session/reset-password flows, audit logs and cross-tenant negative tests.
8. **Backup foundation:** inspect actual Supabase backup capabilities, database size, Storage buckets, free-plan constraints, Google Drive access/capacity, Windows machine and USB capacity. Never assume these exist. Implement scheduled encrypted DB + Storage backups, code/migration/config manifest, integrity checks, USB and Drive copies, 90-day retention subject to legal holds, missed-run retry and alerting. Keep credentials and encryption keys out of frontend/repo.
9. **Recovery:** isolated monthly full restore test; verify database/files/app compatibility, RPO/RTO, accounting and tenant isolation. Selective company/BU/branch multi-select must preview missing/changed/conflicting rows, follow foreign-key and accounting dependencies, control concurrent posting, preserve unaffected tenants, block unsafe operations and reconcile before/after totals. User attribution is not ownership of business transactions; never overwrite passwords from old backups. A browser cannot directly run a Windows scheduler or access a USB drive: require separately installed, securely paired local agent and truthful status telemetry.
10. **Reset/deletion:** inspect actual `platform-admin` backend and `TransactionResetControl` before changing them. Backup prerequisite, preview, typed confirmation, explicit owner authorization, immutable audit, transaction scope and preservation of master data/settings/COA/users, document sequence and opening-balance policy. Never execute destructive production actions during audit/UAT without a separately verified safe scope and authorization.

## One coordinated release — mandatory gates

- [ ] Baseline and deployment identity captured; no unreviewed concurrent changes.
- [ ] Each workstream has code/database evidence and passed relevant automated tests.
- [ ] Build/typecheck/test results recorded; no known blocking failures.
- [ ] Database migrations rehearsed on an isolated environment with rollback plan.
- [ ] Verified encrypted backup exists **before** any destructive operation; successful isolated restore demonstrated.
- [ ] Security, permissions and tenant/BU/branch negative tests passed.
- [ ] AMK end-to-end UAT passed, including sales → stock → accounting → reports → print/export.
- [ ] Windows scheduler/USB/Google Drive setup actually installed and tested (separate from Vercel deployment).
- [ ] Reviewed changes merged to `main` once; deploy exact SHA to Vercel; verify READY and authenticated smoke tests.
- [ ] Post-release report identifies exact SHA, migrations, backup test evidence, remaining limitations and rollback procedure.

**No automatic production release, no false success status, and no fabricated completion date.**