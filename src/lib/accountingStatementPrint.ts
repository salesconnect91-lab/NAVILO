import { escapePrintHtml, printReportDescription } from '@/lib/printDocument';
import type { ReportTable, ExportCell } from '@/modules/transport/transportPartyExport';

/** Print-only financial statement structure: rows and values are never recalculated. */
export type AccountingPrintRowKind = 'section' | 'detail' | 'subtotal' | 'total' | 'check';
export type AccountingPrintRow = { cells: ExportCell[]; kind: AccountingPrintRowKind };
export type AccountingPrintLayout = {
  title: string;
  subtitle: string;
  columns: string[];
  rows: AccountingPrintRow[];
  orientation: 'portrait' | 'landscape';
};

const clean = (value: unknown) => String(value ?? '').trim();
const norm = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const displayAmount = (value: ExportCell) => typeof value === 'number'
  ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : String(value ?? '');

export function accountingStatementLayout(report: ReportTable): AccountingPrintLayout {
  const sectionIndex = report.columns.findIndex(column => norm(column) === 'section');
  const accountIndex = report.columns.findIndex(column => norm(column) === 'account');
  // A statement's Section becomes a full-width heading rather than a repetitive column.
  const groupSections = sectionIndex >= 0 && accountIndex >= 0;
  const indexes = report.columns.flatMap((_, index) => groupSections && index === sectionIndex ? [] : [index]);
  const columns = indexes.map(index => report.columns[index]);
  const rows: AccountingPrintRow[] = [];
  let priorSection = '';
  for (const source of report.rows) {
    const section = groupSections ? clean(source[sectionIndex]) : '';
    const account = accountIndex >= 0 ? clean(source[accountIndex]) : '';
    const accountLabel = norm(account);
    const sectionLabel = norm(section);
    if (groupSections && section && section !== priorSection &&
        !['result', 'total', 'check'].includes(sectionLabel)) {
      rows.push({ kind: 'section', cells: [section] });
    }
    if (section) priorSection = section;
    const values = indexes.map(index => source[index] ?? '');
    const first = norm(values[0]);
    let kind: AccountingPrintRowKind = 'detail';
    if (sectionLabel === 'check' || /^(?:difference|accounting equation)/.test(accountLabel)) kind = 'check';
    else if (sectionLabel === 'total' || sectionLabel === 'result' ||
      /^(?:total|closing cash|net (?:profit|cash|change)|gross profit|operating profit)/.test(first)) kind = 'total';
    else if (accountLabel === 'section total' || /^(?:sub ?total|section total)/.test(first)) kind = 'subtotal';
    if (groupSections && accountLabel === 'section total') {
      values[values.indexOf(source[accountIndex])] = 'Total ' + section;
    }
    rows.push({ kind, cells: values });
  }
  return {
    title: report.title,
    subtitle: printReportDescription(report.description),
    columns,
    rows,
    orientation: columns.length >= 6 ? 'landscape' : 'portrait',
  };
}

function renderRow(row: AccountingPrintRow, width: number, numberColumns: Set<number>) {
  if (row.kind === 'section') return `<tr class="acct-section"><th colspan="${width}" scope="rowgroup">${escapePrintHtml(row.cells[0])}</th></tr>`;
  return `<tr class="acct-${row.kind}">${row.cells.map((value, index) =>
    `<td${numberColumns.has(index) || typeof value === 'number' ? ' class="acct-number"' : ''}>${escapePrintHtml(displayAmount(value))}</td>`).join('')}</tr>`;
}

export function accountingStatementMarkup(report: ReportTable) {
  const layout = accountingStatementLayout(report);
  const numeric = new Set(layout.columns.flatMap((column, index) =>
    /amount|debit|credit|balance|movement|opening|closing|total|\bdr\b|\bcr\b/i.test(column)
      ? [index] : []));
  return `<div data-print-report-title="${escapePrintHtml(layout.title)}" data-report-orientation="${layout.orientation}" data-print-accounting-statement="true"><p data-print-description>${escapePrintHtml(layout.subtitle)}</p><table class="accounting-statement-table"><thead><tr>${layout.columns.map(c=>`<th scope="col">${escapePrintHtml(c)}</th>`).join('')}</tr></thead><tbody>${layout.rows.map(row => renderRow(row,layout.columns.length,numeric)).join('')}</tbody></table></div>`;
}

export const ACCOUNTING_STATEMENT_PRINT_CSS = `
.accounting-statement-print{color:#172a3e;font:9pt Arial,Helvetica,sans-serif}
.accounting-statement-print header{display:flex;justify-content:space-between;align-items:flex-end;gap:8mm;border-bottom:1.5px solid #23466a;padding:0 0 3mm;margin-bottom:4mm}
.accounting-statement-print .acct-company{font-size:13pt;font-weight:700}
.accounting-statement-print .acct-unit{font-size:8pt;color:#53657b;margin-top:1mm}
.accounting-statement-print .acct-topmeta{font-size:7.5pt;text-align:right;color:#52667c}
.accounting-statement-print h1{font-size:14pt;margin:0 0 1mm;color:#172d45}
.accounting-statement-print .acct-period{font-size:8pt;color:#52667c;margin:0 0 5mm;line-height:1.4}
.accounting-statement-print table{width:100%;border-collapse:collapse;table-layout:auto;font-size:8pt}
.accounting-statement-print thead{display:table-header-group}
.accounting-statement-print th,.accounting-statement-print td{padding:1.6mm 2mm;line-height:1.25;border:0;border-bottom:1px solid #dbe2ea;vertical-align:top}
.accounting-statement-print thead th{background:#eaf0f6;color:#213d5b;font-weight:bold;text-align:left;border-top:1px solid #b8c7d6;border-bottom:1px solid #b8c7d6}
.accounting-statement-print .acct-section th{padding-top:3mm;padding-bottom:1.5mm;background:#f0f4f8;color:#173858;text-transform:uppercase;letter-spacing:.03em;font-size:8pt;border-bottom:1px solid #b7c6d5}
.accounting-statement-print .acct-subtotal td{font-weight:700;background:#f7f9fc;border-top:1px solid #bac7d6}
.accounting-statement-print .acct-total td{font-weight:700;background:#edf3f9;border-top:1.5px solid #23466a;border-bottom:1.5px solid #23466a}
.accounting-statement-print .acct-check td{font-weight:700;background:#f7f9fc;border-top:1px solid #c4ced8}
.accounting-statement-print .acct-number{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.accounting-statement-print tr{break-inside:avoid;page-break-inside:avoid}
.accounting-statement-print .acct-note{font-size:7pt;color:#6a7989;margin-top:4mm}
`;

export function accountingStandalonePrintHtml(report: ReportTable, identity?: {companyName?:string;businessUnitName?:string}, when = new Date()) {
  const layout = accountingStatementLayout(report);
  const generated = new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(when);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapePrintHtml(layout.title)}</title><style>@page{size:A4 ${layout.orientation};margin:10mm}body{background:white;margin:0}${ACCOUNTING_STATEMENT_PRINT_CSS}</style></head><body><article class="accounting-statement-print"><header><div><div class="acct-company">${escapePrintHtml(identity?.companyName || 'Company')}</div><div class="acct-unit">${escapePrintHtml(identity?.businessUnitName || '')}</div></div><div class="acct-topmeta">FINANCIAL STATEMENT<div>Prepared ${escapePrintHtml(generated)}</div></div></header><h1>${escapePrintHtml(layout.title)}</h1><p class="acct-period">${escapePrintHtml(layout.subtitle)}</p>${accountingStatementMarkup(report)}</article></body></html>`;
}
