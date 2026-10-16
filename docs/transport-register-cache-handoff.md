# Register cache release — 16 October 2026

Frontend release: `4029b3e6f7a0593bd8ec418bbeab1be108dd51d0` on main.
Retains loaded rows during requests, reuses cached pages/sorts/filter values,
removes focus/interval reloads, and refreshes after explicit Refresh/local saves.
Compatible with the existing RPC; incremental row responses are enabled only
when the pending database migration is installed.

Validation: TypeScript, 554 frontend tests, production build; 787 local
migrations replayed and 33 isolated SQL rehearsals passed. Snapshot-specific
checks cover all 28 filter columns, bidirectional full-dataset sorting,
canonical financial parity, unchanged refresh, and changed-row deltas.

## Pending database activation

These migrations are prepared and locally tested, **not applied to production**:

1. `20261016042020_transport_page_scoped_service_balances.sql`
2. `20261016042311_transport_register_incremental_snapshots.sql`

Supabase project `ijdaosaqpbgnqojudjbj` reports ACTIVE_HEALTHY, but even
`select 1` through its SQL connector fails with connection timeout. Do not
repeat expensive production diagnostics, reset the database, or alter source
financial data. Restore authorized SQL access, apply the migrations in order,
then verify the original 28-column Register on navilo.vercel.app/transport.

Until activation, a previously uncached sort/filter still uses the old slow
database query. The frontend release does not constitute a complete latency
fix. Browser verification also requires a current authenticated NAVILO session.

Acceptance remaining: measure initial snapshot, repeat sorting/filtering,
explicit Refresh with no changes and with an authorized normal save; confirm
canonical financial values, permissions and all existing popups on production.
