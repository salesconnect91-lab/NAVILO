# NAVILO — Accounting / Financial / Transport Reports Review
Date: 18-Oct-2026 · Branch: main · Scope: non-destructive reports only

## Confirmed production accounting evidence (read-only)
- Posted vouchers across all companies have balanced debit and credit (0 vouchers differ by > SAR 0.01).
- Twakkal: 35,595 posted entries, 78,243 journal/ledger lines, total debits = credits = SAR 139,236,148.34.
- Orbit: 7 posted entries, 93 journal/ledger lines, total debits = credits = SAR 2,549,947.99.
- AMK: 22 posted entries, 61 journal/ledger lines, total debits = credits = SAR 2,148,671.50.
- Party ledgers match posted party-tagged journal lines in the checked companies. No orphan party rows were found in the inspected companies.
- Screenshot customer ACCESS, Twakkal: total customer ledger debits SAR 286,120; credits SAR 170,384 across 53 rows, 19-Jul-2024 to 12-Oct-2026. Individual invoice rows can legitimately have a blank Credit.

## Defects fixed in code
1. **Date-scoped ledger balances**: GL and party running balances were initialized at zero instead of the prior posted balance. New tenant/BU/branch-scoped read-only opening RPC and shared carry-forward math; source transactions untouched.
2. **Party statement print**: 19+ customizable columns were forced into one print table, breaking date/credit/reference headers. New print-only financial table (Date, Party when needed, Reference, Description, Debit, Credit, Balance); opening/closing and period totals displayed. Relevant Trip information appears in a separate supporting section without repeating debits/credits. Complete on-screen columns and CSV remain available.
3. **Transport reports**: shared print sections now max 9 columns, preserving every original source field and separate printed totals.
4. **Customer Invoice Statement & Aging**: split printed summary, invoice detail and payment allocation sections; original Excel/CSV/Word source data unchanged.
5. **Supplier Aging**: printed summary and invoice aging detail independently.
6. **Salesperson Ledger**: wide management report now has professional print sections.
7. **Day Book**: adds Print/PDF from the same posted Dr/Cr ledger lines.
8. **Print CSS**: dates and financial numeric columns protected from undesirable line breaks.

## Financial statement accounting principles
- General Ledger and Day Book: *actual posted* debit/credit by journal line.
- Party Statement: AR/AP subledger posted Dr/Cr and signed balance, with brought-forward balances.
- Trial Balance: opening/period/closing debit and credit columns.
- Profit & Loss: net income and expense by account, not two debits/credits per row.
- Balance Sheet: net classified asset, liability, equity balances.
- Cash Flow: actual posted cash/bank movements; noncash vouchers excluded, classification differences shown.
- Transport Trip Invoice: single customer invoice and posted party voucher; never duplicate invoice Dr/Cr for every Trip detail.
- Imported opening invoice evidence and original historical payment dates must not be invented.

## Release verification
- Shared print/movement helper unit tests added; TypeScript, unit tests and production build must pass on latest commit.
- SQL migration applies only a read-only RPC. Posted journal, master, Trip and invoice records were not updated.
- Frontend changes committed to main; verify Vercel production commit matches and is READY.
- Automated tests do not replace logged-in end-to-end browser preview/PDF validation. Do not mark every specialized report as manually accepted without that evidence.

## Remaining acceptance gates (not yet certified)
- Logged-in print preview/PDF checks with sample long-named customers and 2+ page data in General/Party Ledger, Day Book, Customer/Supplier Aging, Trial Balance, P&L, Balance Sheet, Cash Flow, and each Transport report group.
- Independent reconciliation of payment allocations, partial payments, credits, reversals and imported opening invoices for every company/branch/date scope.
- Payroll/Loan, stock/inventory, steel, salesperson and remaining niche report families require separate source validation and print checks; they are not silently marked PASS.
- A pre-existing isolated Transport smoke workflow had failures unrelated to this report-only patch; verify the current isolated DB suite before launch acceptance.

## Safety
No posted financial transaction or invoice was deleted, reposted or modified. The original Trip Service Invoice form remains unchanged.
