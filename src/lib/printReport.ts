import type {CompanyDocumentSettings, DocumentVisibility} from "./documentPrintSettings";
import {clonePrintSource, escapePrintHtml, printReportDescription, type PrintOrientation} from './printDocument';
export type PrintIdentity = {companyName: string; businessUnitName: string; platformName?: string};
const text = (node: Element | null) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
const UI = '[data-no-print],.no-print,.print\\:hidden,[data-print-ui],nav,aside,[role=dialog],details';

function labelOf(control: HTMLElement) {
  const aria = control.getAttribute('aria-label') || control.dataset.printLabel;
  if (aria) return aria;
  if (control.id) {const label = document.querySelector(`label[for="${CSS.escape(control.id)}"]`); if (label) return text(label);}
  const label = control.closest('label');
  if (label) {
    const copy = label.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('input,select,textarea,[data-print-control],button').forEach(n => n.remove());
    if (text(copy)) return text(copy);
  }
  return control.getAttribute('placeholder') || control.getAttribute('name') || 'Filter';
}
function dateText(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [y,m,d] = value.split('-');
  return `${d}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m)-1]}-${y.slice(2)}`;
}
export function reportFilterSnapshot(target: HTMLElement) {
  const scope = target.closest('[data-report-root]') || target.closest('[role=dialog]') || target.closest('main') || target;
  const scoped = Array.from(scope.querySelectorAll<HTMLElement>('[data-report-filters] input,[data-report-filters] select,[data-report-filters] textarea,[data-report-filters] [data-print-control]'));
  const controls = scoped.length ? scoped : Array.from(scope.querySelectorAll<HTMLElement>('input,select,textarea,[data-print-control]'));
  const seen = new Set<string>();
  const filters = controls.flatMap(control => {
    if (control.closest('table,[data-navilo-data-table],details,[data-no-export]') || (control.closest('[role=dialog]') && control.closest('[role=dialog]') !== scope)) return [];
    if (control instanceof HTMLInputElement && ['hidden','radio','file'].includes(control.type)) return [];
    // A compatibility select already represents this searchable control.
    if (control.hasAttribute('data-print-control') && control.querySelector('select')) return [];
    let value = control.dataset.printControl;
    if (control instanceof HTMLSelectElement) value = text(control.selectedOptions[0]);
    else if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) value = control instanceof HTMLInputElement && control.type === 'checkbox' ? (control.checked ? 'Yes' : 'No') : control.value;
    if (!value) return [];
    const label = labelOf(control), normalized = dateText(value), key = `${label}:${normalized}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{label,value:normalized}];
  });
  scope.querySelectorAll<HTMLElement>('[data-report-filter-value]').forEach(node=>{const value=node.dataset.reportFilterValue||text(node),label=node.dataset.reportFilterLabel||'Selection';if(value&&!seen.has(`${label}:${value}`))filters.push({label,value});});
  return filters;
}

/** Preserve data labels inside sorting/link buttons, while dropping action columns and UI. */
export function cleanReportTable(table: HTMLTableElement) {
  const clone = table.cloneNode(true) as HTMLTableElement;
  const cells = Array.from(clone.querySelectorAll<HTMLTableCellElement>('thead tr:last-child th'));
  const actionIndexes = cells.flatMap((cell,index) => /^(actions?|select rows)$/i.test(text(cell)) || cell.hasAttribute('data-no-print') ? [index] : []).reverse();
  Array.from(clone.rows).forEach(row => actionIndexes.forEach(i => {
    // Do not remove an unrelated totals cell from a spanning row.
    if (Array.from(row.cells).every(c => c.colSpan === 1)) row.cells[i]?.remove();
  }));
  clone.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea').forEach(control=>{
    if(control.closest(UI))return;
    const value=control instanceof HTMLSelectElement?text(control.selectedOptions[0]):control instanceof HTMLInputElement&&control.type==='checkbox'?(control.checked?'Yes':'No'):control.value;
    control.replaceWith(document.createTextNode(value));
  });
  clone.querySelectorAll<HTMLElement>('*').forEach(el => {
    if (el.style.display === 'none' || el.hidden || el.matches(UI)) {el.remove(); return;}
    if (el.matches('input,select,textarea,svg,[aria-hidden=true]')) {el.remove(); return;}
    if (el.matches('button,a')) {el.replaceWith(document.createTextNode(text(el))); return;}
    if(el.tagName==='TD' && el.children.length===0 && /^\d{4}-\d{2}-\d{2}$/.test(text(el)))el.textContent=dateText(text(el));
    el.removeAttribute('style');
    el.removeAttribute('width');
    el.removeAttribute('height');
    const numeric = el.classList.contains('text-right') || el.classList.contains('invoice-num') || (el.tagName==='TD' && /^[-+]?\d[\d,]*(?:\.\d+)?$/.test(text(el)));
    el.className = numeric ? 'print-number' : '';
  });
  clone.removeAttribute('style'); clone.removeAttribute('class');
  return clone;
}

export async function buildReport(target: HTMLElement, identity: PrintIdentity, title?: string) {
  const statusRoot = target.closest('[data-report-root],main') || target;
  const error = statusRoot.matches('[data-print-error]') ? statusRoot : statusRoot.querySelector('[data-print-error]');
  if (error) throw new Error(`Report could not be loaded: ${text(error)} Refresh the report before printing.`);
  if (statusRoot.querySelector('[aria-busy=true]') || Array.from(statusRoot.querySelectorAll('[role=status],p,div,td')).some(node=>!node.closest('button,details,[data-no-print]') && /^loading\b.{0,150}(?:…|\.{3})$/i.test(text(node))) || statusRoot.getAttribute('aria-busy') === 'true') throw new Error('Wait for the report to finish loading before printing.');
  const filters = reportFilterSnapshot(target);
  const clone = await clonePrintSource(target);
  const reportTitle = text(target.querySelector('.page-title,h1,h2')) || text(target.closest('main,[role=dialog]')?.querySelector('.page-title,h1,h2') || null) || title || 'Report';
  const primary = clone.querySelector<HTMLElement>('[data-print-primary-source]');
  const tables = [...((primary || clone).matches('table') ? [(primary || clone) as HTMLTableElement] : []),...Array.from((primary || clone).querySelectorAll<HTMLTableElement>('table'))].filter(table => (Boolean(primary) || !table.closest('[role=dialog],details,[data-no-print],.no-print')) && table.style.display !== 'none').map(cleanReportTable);
  const summaries = Array.from(clone.querySelectorAll<HTMLElement>('.summary-card,[data-export-summary-item]')).map(card => ({label:text(card.querySelector('.summary-label,[data-summary-label]') || card.children[0] || null), value:text(card.querySelector('.summary-value,[data-summary-value]') || card.children[1] || null)})).filter(row=>row.label && row.value);
  const report = document.createElement('article'); report.className = 'navilo-report-document';
  const printedAt = new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date());
  report.innerHTML = `<header class="document-heading"><div><strong>${escapePrintHtml(identity.companyName)}</strong>${identity.businessUnitName?`<div>${escapePrintHtml(identity.businessUnitName)}</div>`:''}</div><div><h1>${escapePrintHtml(reportTitle)}</h1><small>Printed: ${escapePrintHtml(printedAt)}</small></div></header>`;
  const scope = target.dataset.printScope || target.querySelector<HTMLElement>('[data-print-scope]')?.dataset.printScope;
  if(scope) report.insertAdjacentHTML('beforeend',`<p class="document-scope"><strong>Report scope:</strong> ${escapePrintHtml(scope)}</p>`);
  if (filters.length) report.insertAdjacentHTML('beforeend',`<section class="document-filters"><strong>Applied filters</strong><div>${filters.map(f=>`<span><b>${escapePrintHtml(f.label)}:</b> ${escapePrintHtml(f.value)}</span>`).join('')}</div></section>`);
  if (summaries.length) report.insertAdjacentHTML('beforeend',`<section class="document-summary">${summaries.map(r=>`<div><span>${escapePrintHtml(r.label)}</span><strong>${escapePrintHtml(r.value)}</strong></div>`).join('')}</section>`);
  const descriptions = Array.from((primary || clone).querySelectorAll<HTMLElement>('[data-print-description]')).map(node=>printReportDescription(text(node))).filter(Boolean);
  if(descriptions.length)report.insertAdjacentHTML('beforeend',`<p class="document-scope">${[...new Set(descriptions)].map(escapePrintHtml).join(' · ')}</p>`);
  tables.forEach((table,index) => {
    const caption=table.caption;
    if(caption && text(caption)===reportTitle)caption.remove();
    if (tables.length > 1) {const h = document.createElement('h2');h.textContent=`${reportTitle} · Section ${index+1}`;report.appendChild(h);}
    report.appendChild(table);
  });
  if (!tables.length && !summaries.length) {
    const empty=clone.matches('[data-print-empty]')?clone:clone.querySelector('[data-print-empty]');
    if(empty)report.insertAdjacentHTML('beforeend',`<p>${escapePrintHtml(text(empty))}</p>`);
    else throw new Error('This screen has no document or report data to print. Open the relevant report first.');
  }
  const preferred = primary?.dataset.reportOrientation || primary?.querySelector<HTMLElement>('[data-report-orientation]')?.dataset.reportOrientation || (!primary ? target.querySelector<HTMLElement>('[data-report-orientation]')?.dataset.reportOrientation || target.closest<HTMLElement>('[data-report-orientation]')?.dataset.reportOrientation : undefined);
  const width = tables.reduce((max,t)=>Math.max(max,Array.from(t.tHead?.rows[0]?.cells || []).reduce((sum,c)=>sum+c.colSpan,0)),0);
  const orientation: PrintOrientation = preferred === 'portrait' || preferred === 'landscape' ? preferred : width >= 7 ? 'landscape' : 'portrait';
  return {html:report.outerHTML,title:reportTitle,orientation};
}

export function applyReportPrintSettings(html: string, settings: {company: CompanyDocumentSettings; visibility: DocumentVisibility}) {
  const doc=new DOMParser().parseFromString(html,'text/html');
  const header=doc.querySelector('.document-heading>div:first-child'), report=doc.querySelector('article'), {company,visibility:v}=settings;
  if(header){
    if(!v.show_company_name)header.querySelector('strong')?.remove();
    if(v.show_logo&&company.logo_url){const img=doc.createElement('img');img.src=company.logo_url;img.alt='Company logo';img.style.cssText='max-height:14mm;max-width:50mm;object-fit:contain;display:block;margin-bottom:2mm';header.prepend(img);}
    const lines=[v.show_address?company.address:'',v.show_phone_email?[company.phone,company.email].filter(Boolean).join(' · '):'',v.show_tax_details?[company.ntn?`NTN: ${company.ntn}`:'',company.strn?`STRN: ${company.strn}`:''].filter(Boolean).join(' · '):''];
    lines.filter(Boolean).forEach(line=>{const node=doc.createElement('div');node.style.fontSize='8pt';node.textContent=line||'';header.appendChild(node);});
  }
  if(!v.show_print_datetime)doc.querySelector('.document-heading small')?.remove();
  if(v.show_header&&company.document_header){const node=doc.createElement('p');node.className='document-note';node.textContent=company.document_header;doc.querySelector('.document-heading')?.after(node);}
  if(v.show_signatures&&report){const node=doc.createElement('section');node.className='document-signatures';[company.prepared_by_label||'Prepared By',company.checked_by_label||'Checked By',company.approved_by_label||'Approved By'].forEach(label=>{const cell=doc.createElement('div');cell.textContent=label;node.appendChild(cell);});report.appendChild(node);}
  if(v.show_footer&&company.document_footer&&report){const node=doc.createElement('p');node.className='document-note';node.textContent=company.document_footer;report.appendChild(node);}
  return doc.body.innerHTML;
}

export const REPORT_DOCUMENT_CSS = `
.document-signatures{display:flex;justify-content:space-between;gap:6mm;margin-top:8mm;margin-bottom:2mm}.document-signatures>div{flex:1;border-top:1px solid #64748b;text-align:center;padding-top:2mm;font-size:8pt}
body{font:9pt Arial,Helvetica,sans-serif;color:#172033;background:white;margin:0}
.document-heading{display:flex;justify-content:space-between;gap:6mm;border-bottom:1px solid #214e76;padding-bottom:2mm;margin-bottom:2mm}
.document-heading>div:last-child{text-align:right}.document-heading strong{font-size:12pt}.document-heading h1{font-size:13pt;margin:0 0 1mm}.document-heading small{font-size:8pt;color:#536477}
.document-filters{border:1px solid #cbd5e1;padding:1.5mm;margin-bottom:2mm;font-size:8pt}.document-filters>div{display:flex;flex-wrap:wrap;gap:1mm 3mm;margin-top:.5mm}
.document-summary{display:flex;flex-wrap:wrap;gap:2mm;margin-bottom:2mm}.document-summary>div{flex:1;min-width:30mm;border:1px solid #cbd5e1;padding:1.5mm}.document-summary span{display:block;font-size:8pt;color:#536477}.document-summary strong{display:block;font-size:10pt;margin-top:.5mm}
caption{text-align:left;font-size:8pt;font-weight:bold;color:#183e61;margin:2mm 0}h2{font-size:11pt;margin:2mm 0 1mm}table{width:100%;border-collapse:collapse;table-layout:auto;margin:0 0 3mm;font-size:8pt}th,td{padding:1mm 1.2mm;border:1px solid #cbd5e1;vertical-align:top;overflow-wrap:anywhere;white-space:normal}th{background:#edf2f7;font-size:7.5pt;text-align:left;color:#183e61}tfoot{font-weight:bold;background:#edf2f7}.print-number{white-space:nowrap;overflow-wrap:normal;text-align:right;font-variant-numeric:tabular-nums}thead{display:table-header-group}tr{break-inside:avoid}.document-note{white-space:pre-wrap;line-height:1.3}
`;

/** Applies to every preview/print route, including standalone legacy voucher builders. */
export const PRINT_COMPACT_CSS = `
.navilo-print-output{font-size:9pt;line-height:1.3}
.navilo-print-output h1{font-size:14pt!important;margin:0 0 2mm!important;line-height:1.2!important}
.navilo-print-output h2{font-size:11pt!important;margin:2mm 0 1mm!important}
.navilo-print-output p{margin:1mm 0 2mm}
.navilo-print-output :is(.header,.top){gap:5mm!important;padding-bottom:2mm!important;margin-bottom:2mm!important}
.navilo-print-output :is(.document-title,.section-title){margin:3mm 0 2mm!important}
.navilo-print-output .meta-item{min-height:0!important;padding:1.5mm 2mm!important}
.navilo-print-output .company{gap:4mm!important;padding-bottom:2mm!important}
.navilo-print-output .meta{gap:2mm 5mm!important;margin:3mm 0!important}
.navilo-print-output .sub{margin-top:1mm!important;margin-bottom:2mm!important}
.navilo-print-output .description{margin-top:3mm!important;padding:2mm!important}
.navilo-print-output .amount{margin:2mm 0!important;padding:2mm!important}
.navilo-print-output .footer{margin-top:3mm!important}
.navilo-print-output :is(.sig,.signatures,.footer:has(.signature)){margin-top:8mm!important;gap:6mm!important}
.navilo-print-output .row{padding:1.5mm 0!important}
.navilo-print-output table{margin-top:2mm!important;margin-bottom:2mm!important;font-size:8pt!important}
.navilo-print-output :is(th,td){padding:1mm 1.2mm!important;line-height:1.25!important}
.navilo-print-output :is(.toolbar,[data-print-ui],[data-no-print],.no-print){display:none!important}
`;
