import * as XLSX from "xlsx";

export interface ExportColumn { key: string; label: string; }
export type ExportMatrix = Array<Array<unknown>>;
export type ExportSheet = { name: string; rows: ExportMatrix };
export type ExportPackage = { title: string; sheets: ExportSheet[] };

function safeSpreadsheetText(value: string): string { return /^[=+\-@]/.test(value) ? `'${value}` : value; }
function normalizeExcelValue(value: unknown): string | number | boolean {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return safeSpreadsheetText(String(value ?? ""));
}
function ensureExtension(filename: string, extension: string): string {
  const trimmed = filename.trim() || `NAVILO_Export${extension}`;
  return trimmed.toLowerCase().endsWith(extension) ? trimmed : `${trimmed.replace(/\.[^.]+$/, "")}${extension}`;
}
function escapeCSV(value: unknown): string {
  const safe = safeSpreadsheetText(String(value ?? ""));
  if (safe.includes(",") || safe.includes('"') || safe.includes("\n") || safe.includes("\r")) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}
function escapeHtml(value: unknown): string { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c] || c)); }
function cleanText(value: string | null | undefined) { return (value || "").replace(/\s+/g, " ").trim(); }
function safeSheetName(value: string, index: number) { return (value || `Sheet ${index + 1}`).replace(/[\\/?*\[\]:]/g, " ").slice(0, 31) || `Sheet ${index + 1}`; }
function isActionHeader(label: string) { return /^(actions?|action|عمل|کارروائی)$/i.test(label.trim()) || label.trim() === ""; }
function isVisibleForExport(el: Element): boolean {
  const node = el as HTMLElement;
  if (node.closest("[data-no-export],[hidden],.hidden")) return false;
  if (node.closest("[data-navilo-export-snapshots]") && !node.closest("[data-navilo-export-active]")) return false;
  if (!node.isConnected) return true;
  const style = window.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return node.getClientRects().length > 0;
}
function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function matrixToWorksheet(matrix: ExportMatrix): XLSX.WorkSheet {
  const rows = matrix.length ? matrix : [[]];
  const normalized = rows.map(row => row.map(normalizeExcelValue));
  const worksheet = XLSX.utils.aoa_to_sheet(normalized);
  const columnCount = Math.max(1, ...normalized.map(row => row.length));
  worksheet["!cols"] = Array.from({ length: columnCount }, (_u, index) => {
    const values = normalized.map(row => String(row[index] ?? ""));
    return { wch: Math.min(48, Math.max(12, ...values.map(value => value.length + 2))) };
  });
  if (worksheet["!ref"] && normalized.length > 1 && normalized[0]?.length > 1) worksheet["!autofilter"] = { ref: worksheet["!ref"] };
  return worksheet;
}

export function exportMatrixToCSV(filename: string, matrix: ExportMatrix): void {
  const rows = matrix.length ? matrix : [[]];
  downloadBlob(ensureExtension(filename, ".csv"), new Blob(["\uFEFF" + rows.map(row => row.map(escapeCSV).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
}
export function exportWorkbookToExcel(filename: string, sheets: ExportSheet[]): void {
  const workbook = XLSX.utils.book_new();
  (sheets.length ? sheets : [{ name: "Data", rows: [[]] }]).forEach((sheet, index) => XLSX.utils.book_append_sheet(workbook, matrixToWorksheet(sheet.rows), safeSheetName(sheet.name, index)));
  XLSX.writeFile(workbook, ensureExtension(filename, ".xlsx"), { compression: true });
}
export function exportMatrixToExcel(filename: string, matrix: ExportMatrix, sheetName = "Data"): void { exportWorkbookToExcel(filename, [{ name: sheetName, rows: matrix }]); }
export function flattenExportSheets(sheets: ExportSheet[]): ExportMatrix {
  const out: ExportMatrix = [];
  sheets.forEach((sheet, index) => { if (index) out.push([]); out.push([sheet.name]); out.push(...(sheet.rows.length ? sheet.rows : [["No data"]])); });
  return out.length ? out : [["No data"]];
}
export function exportPackageToExcel(filename: string, pack: ExportPackage): void { exportWorkbookToExcel(filename, pack.sheets); }
export function exportPackageToCSV(filename: string, pack: ExportPackage): void { exportMatrixToCSV(filename, flattenExportSheets(pack.sheets)); }
export function exportPackageToWord(filename: string, pack: ExportPackage): void { exportMatrixToWord(filename, flattenExportSheets(pack.sheets), pack.title); }
export function exportMatrixToWord(filename: string, matrix: ExportMatrix, title = "NAVILO Report"): void {
  const rows = matrix.length ? matrix : [[]];
  const table = rows.map((row, i) => `<tr>${row.map(value => i === 0 ? `<th>${escapeHtml(value)}</th>` : `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;font-size:10pt;color:#111827}h1{font-size:16pt}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:5px;text-align:left;vertical-align:top}th{background:#f1f5f9;font-weight:700}</style></head><body><h1>${escapeHtml(title)}</h1><table>${table}</table></body></html>`;
  downloadBlob(ensureExtension(filename, ".doc"), new Blob(["\uFEFF", html], { type: "application/msword;charset=utf-8" }));
}
export function exportToCSV(filename: string, columns: ExportColumn[], rows: Record<string, unknown>[]): void { exportMatrixToCSV(filename, [columns.map(c => c.label), ...rows.map(row => columns.map(c => row[c.key]))]); }
export function exportToExcel(filename: string, columns: ExportColumn[], rows: Record<string, unknown>[]): void { exportMatrixToExcel(filename, [columns.map(c => c.label), ...rows.map(row => columns.map(c => row[c.key]))]); }
export function exportToWord(filename: string, columns: ExportColumn[], rows: Record<string, unknown>[], title = "NAVILO Report"): void { exportMatrixToWord(filename, [columns.map(c => c.label), ...rows.map(row => columns.map(c => row[c.key]))], title); }

function controlLabel(el: Element): string {
  const aria = cleanText(el.getAttribute("aria-label"));
  if (aria) return aria;
  const id = (el as HTMLElement).id;
  if (id) { const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`); if (lab) return cleanText(lab.textContent); }
  const parentLabel = el.closest("label");
  if (parentLabel) return cleanText(parentLabel.textContent).replace(cleanText((el as HTMLInputElement).value), "").trim();
  let parent = el.parentElement;
  for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
    const sibling = parent.querySelector(":scope > label");
    if (sibling) return cleanText(sibling.textContent);
  }
  return (el as HTMLInputElement).placeholder || (el as HTMLInputElement).name || "Filter";
}
function controlValue(el: Element): string {
  if (el instanceof HTMLSelectElement) return cleanText(el.selectedOptions[0]?.textContent) || el.value;
  if (el instanceof HTMLInputElement) { if (el.type === "checkbox" || el.type === "radio") return el.checked ? "Yes" : "No"; return el.value || "All"; }
  if (el instanceof HTMLTextAreaElement) return el.value || "All";
  return cleanText(el.textContent);
}
function collectFilters(root: HTMLElement): ExportMatrix {
  const scoped = Array.from(root.querySelectorAll("[data-report-filters] input,[data-report-filters] select,[data-report-filters] textarea")).filter(isVisibleForExport);
  const controls = scoped.length ? scoped : Array.from(root.querySelectorAll("input:not([type=file]):not([type=hidden]),select,textarea")).filter(el => isVisibleForExport(el) && !el.closest("[role=dialog],.modal,[data-no-export]"));
  const rows: ExportMatrix = [["Filter", "Value"]];
  const seen = new Set<string>();
  controls.forEach(el => { const label=controlLabel(el); const value=controlValue(el); const key=`${label}|${value}`; if(!seen.has(key)){rows.push([label,value]);seen.add(key);} });
  root.querySelectorAll<HTMLElement>("[data-report-filter-value]").forEach(el => { if (isVisibleForExport(el)) rows.push([el.dataset.reportFilterLabel || "Filter", cleanText(el.textContent)]); });
  const activeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("button.btn-primary")).filter(button => isVisibleForExport(button) && !button.closest("[data-no-export]") && !/new|add|save|refresh|print|post|receive|pay/i.test(cleanText(button.textContent)));
  activeButtons.forEach(button => { const value=cleanText(button.textContent); if(value) rows.push(["Selected View / Status",value]); });
  return rows.length > 1 ? rows : [];
}
function collectSummary(root: HTMLElement): ExportMatrix {
  const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-export-summary] > *, [data-export-summary-item], .summary-card, #order-book-report > section.grid > *")).filter(isVisibleForExport);
  const rows: ExportMatrix = [["Metric", "Value"]];
  const seen = new Set<string>();
  cards.forEach(card => {
    const label = cleanText(card.querySelector<HTMLElement>("[data-summary-label],.summary-label")?.textContent) || cleanText(card.children[0]?.textContent);
    const value = cleanText(card.querySelector<HTMLElement>("[data-summary-value],.summary-value")?.textContent) || cleanText(card.children[1]?.textContent);
    if (label && value && !seen.has(`${label}|${value}`)) { rows.push([label, value]); seen.add(`${label}|${value}`); }
  });
  return rows.length > 1 ? rows : [];
}
function tableMatrix(table: HTMLTableElement, includeTotals: boolean): ExportMatrix {
  const headerCells = Array.from(table.querySelectorAll("thead tr:first-child th"));
  const actionIndexes = new Set(headerCells.map((cell, index) => ({ index, label: cleanText(cell.textContent) })).filter(x => isActionHeader(x.label)).map(x => x.index));
  const rows = Array.from(table.querySelectorAll("tr")).filter(row => isVisibleForExport(row) && (includeTotals || !(row.closest("tfoot") || row.matches("[data-report-total],.report-total-row"))));
  return rows.map(row => Array.from(row.children).filter((cell, index) => !actionIndexes.has(index) && isVisibleForExport(cell)).map(cell => cleanText(cell.textContent))).filter(row => row.some(Boolean));
}
export function collectReportPackage(root: HTMLElement, title = document.title || "NAVILO Report", options?: { includeTotals?: boolean; includeFilters?: boolean }): ExportPackage {
  const includeTotals = options?.includeTotals !== false;
  const includeFilters = options?.includeFilters !== false;
  const sheets: ExportSheet[] = [];
  const filterRows = includeFilters ? collectFilters(root) : [];
  const summaryRows = collectSummary(root);
  const overview: ExportMatrix = [["Report", title], ["Exported At", new Date().toLocaleString()]];
  if (filterRows.length) overview.push([], ["Applied Filters"], ...filterRows);
  if (summaryRows.length) overview.push([], ["Summary"], ...summaryRows);
  if (overview.length > 2) sheets.push({ name: "Summary & Filters", rows: overview });
  Array.from(root.querySelectorAll<HTMLTableElement>("table")).filter(isVisibleForExport).forEach((table, index) => {
    const matrix = tableMatrix(table, includeTotals); if (!matrix.length) return;
    const heading = table.closest("section,div")?.querySelector<HTMLElement>("h1,h2,h3,[data-export-table-title]");
    sheets.push({ name: cleanText(heading?.textContent) || (index === 0 ? "Report Data" : `Table ${index + 1}`), rows: matrix });
  });
  if (!sheets.length) sheets.push({ name: "Report Data", rows: [["No data for current filters"]] });
  return { title, sheets };
}
export function exportDomReportToExcel(filename: string, root: HTMLElement, title?: string, options?: { includeTotals?: boolean; includeFilters?: boolean }) { exportPackageToExcel(filename, collectReportPackage(root, title, options)); }
export function exportDomReportToCSV(filename: string, root: HTMLElement, title?: string, options?: { includeTotals?: boolean; includeFilters?: boolean }) { exportPackageToCSV(filename, collectReportPackage(root, title, options)); }
export function exportDomReportToWord(filename: string, root: HTMLElement, title?: string, options?: { includeTotals?: boolean; includeFilters?: boolean }) { exportPackageToWord(filename, collectReportPackage(root, title, options)); }

export function triggerPrint(selector?: string): void {
  const target = selector ? document.querySelector<HTMLElement>(selector) : document.querySelector<HTMLElement>(".print-document") || document.querySelector<HTMLElement>("[data-print-root]") || document.querySelector<HTMLElement>(".print-report");
  if (!target) { window.print(); return; }
  const stableSelector = selector || (target.id ? `#${CSS.escape(target.id)}` : target.classList.contains("print-document") ? ".print-document" : target.classList.contains("print-report") ? ".print-report" : undefined);
  window.dispatchEvent(new CustomEvent("navilo:print-preview", { detail: { selector: stableSelector, title: document.title || "NAVILO" } }));
}
