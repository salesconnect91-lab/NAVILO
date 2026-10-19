# Approved ERP UX implementation — local review checkpoint

Upstream base: 4b27598ab49f3f91b3deade9ba5e9de51e577c85 (main), reconciled 19-Oct-2026.
Original implementation was prepared against b543c27; 54 later upstream files have been preserved.
The source snapshot was verified against all 1,465 upstream blob hashes before edits.
Local snapshot commit f7cb7ab0 is a reconstruction checkpoint, NOT an upstream GitHub commit.

## Applied

- Shared screen design tokens, emerald primary actions, compact 216/56px sidebar, responsive header and consistent page/control/report surfaces across existing modules.
- Existing navigation definitions extracted into one reusable module. Existing module, feature, role and company restrictions retained; company module intersection applied to catalog/navigation.
- New upstream expense invoice creation/import included in Purchase, Quick Create and Import Center.
- Central function and report catalogs, top-level Import Center, scoped Favorites and Recent Pages, keyboard-searchable function palette and permission-filtered Quick Create.
- Each catalog item opens its existing route, preserving Transport query panels. New catalog-only routes do not return business records and do not bypass destination guards.
- Existing company and BU switchers moved into header layout; their switching handlers are unchanged. Mobile drawer focus containment added. Dedicated Transport mobile screen preserved.
- Dashboard shortcuts added over the existing live dashboard. No sample finance values from the design preview were copied into the application.
- Import catalog links to existing workflows and effect labels; existing handlers/validation/posting untouched. Section anchors scroll after route rendering.
- Report preferences isolated by user/company/BU/report/query, remounted on scope changes, with explicit Set as default feedback. Legacy unscoped preferences are retained in storage but not automatically copied between tenants.
- Transport register rows, columns, readers, caches and popups were not rewritten. Existing invoice, stock, tax and financial calculations remain in their components.

## Verification

Latest reconciled suite: 137 test files / 693 tests passed (74.94 seconds).
Earlier implementation suite: 132 files / 675 tests; final targeted access/focus/anchor checks: 24 tests passed.
TypeScript and production build passed; Vite reports existing large chunks.
`git diff --check` passes.

## Release boundary / pending acceptance

No migrations added or applied. No production data changes. No GitHub push or Vercel deployment.
Authenticated visual acceptance at 1366×768 (100%), tablet and mobile remains pending, including register row count, responsive popups, print/export visual parity and role-specific end-to-end navigation.
The production browser is at sign-in; the new local build has NOT been tested as production.
This checkpoint applies the shared design layer and navigation to existing modules, not a rewrite of their internal business forms. Do not call every screen visually accepted until the viewport checks are completed.
Before any push, compare current main with the upstream base and rebase/reconcile concurrent changes. Pushing main may trigger production deployment, so it requires the separate release approval requested by the user.

## Rollback

Revert only this UX change set against its reconciled upstream base. There is no database rollback. Scoped browser preferences are optional UI state; old preference keys are not deleted.
