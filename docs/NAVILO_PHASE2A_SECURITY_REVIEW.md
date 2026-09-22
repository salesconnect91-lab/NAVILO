# Phase 2A: privileged RPC review — 2026-09-22

The complete per-signature inventory is [NAVILO_PHASE2A_RPC_MATRIX.md](NAVILO_PHASE2A_RPC_MATRIX.md). The review queried the live definitions with `pg_get_functiondef`, their `pg_proc` owner/security flags, per-role privileges and search path. Definition MD5 fingerprints are in the matrix. This is a static read-only review of all **103** authenticated-executable `public` SECURITY DEFINER routines, with targeted manual inspection of high-impact and helper bodies. It does **not** claim authenticated negative tests or full call-graph proof.

## ACL and execution context

- All 103 are owned by `postgres`, have an explicit direct `authenticated` EXECUTE grant and no `anon` EXECUTE or PUBLIC EXECUTE grant. The 103 grants are deliberate callable surface, not 103 demonstrated vulnerabilities.
- Search path settings: 84 use `public, pg_temp`, 13 use `public`, six use empty path. `authenticated` and `anon` do not have `CREATE` on the `public` schema. No dynamic SQL `EXECUTE` token was found in the 103 bodies. Future nested helper changes could alter risk.
- 24 definitions refer to `is_platform_owner()`, 73 to a module-permission helper, 20 to `operating_location_id` or its current-context helper; many rely on indirect guards. Text presence is insufficient to prove row checks. Direct branch-column absence is not automatically a defect in company-scoped configuration or delegated functions.
- Live read-only structure: 150 public tables, zero without RLS; 37 public views, all 37 marked `security_invoker=true`. This says nothing about every policy's predicate correctness.

## Manually traced representative guards

| Signature | Actual live guard/evidence | Static disposition and remaining negative test |
|---|---|---|
| `is_platform_owner()` | Active `user_profiles` row for `auth.uid()` with `platform_role='super_admin'` | Credible owner guard; test ordinary tenant rejection and revoked owner. |
| `current_company_id()` / `has_company_access(uuid)` | Active profile and active company/membership; company access checks `auth.uid()` | Credible company context; test deactivated membership, expired company and forged company ID. |
| `current_business_unit_id()` | Selects locked/last/available BU constrained by company and active BU membership unless platform owner | Credible BU context; test removed BU membership and branch-specific restrictions. |
| `has_module_permission(uuid,text,text)` | Rejects company differing from current company, checks module enablement, membership and role/permission overrides | Core guard, but company role fallback when BU role is absent and override semantics require test per role/BU. |
| `assign_user_to_business_unit(uuid,uuid,text,boolean)` / `remove_user_from_business_unit(uuid,uuid)` | `is_platform_owner()` before mutations; assignment requires membership in target company | Owner-only in current body; test tenant direct RPC call. |
| `sync_platform_feature_catalog(jsonb)` | `is_platform_owner()` before loop/upsert; no company scope because platform catalog is global | Owner-only in current body; test tenant denial and malformed bulk payload in isolated environment. |
| `set_role_permission(...)` | Requires `auth.uid()` and `current_erp_role()='admin'`; writes `role_permissions.user_id=auth.uid()`; empty search_path and schema-qualified refs | User-scoped legacy permissions, not proven platform escalation. Confirm `current_erp_role`/JWT staleness and direct tenant role-permission outcomes. |
| `get_company_business_unit_summary(uuid,date,date)` | Selects one company ID and final gate allows owner or active company membership with company_owner/admin/accounts role | Company-level reporting appears intentional; confirm whether accounts may see *all* BUs and disallow unauthorized BU/branch data if policy requires. |
| `company_resource_limits(uuid)` | Owner/service-role or `has_company_access(p_company_id)` gate | Read helper; test direct foreign-company ID. |
| `get_employee_salary_summary(uuid,date)` | `assert_module_permission('accounting','view')`; salary profile filtered by current company, accrual/payment by current company and BU | No direct IDOR identified in body; verify payroll confidentiality role policy and cross-BU employee IDs. |
| `post_sales_invoice(uuid)` | `assert_module_permission('sales','post')`; loads sales order by ID + current company + BU before calling `post_sales_invoice_core` | Wrapper has scope; core and triggers need separate call-graph review and forged branch ID test. |
| `platform_import_order_book(...)` | Service-role/owner gate and actor ID restriction | High-impact owner import; test tenant denial and company/BU/branch validation with isolated fixtures. |

## Risk decision

**No cross-tenant exploit or confirmed critical RPC vulnerability was demonstrated by static inspection.** Privileged posting, permission updates, stock changes, draft deletion and owner actions remain **high-impact / unverified**, and require isolation/immutability tests before commercial launch. Do not mass revoke 103 grants: most are designed as client-callable APIs and the change could break working flows. Do not claim `search_path` safety for nested callees solely from caller settings.

## Exact isolated negative-test prerequisites

Create a nonproduction Supabase branch or isolated restore with disposable fixtures for **two companies**, at least **two BUs and two branches in each**, plus one platform owner, company owner, accounts role, sales role and viewer for company A, a tenant user for company B, and one deactivated membership. Provide their JWTs through secure test setup, never in reports or chat. Seed a draft and posted invoice, journal, stock row, payroll profile, approval and settings row per scope. For every exposed RPC, call with its own fixture, forged foreign company/BU/branch IDs, revoked membership and wrong role; inspect both response and before/after counts/ledger balances. Separately test posted locks, fiscal period, audit log and storage policies. No such users or calls were created or executed on production in Phase 2A.
