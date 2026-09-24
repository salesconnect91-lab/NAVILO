# NAVILO Phase 2B local authenticated security results

Execution date: 2026-09-23  
Development SHA tested: `f4ddc905ed11fb78d217d4cb08f16ccdc4bd932a`  
Environment: unlinked local Supabase only (`localhost:54321`)  
Topology: 2 synthetic companies; 2 business units and 2 branches per company; 6 Auth identities  
Result: **41 passed / 0 failed**

No production data, hosted project, real identity, password, API key, email or row UUID is recorded here. The runner explicitly refused production project ref `ijdaosaqpbgnqojudjbj` and emitted only sanitized evidence.

## Expected/actual evidence

| Role | Test | Expected | Actual | Result |
|---|---|---|---|---|
| accountsA | Own company positive control | `VALUE:true` | `VALUE:true` | PASS |
| accountsA | Own reports permission positive control | `VALUE:true` | `VALUE:true` | PASS |
| accountsA | Foreign company row | `ROWS:0` or denied | `ROWS:0` | PASS |
| accountsA | Foreign customer row | `ROWS:0` or denied | `ROWS:0` | PASS |
| accountsA | Foreign company helper | `VALUE:false` or denied | `VALUE:false` | PASS |
| accountsA | Foreign company module permission | `VALUE:false` or denied | `VALUE:false` | PASS |
| accountsA | Unassigned same-company business unit | denied | `HTTP 400` | PASS |
| accountsA | Unassigned same-company branch | denied | `HTTP 400` | PASS |
| accountsA | Owner-only assignment with forged unit | denied | `HTTP 400` | PASS |
| salesA | Own company positive control | `VALUE:true` | `VALUE:true` | PASS |
| salesA | Own reports permission positive control | `VALUE:true` | `VALUE:true` | PASS |
| salesA | Foreign company row | `ROWS:0` or denied | `ROWS:0` | PASS |
| salesA | Foreign customer row | `ROWS:0` or denied | `ROWS:0` | PASS |
| salesA | Foreign company helper | `VALUE:false` or denied | `VALUE:false` | PASS |
| salesA | Foreign company module permission | `VALUE:false` or denied | `VALUE:false` | PASS |
| salesA | Unassigned same-company business unit | denied | `HTTP 400` | PASS |
| salesA | Unassigned same-company branch | denied | `HTTP 400` | PASS |
| salesA | Owner-only assignment with forged unit | denied | `HTTP 400` | PASS |
| viewerA | Own company positive control | `VALUE:true` | `VALUE:true` | PASS |
| viewerA | Own reports permission positive control | `VALUE:true` | `VALUE:true` | PASS |
| viewerA | Foreign company row | `ROWS:0` or denied | `ROWS:0` | PASS |
| viewerA | Foreign customer row | `ROWS:0` or denied | `ROWS:0` | PASS |
| viewerA | Foreign company helper | `VALUE:false` or denied | `VALUE:false` | PASS |
| viewerA | Foreign company module permission | `VALUE:false` or denied | `VALUE:false` | PASS |
| viewerA | Unassigned same-company business unit | denied | `HTTP 400` | PASS |
| viewerA | Unassigned same-company branch | denied | `HTTP 400` | PASS |
| viewerA | Owner-only assignment with forged unit | denied | `HTTP 400` | PASS |
| tenantB | Own company positive control | `VALUE:true` | `VALUE:true` | PASS |
| tenantB | Own reports permission positive control | `VALUE:true` | `VALUE:true` | PASS |
| tenantB | Foreign company row | `ROWS:0` or denied | `ROWS:0` | PASS |
| tenantB | Foreign customer row | `ROWS:0` or denied | `ROWS:0` | PASS |
| tenantB | Foreign company helper | `VALUE:false` or denied | `VALUE:false` | PASS |
| tenantB | Foreign company module permission | `VALUE:false` or denied | `VALUE:false` | PASS |
| tenantB | Unassigned same-company business unit | denied | `HTTP 400` | PASS |
| tenantB | Unassigned same-company branch | denied | `HTTP 400` | PASS |
| tenantB | Owner-only assignment with forged unit | denied | `HTTP 400` | PASS |
| viewerA | Viewer sales-post permission | `VALUE:false` or denied | `VALUE:false` | PASS |
| revokedA | Revoked company access | `VALUE:false` or denied | `VALUE:false` | PASS |
| revokedA | Revoked customer access | `ROWS:0` or denied | `ROWS:0` | PASS |
| owner | Platform Owner positive control | `VALUE:true` | `VALUE:true` | PASS |
| anonymous | Authenticated-only helper grant | denied | `HTTP 401` | PASS |

## What this proves

- Auth works for owner, accounts, sales, viewer, revoked and second-tenant synthetic identities.
- The tested company and customer reads do not return foreign-tenant rows.
- Tested company/module helpers fail closed for forged foreign company IDs.
- Locked users cannot switch to an unassigned business unit or branch in their own company.
- Normal tenant roles cannot invoke the tested owner-only BU assignment with a forged unit.
- Viewer sales-post permission, revoked membership access and anonymous helper execution are denied.

## Boundaries

This is the targeted Phase 2B isolation/RPC matrix, not dynamic certification of all 103 authenticated-executable SECURITY DEFINER functions. The 103-function static review remains the source for individual grants, search path and guard triage. Domain workflows requiring valid draft/posted invoices, purchase documents, journals, stock, returns and payment allocations remain for business UAT and destructive-operation regression testing. Production schema/history, `main`, Vercel and both hosted Supabase projects were unchanged.
