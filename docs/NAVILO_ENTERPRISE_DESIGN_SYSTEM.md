# NAVILO enterprise UI specification — development proposal, 2026-09-24

This is a code-based proposal. No authenticated four-viewport screenshot review has been completed for this version. Do not label visual appearance, accessibility, print/PDF or theme coverage as verified.

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
