# Transport database rehearsal

Run `npm ci` then `npm run test:transport-db` from the repository root.
The runner replays every checked-in migration in filename order into a fresh,
PGlite PostgreSQL database, supplies Supabase auth/storage schemas
and authenticated grants, then runs twelve transactional SQL rehearsals with
synthetic fixtures that roll back. Assertions cover canonical AR/AP, payroll
attribution, VAT, credits/reversals, allocations, permissions, financial closure,
rate entry, historical vehicle attribution, PPR attachments, advances, atomic
cash bills/receipts, reviewed expenses and scoped reporting projections.

## Historical accounting import

The daily New Trip bulk uploader creates operational trips. It rejects payment
history rather than silently ignoring money. New Trip → One-time Historical
Import is a separate reviewed dataset, limited to 20,000 trips per business unit.
The downloadable workbook has Trips, Payments and Instructions worksheets.

Source Record ID identifies each real legacy trip. Genuine journeys with the
same date, vehicle and route must have distinct IDs. The original file hash,
settings, source manifest and posted results remain fixed after posting starts.
Retries/resume reuse those results and do not repeat bills or cash movements.
An empty review can be cleared only before any trip or accounting is saved.

Customer and supplier posted/VAT flags are independent. Posted sides require
invoice dates and gross totals. Each dated partial payment has its own amount,
active same-company Cash/Bank account code and external reference; separate banks retain separate ledger movements. Settled plus remaining must
match gross. The importer uses canonical service invoices, customer receipts,
supplier payments, allocations and journals; it does not fabricate ledger
rows. Original invoice references remain informational; each imported trip has
its own canonical invoice. Unsupported legacy AMOUNT/commission evidence must
be reconciled separately. Employee payroll is distinct from supplier rent.

A workspace administrator or existing Platform Owner may import, subject to
canonical finance and accounting permissions and active branch scope. Opening
balances must exclude the imported bills and payments to prevent double counts.
Each 25-row batch commits atomically. After interruption, resume the unchanged
saved job; if browser storage is lost, restore the original workbook to recover
server progress. The final server control totals must match the reviewed file.

Commands:

- `NAVILO_HISTORY_SMOKE=1 npm run test:transport-db`: history reconciliation,
  VAT, partial/split payments, genuine repeat journeys, rollback, retry, access
  controls and CR/SP numbering beyond 9,999.
- `NAVILO_HISTORY_SCALE=20000 npm run test:transport-db`: one synthetic 20,000
  trip dataset through 800 separate atomic batches. Each trip has a customer
  invoice, supplier invoice, customer receipt and two partial supplier payments.
  The test checks final trip count, receipt/payment totals and canonical AR/AP/
  cash balances. The runner analyzes the database because PGlite has no
  autovacuum. WASM timings are not a production throughput guarantee.
  Full accounting stress acceptance remains pending: a prior in-memory run
  completed 12,800 trips before the local process exhausted memory. A 20,000-row
  parser test passing does not establish 20,000-trip accounting acceptance.
- `NAVILO_READER_SMOKE=1 npm run test:transport-db`: pagination, imports and
  canonical parity for customer/supplier, driver and vehicle reporting readers.

This is PostgreSQL in WASM, not a full local Supabase stack. It does not verify
concurrent backend sessions, Storage HTTP, Auth HTTP or PostgREST. The SQL
fixtures never run on production. Browser acceptance is read-only against the
signed-in production workspace; financial posting tests use isolated fixtures.

## Editable Transport invoice numbers

Sales and Purchase Transport service editors offer an optional invoice number
under each Trip. Each customer Trip and supplier rent remains an individual
canonical invoice. Transport navigation hides consolidated documents, and
direct Sales/Purchase consolidated links redirect to Trip service creation. Blank uses automatic numbering. The entered number is
trimmed and saved before posting; case-insensitive duplicates in the active
company are rejected. Posted numbers stay immutable. Supplier original invoice
references remain separate. Cash Bill retries bind the chosen number to their
immutable request payload. The SQL rehearsals cover custom numbers, duplicate
rollback, page readers, private helper grants and Cash Bill idempotency.

For the in-memory scale rehearsal, run with explicit garbage collection:
`NAVILO_HISTORY_SCALE=20000 node --expose-gc supabase/tests/replay_transport_isolated.mjs`.
The runner checkpoints after each 100 trips, logs RSS, and releases eligible
JavaScript buffers. This remains one dataset with 800 canonical atomic batches.

## Native PostgreSQL acceptance in CI

The Transport accounting acceptance workflow uses a fresh PostgreSQL 17 service
for each matrix job. One job replays all migrations and the thirteen reconciliation
rehearsals; the second imports the complete 20,000-trip historical dataset through
800 canonical batches and checks final accounting totals. Logs are retained as
job artifacts. This workflow uses no production connection or credentials.
The native adapter accepts only the fixed loopback CI service, named empty
rehearsal database and CI-only driver; arbitrary remote hosts are unsupported.

## Scope plan reuse

The scope helpers retain their original authorization queries, stable volatility,
security-definer settings and grants. PL/pgSQL caches executable query plans,
not user/company/branch results. The regression fixture switches actors and
workspaces within one backend and checks stale selections, inactive membership,
Platform Owner access, suspended/expired companies and anonymous scope.
