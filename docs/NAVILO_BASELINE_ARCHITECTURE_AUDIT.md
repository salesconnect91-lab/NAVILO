# NAVILO Enterprise ERP — Baseline Architecture & Gap Audit

Audit date: 2026-09-16  
Source of truth: NAVILO Master Requirements (66 sections)  
Production: `https://navilo.vercel.app`  
Supabase project: `ijdaosaqpbgnqojudjbj`

## Executive baseline

NAVILO is an operational multi-tenant ERP foundation, not a blank prototype. The live system has 113 public base tables, RLS enabled on every public table, 80 registered product features, 93 React module screens, company/business-unit/location scoping, accounting, inventory, commercial documents, returns, advances, period controls, audit logging, owner controls, localization infrastructure, and shared print/export components.

The master scope is not yet complete. The largest gaps are inactive approval configuration, incomplete fine-grained role policy activation, and absent deep manufacturing/HR/service workflows. Existing accounting and stock controls must remain the system of record while these gaps are filled.

## Classification (A–I)

| Class | Area | Baseline evidence | Status | Required action |
|---|---|---|---|---|
| A | Platform / tenant isolation | Companies, memberships, business units, locations, modules, feature entitlements; 0 public tables with RLS disabled | Strong foundation | Continue adversarial tenant-scope tests for every new RPC and report |
| B | Owner / subscription control | Owner console routes, plans, subscriptions, limits, branding, feature catalog | Implemented foundation | Complete billing lifecycle, trial/grace/suspension UI and operational metrics |
| C | Roles / permissions / approvals | Module/action permission engine and 80 feature actions exist; approval tables exist but contain 0 workflows/steps/requests; role policy table contains 0 records | Partial / P1 gap | Activate reusable company role policies and approval templates; enforce server-side approval gates |
| D | Accounting / treasury / controls | COA, journals, ledgers, periods, closing, reconciliation, returns, advances, cash/bank and financial statements exist | Strong foundation | Finish budget variance, multi-currency revaluation, maker-checker coverage and exception monitoring |
| E | Commercial / inventory / gate | Sales/purchase, consolidated invoices, order books, warehouse stock, movements, costing, gate pass and weighbridge exist | Operational | Complete quotation/requisition/GRN/dispatch chains and stronger credit/over-receipt controls |
| F | Manufacturing / service depth | Work orders, furnace yield and cutting exist | Major gap | Add BOM/versioning, routing, MRP, reservations, QC, maintenance, subcontracting and full variance costing |
| G | HR / assets / payroll | Employees, salary profiles/accruals/payments and fixed asset tables exist | Partial | Add attendance, shifts, leave, overtime, payroll runs, final settlement and asset lifecycle workflows |
| H | UX / localization / data tools | Shared SearchableSelect, language runtime, PrintLayout, UniversalDataTools; 14 screens still use native selects | Partial | Replace business-data native selects; enforce shared import/export/print contract on all grids/forms |
| I | Reporting / integrations / SaaS ops | Broad report registry, MIS, audit, exceptions table, edge functions | Partial | Add scheduled reports, webhooks/API keys, jobs/retries, backups/restore drills and observability dashboards |

## Integrity checks completed

- All public tables have RLS enabled.
- Posted journals are balanced; journal lines and ledgers reconcile.
- No negative warehouse stock or invalid stock movements were found in the production baseline.
- Posted sales, purchase, return, payment and stock chains were traced to journals/movements.
- Posted-document immutability and closed-period journal guards are active.
- Customer and supplier allocations use invoice totals net of posted returns.
- Supplier payment final balances are recalculated canonically at transaction completion.
- Duplicate party/master-name protection is company scoped and whitespace normalized.
- Production code passes TypeScript, all automated tests, and the Vite production build.

## Priority implementation order

1. **Architecture freeze:** preserve current ledgers, stock, numbering and tenant boundaries; add regression tests around every posting chain.
2. **Policy activation:** reusable roles, feature/action policy records, approval templates, amount thresholds, delegation and server-side approval gates.
3. **Commercial chains:** quotation/requisition/PO/GRN/invoice/payment and quotation/SO/reservation/dispatch/invoice/receipt with linked-document traceability.
4. **Manufacturing:** BOM/routing/work-center foundation, MRP and reservations, execution, QC, downtime/maintenance, by-products and variance costing.
5. **People/assets:** attendance-to-payroll and capitalization-to-disposal chains.
6. **Shared experience:** searchable business selectors, standardized import validation, export fidelity, enterprise print/PDF layouts and responsive forms.
7. **SaaS operations:** subscriptions, jobs/retries, API/webhooks, backup/restore tests, performance budgets, alerts and release runbooks.

## Production acceptance gates

No module is complete until all applicable gates pass:

1. Tenant, company, business-unit and operating-location isolation.
2. View/create/edit/post/delete/print/export authorization on UI and server.
3. Draft → approval → post → reverse lifecycle with posted immutability.
4. Balanced accounting and traceable inventory/cost impact.
5. Closed-period rejection and fiscal/document numbering integrity.
6. Duplicate prevention, validation, audit history and attachment traceability.
7. Searchable selectors, language isolation, import validation, export and print/PDF parity.
8. Desktop/tablet/mobile usability and production runtime verification.

## Known non-blocking technical debt

- The production JavaScript entry chunk is approximately 3.07 MB minified; route-level code splitting is required.
- Unused-index advisor results need workload evidence before removal; indexes must not be dropped from a young database solely on scan counts.
- Supabase leaked-password protection requires an Auth dashboard configuration change.

This document is a living release control. Status changes require code/database evidence and production verification; a menu item or empty table alone does not count as module completion.
