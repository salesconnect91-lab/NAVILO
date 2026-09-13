# NAVILO Multilingual Standard

This is the mandatory language contract for every current and future NAVILO module, service, report, and printable document.

## Supported languages

NAVILO currently supports English (`en`), Urdu (`ur`) and Arabic (`ar`) end-to-end. Single-language mode may use any one of these. Bilingual mode is restricted to English + Urdu or English + Arabic. A new language must not be added to a selector until its screen dictionary, document dictionary, direction rules and UAT are complete.

## Screen language

All protected ERP screens inherit the global `LanguageRuntime`. User-facing controls, headings, labels, placeholders, titles, menu items and table headings must be written as normal semantic UI and are processed automatically. Domain-specific phrases that cannot be translated correctly by the generic runtime must be added to the central language catalog before the feature is considered complete.

Each signed-in user may either use the company screen-language default or save a personal screen-language override. A user override never changes the official company document language.

## Official document language

Invoices, purchase documents, vouchers, statements, gate passes, reports and other official print/PDF outputs inherit the company Document Language setting. A printable document must use one of the standard roots:

- `.print-document`
- `[data-document-language-root]`
- `[data-print-root]`, `.print-report` or `.professional-report` when used through NAVILO print preview

Common document labels are translated centrally by `src/lib/documentI18n.ts`. Unique document labels should use `data-document-label` and be added to that catalog when a generic translation is not sufficient.

## Business data must never be translated

Customer/supplier/item names, free-text descriptions, document numbers, references, primary keys, amounts, quantities, rates, percentages and other transactional values must remain exactly as stored unless an explicit alternate-language master-data field exists. Mark values that could be confused with labels using `data-business-data`; mark numeric output with `data-numeric` or `.tabular-nums`.

## RTL and accounting numbers

Single Urdu and Arabic documents use RTL layout. Bilingual documents use a stable LTR document structure while displaying both selected labels. Accounting numbers and identifiers remain LTR/tabular even inside an RTL document.

## Future-module rule

A new NAVILO feature is not complete until language coverage passes. The global coverage runtime flags untranslated semantic UI with `data-i18n-missing="true"` and logs a `[NAVILO i18n]` warning. Developers must resolve those warnings by using an existing central phrase or adding the missing EN/UR/AR translation. Do not silence a warning by hard-coding a second language into one screen.

## Required UAT matrix

For every new user-facing module or print template test:

1. Screen: English only.
2. Screen: Urdu only.
3. Screen: Arabic only.
4. Screen: English + Urdu.
5. Screen: English + Arabic.
6. Official document independently in the same five modes where applicable.
7. Confirm customer/item/free-text data, document numbers, quantities, rates and totals remain unchanged in every mode.
8. Confirm Urdu/Arabic single-language print is readable RTL and numeric columns remain correctly aligned.

This standard is platform-level. New modules and templates inherit the runtime automatically when they follow these conventions; only genuinely new business terminology needs to be added to the central translation catalog.
