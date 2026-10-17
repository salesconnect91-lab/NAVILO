# Vehicle accounting and multi-vehicle expenses

Implementation continues main from `ada5c6d782a807af23f2417620406d3c168dd4a3` and preserves the original Trip Register and canonical accounting engine.

## Entry points

- `/transport/vehicle-expenses`: manual multi-line expense, saved drafts, review/edit, finalize/post and dated reversal.
- `/settings/imports#import-vehicle-expenses`: template, master validation, preview and atomic multi-group draft import; review/post through Vehicle Expenses.
- `/sales/new?type=normal`: optional company-owned vehicle on each description line, default common Sales Revenue. Trip Service invoices retain Service Revenue.
- `/transport?panel=vehicle-reports`: posted Vehicle Ledger/P&L by accounting date, with PDF, Excel and print. Original Trip Operations report remains available.
- Existing General Journal retains multiple vehicle allocations, ownership dates, balanced canonical posting and reversal.

## Accounting

Expense documents post exactly once through `post_journal_entry`, using vehicle-attributed expense lines, recoverable Input VAT and Cash/Bank/AP. Non-recoverable VAT stays in cost. AP uses the Supplier Master party dimension and canonical party ledgers. No inventory rows or stock movements are created.

The document row is locked during posting. A successful retry returns the existing journal ID. Save/import validations and posting are transactional; a rejected import rolls back all groups. Group and source-reference uniqueness prevent duplicate drafts. Posted expenses cannot be edited or cancelled through journal editing; their reversal must use the expense workflow.

Normal Sale/Purchase line allocations are snapshotted at canonical journal posting. Reports value allocations from actual posted revenue/expense journal lines. Credit notes and reversals use dated canonical journals and retain original allocation weights. General/Shared lines remain unallocated; they are not silently attributed to a vehicle.

All RPCs enforce the authenticated company, Business Unit, location and relevant module permissions. Direct table writes are revoked; read policies enforce scope.

## Migrations

| Repository file | Production history version | Name |
| --- | --- | --- |
| `supabase/migrations/20261017211000_transport_vehicle_expense_drafts.sql` (existing, unchanged) | `20261017182802` | `transport_vehicle_expense_drafts` |
| `supabase/migrations/20261017212000_transport_vehicle_accounting_expenses.sql` | `20261017182901` | `transport_vehicle_accounting_expenses` |

Production migration application assigns its own history timestamps. Do not reapply the repository files based solely on a timestamp mismatch; check the names and schema.

## Validation before release

- `npm run check`: TypeScript PASS, 119 frontend test files / 611 tests PASS, Vite production build PASS.
- Isolated PostgreSQL/PGlite: all 806 migration files replay PASS; all 34 standard SQL rehearsals PASS.
- Final focused vehicle rehearsal PASS after the last posting-time active-vehicle check.
- Synthetic accounting cases: mixed 0/15 VAT, future 18% effective rate, recoverable/non-recoverable VAT, Cash/Bank/Supplier AP, multi-group atomic rollback, duplicate references, repeat posting, dedicated reversal, legacy draft RPC compatibility, ownership/date restrictions, normal Sales AR/VAT/GL and multiple vehicle allocation snapshots.
- Existing General Journal vehicle/reversal, tenant isolation, Transport financial, tax and FX regressions PASS.
- Build retains the existing large-chunk warning; build exits successfully.

## Production migration reconciliation

The following values are identical immediately before and after both migrations. No test financial posting was made in production.

| Measure | Before | After |
| --- | ---: | ---: |
| Journal entries | 35,625 | 35,625 |
| Journal lines | 78,391 | 78,391 |
| Posted journal debit | 143,944,761.53 | 143,944,761.53 |
| Posted journal credit | 143,944,761.53 | 143,944,761.53 |
| GL debit | 143,944,761.53 | 143,944,761.53 |
| GL credit | 143,944,761.53 | 143,944,761.53 |
| Trips | 16,732 | 16,732 |
| Sales documents | 8,970 | 8,970 |
| Purchase documents | 8,805 | 8,805 |
| Vehicle masters | 2,063 | 2,063 |

Orbit accounts `4001 — 7979 Dyna Truck` and `4002 — 7494 Flatbed Trialer` were rechecked: each has zero journal lines and zero account mappings. Both accounts are preserved. Orbit's four company-owned vehicles (2512, 5731, 7494, 7979), their ownership periods and the additional supplier-owned vehicle 1235 are preserved.

## Changed files

- `src/App.tsx`
- `src/components/Layout.tsx`
- `src/modules/settings/ImportCenter.tsx`
- `src/modules/transport/TransportNormalInvoiceCreate.tsx`
- `src/modules/transport/TransportNormalInvoiceCreate.test.tsx`
- `src/modules/transport/TransportVehicleExpenses.tsx`
- `src/modules/transport/TransportVehicleExpenses.test.tsx`
- `src/modules/transport/TransportVehicleExpenseImportPreview.tsx`
- `src/modules/transport/TransportVehicleAccountingReport.tsx`
- `src/modules/transport/TransportVehicleAccountingReport.test.tsx`
- `src/modules/transport/TransportVehicleReports.tsx`
- `src/modules/transport/TransportVehicleReports.integration.test.tsx`
- `src/modules/transport/vehicleExpenseImport.ts`
- `src/modules/transport/vehicleExpenseImport.test.ts`
- `supabase/migrations/20261017212000_transport_vehicle_accounting_expenses.sql`
- `supabase/tests/replay_transport_isolated.mjs`
- `supabase/tests/transport_vehicle_accounting_expenses_rehearsal.sql`
- This release note.

## Authenticated production review follow-up

Password login and Orbit workspace selection succeeded. Live checks confirmed the four company-owned vehicles in expense and normal-sale selectors, multiple normal-sale vehicle lines, common Sales Revenue on manual sales, mixed 0/15% expense calculations (300 net / 15 VAT / 315 gross), working posted ledger/P&L reads, and the actual expense Excel template download. All four original release GitHub workflows completed successfully, including native PostgreSQL transport accounting acceptance.

The review found that the existing normal-sale bulk import still defaulted to Service Revenue; the follow-up changes it to the common Sales Revenue mapping. Orbit has no Vehicle Expense Type records, confirmed by both UI and database. The existing expense-type editor is now reachable from Vehicle Expenses rather than redirecting to Vehicles, so authorized users can configure their real categories. No categories or financial transactions were invented during verification. Live draft posting/reversal and non-empty vehicle export results still require real expense masters and a real document; synthetic financial posting, reversal, isolation and atomicity were verified in isolated PostgreSQL.

Follow-up changed files: `src/modules/transport/TransportNormalInvoiceImport.tsx`, `src/modules/master-data/MasterData.tsx`, `src/modules/transport/TransportVehicleExpenses.tsx`, and this release note. No further database migration is required.
