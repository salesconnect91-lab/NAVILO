# NAVILO enterprise UI specification — development proposal, 2026-09-24

This is a code-based proposal. No authenticated four-viewport screenshot review has been completed for this version. Do not label visual appearance, accessibility, print/PDF or theme coverage as verified.

## Report and import screen implementation checkpoint

- Generic `/reports` pages now place Date Range, From/To, Posted basis, Column grouping and available record filters on one compact scrollable row. `Customise` and `Save As` stay at the right and remain reachable after hiding filters. The centered report header sits above a compact Refresh/Print/Email/Export/Insights toolbar. Print and export obey report permissions; Email remains disabled until a delivery gateway exists. Posted basis is a disabled label because selectable cash/accrual reporting has not been implemented.
- Save As stores a named filter view only in the current browser, keyed by user, company, business unit and report path. Column visibility/density and print orientation use the existing report customizer. Browser storage is not cross-device or centrally backed up.
- Settings → Import Center has four white grid cards and centered green icons: Bank Data, Customers, Suppliers and Invoices. Customer/supplier import and eligible draft invoice imports lead to existing role-gated workflows. Bank statement import is explicitly unavailable; do not represent a link to reconciliation as an importer.
- Keep entry and editing forms free of generic Print/Export/Import. Show document preview/print where an actual document exists and export/print on report/list surfaces where useful. The generic report export toolbar replaces duplicate global controls; purchase draft import/template actions remain visible at their actual list route.
- The supplied screenshots evidence the *previous* invoice, order booking and cash counter layouts. They do not prove how this new build renders. Complete the viewport and authenticated UAT gate below before claiming a visual match.

## Structure and navigation

- Shell: one compact 64 px top bar, 252 px expanded sidebar, 68 px desktop icon rail. At widths below `lg`, a full-width labelled drawer replaces the icon rail. Persist desktop collapse preference without applying it to the mobile drawer.
- Sidebar: one level of major domains; reveal secondary and tertiary destinations in the current section. Show icon and active indicator for each domain; preserve a visible active path and a keyboard-discoverable label on every icon. Group activation in the icon rail first expands the sidebar and selected group.
- Header: show page title, company context, consistent Back action where useful and global search with stable keyboard order. Any overflow action must be labelled; ensure shell never covers dialogs or printed documents.
- Mobile drawer: open/close control, backdrop, Escape-to-close, visible labels, active route and scrollable navigation. Check focus entry/return and background focus isolation in browser acceptance; these are not established by static inspection.

## Shared visual tokens and components

| Element | Spec | Intended shared surface |
|---|---|---|
| Typography | 14–16 px body; 20–24 px page title; 12–13 px helper and table metadata; reserve 10 px for optional compact metadata only. PKR numerals tabular and right aligned. | Shell, master forms, reports, dashboard |
| Color | Slate 950 sidebar, white surfaces, slate 50 canvas, blue 600 primary action; semantic emerald/amber/rose for status, never color alone. Require readable text in dark/light surfaces before offering additional themes. | Buttons, badges, alerts, charts |
| Spacing | 4/8/12/16/24 px scale; clear grouping between filters, actions, cards and tables. Compact density may tighten rows but must preserve usable click targets. | Forms, tables, dialogs |
| Forms | Visible label, field hint, validation next to input, disabled/pending state and searchable entity selector. Do not show account codes where business name is sufficient. | Master data, invoice editor, posting dialogs |
| Tables | Sticky or repeated headers for long lists, numeric alignment, horizontal scroll on small screens, clear empty/error/loading states and at least one visible data column; CSV/print columns follow on-screen order. | Ledgers, reports, sales/purchase, inventory |
| Document print | Isolate from navigation; align logo/identity and totals, keep invoice/line breaks readable and selected document language exact. | Invoices, statements, PDF, reports |

## Module-specific exceptions

- Accounting: balanced debit/credit and posting state should remain prominent; destructive/reversal action requires context and permission feedback.
- Sales/purchase: invoice totals, tax and payment state stay visible while editing/reviewing; print/PDF must be validated separately from responsive browser cards.
- Inventory/manufacturing: item, unit, warehouse, godown and movement state must be distinguishable without relying on color.
- Owner controls: indicate that the workspace is platform-wide; avoid exposing these routes/actions to tenant roles.
- Dashboard: prioritize posted sales/purchases, cash/bank, receivables/payables, stock and exceptions; rearrangement is supplemental and must not hide critical error states.

## Acceptance gate

Inspect authenticated owner and tenant views at desktop 1440×900, laptop 1280×800, tablet 768×1024 and mobile 390×844. Check navigation collapse/expand, nested links, keyboard and screen-reader labels, overflow, forms, tables, charts, loading/error/empty states, both selected language modes, and invoice/report preview/print/PDF/export. Record actual screenshots and test identities separately; do not use production customer data as synthetic fixtures. Do not claim dark mode or density customization until the complete UI, dialogs, charts and print behavior are verified.
