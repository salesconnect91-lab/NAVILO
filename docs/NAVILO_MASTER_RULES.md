# NAVILO Master Product Rules

Last updated: 2026-09-17

These rules are release gates. A feature is not complete until its code, database behavior, production deployment, and live UAT all comply.

| ID | Rule | Enforcement | Status |
|---|---|---|---|
| NAV-R001 | Platform Owner controls the SaaS platform; each customer company is an isolated tenant. AMK is a tenant, not the platform owner. | Tenant-scoped membership, company context, RLS, owner-only controls. | Enforced |
| NAV-R002 | Branches, business units, admins and users remain scoped to their own company. | Company and business-unit foreign keys, membership checks, RLS. | Enforced |
| NAV-R003 | A name must never display with its internal code. Codes remain internal and searchable where operationally useful. | Shared searchable selector plus name-only rendering. | In progress |
| NAV-R004 | Single-language mode shows exactly one selected language. Bilingual mode shows exactly the selected two languages. No dummy, mixed, or third language may leak into UI, reports, print, PDF, or exports. | Runtime language policy and verified language packs. | In progress |
| NAV-R005 | Screen language covers navigation, forms and on-screen reports. Document language separately covers print, PDF and exported official documents. | Separate company screen/document language settings with optional user screen override. | In progress |
| NAV-R006 | Only owner-enabled, verified language packs may be selected. English is the built-in safe pack. | Frontend entitlement filtering and database validation triggers/RPC. | In progress |
| NAV-R007 | Report headers, data cells, totals, print and export must share the same column order and visibility. | Shared column definitions and dynamic colspan/export matrices. | In progress |
| NAV-R008 | Renaming master data or COA must update future selection/search but must not rewrite names on posted historical documents. | Name snapshots captured at posting and used by document/report views. | In progress |
| NAV-R009 | Draft documents may follow current master data; posted documents are immutable accounting records. | Posting snapshots, posted-row guards, controlled reversal/correction flow. | Enforced; snapshot expansion in progress |
| NAV-R010 | Searchable selectors must support typing, keyboard navigation, scrolling and large datasets consistently across every present and future module. | Shared `SearchableSelect` component; codes can be hidden search metadata. | Enforced |
| NAV-R011 | No feature is declared complete from local code alone. | Required checks: type/build/tests, production migration, deployment, security review and live workflow verification. | Enforced |

## Release checklist

- Run code and type checks.
- Run relevant automated tests.
- Apply versioned database migrations.
- Verify RLS, grants, security-definer functions and tenant isolation.
- Deploy the exact reviewed commit.
- Verify the production URL and critical workflows with an authenticated tenant user.
- Update this rule register when a new permanent product rule is agreed.
