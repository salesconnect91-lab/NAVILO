# Vehicle accounting reconciliation — 19 Oct 2026

Scope: read-only production audit of NAVILO Transport. No production transaction rewrites.

## Historical opening profits

- Twakkal Al Khaleej: 0 rows in transport_vehicle_historical_profits.
- Orbit – Usman Sajjad: 4 rows for Aug 2026, totaling SAR 33,209.94.
- Four rows reconcile to a posted 1 Sep 2026 cutover journal entry (`COB-20260901-9488C1`) and the corresponding debit/credit entries.
- No August 2026 Trip or transport_vehicle_contributions operational events were found for these same four vehicle IDs. Hence no observed overlap/double count for this opening period.
- The monthly-profit function prioritizes historical profit when opening and operational rows share a vehicle/month. Before any policy change, investigate whether overlap represents legitimate post-cutover adjustments or duplicate source evidence. Do not silently add these values.

## Twakkal legacy Income COA cleanup

- Six generated `VREV-<vehicle-id>` GL accounts linked to Vehicle Master (1631, 2442, 5110, 7138, 8835, 8836).
- Zero references across 40 UUID account-related columns in public base tables, and no Chart of Accounts children or cross-company links.
- Metadata unlink/deactivation rehearsal FAILED: `transport_v1_stamp` and `transport_master_data_guard` require an authenticated active company/business-unit owner context. **Do not bypass these guards in a privileged SQL session.**
- Deferred: unlink via approved authenticated owner workflow, then deactivate six unused GL accounts after rerunning dependency scan. Retain account rows; do not delete them.

## Regression

- `transport_scale_reader_rehearsal.sql` modified to assert ordinary manual expense JEs are rejected and noncash balance-sheet adjustments are allowed, preserving cash-flow reconciliation.
