/** Print-only presentation. Never changes financial values or the on-screen report. */
import {printReportDescription,escapePrintHtml} from '@/lib/printDocument';
import {financialNumber} from './transportFinancialTypes';
import type {ExportCell,ReportTable} from './transportPartyExport';

export type TransportPrintSection={title:string;indexes:number[];columns:string[];rows:ExportCell[][]};
export type TransportPaper={paper:'a4'|'a3';orientation:'portrait'|'landscape'};

export function transportPrintPaper(columnCount:number):TransportPaper {
 return {paper:columnCount>14?'a3':'a4',orientation:columnCount>=7?'landscape':'portrait'};
}

export function transportPrintSections(report:ReportTable):TransportPrintSection[] {
 if(!report.columns.length)return [];
 const width=report.columns.length;
 if(width<=9)return [{title:'Statement details',indexes:report.columns.map((_,i)=>i),columns:report.columns,rows:report.rows}];
 // Put financial evidence first; keep the original fields in supporting sections.
 // Repeating identifying columns makes multi-page printouts reconcilable without hiding data.
 const identifiers=report.columns.flatMap((c,i)=>/^(trip|date|party|document|bill|invoice|customer|supplier(?:\s*\/\s*owner)?|voucher)$/i.test(c.trim())?[i]:[]).slice(0,4);
 if(!identifiers.length)identifiers.push(0);
 const anchor=new Set(identifiers);
 const limit=9-identifiers.length;
 const financial=report.columns.flatMap((_,i)=>!anchor.has(i)&&report.rows.slice(0,30).some(row=>typeof row[i]==='number')?[i]:[]);
 const first=financial.slice(0,limit);
 if(!first.length)first.push(...report.columns.flatMap((_,i)=>!anchor.has(i)?[i]:[]).slice(0,limit));
 const used=new Set([...identifiers,...first]);
 const positions:number[][]=[[...identifiers,...first]];
 const remaining=report.columns.flatMap((_,i)=>!used.has(i)?[i]:[]);
 for(let i=0;i<remaining.length;i+=limit)positions.push([...identifiers,...remaining.slice(i,i+limit)]);
 return positions.map((indexes,i)=>({
   title:i===0?'Financial overview':`Supporting detail ${i} of ${positions.length-1}`,
   indexes,columns:indexes.map(index=>report.columns[index]),
   rows:report.rows.map(row=>indexes.map(index=>row[index]??'')),
 }));
}

export function transportPrintTotalRow(row:ExportCell[]):boolean {
 return row.slice(0,2).some(cell=>/^(?:TOTAL(?:$|\s*[·/])|CLOSING(?:$|\s*[·/])|NET (?:PROFIT|BALANCE)(?:$|\s*[·/]))/i.test(String(cell??'').trim()));
}

const textValue=(cell:ExportCell):string=>typeof cell==='number'?financialNumber(cell):cell==='TOTAL · full filter'?'TOTAL':String(cell??'');
const cellMarkup=(cell:ExportCell)=>`<td${typeof cell==='number'?' class="trp-num"':''}>${escapePrintHtml(textValue(cell))}</td>`;
const rowsMarkup=(rows:ExportCell[][])=>rows.map(row=>`<tr${transportPrintTotalRow(row)?' class="trp-total"':''}>${row.map(cellMarkup).join('')}</tr>`).join('');
const tableMarkup=(section:TransportPrintSection)=>{
 const last=section.rows[section.rows.length-1];
 const hasTotal=Boolean(last&&transportPrintTotalRow(last));
 const body=hasTotal?section.rows.slice(0,-1):section.rows;
 return `<table class="trp-table"><caption>${escapePrintHtml(section.title)}</caption><thead><tr>${section.columns.map(c=>`<th>${escapePrintHtml(c)}</th>`).join('')}</tr></thead><tbody>${body.length?rowsMarkup(body):`<tr><td colspan="${section.columns.length}">No records for the selected filters.</td></tr>`}</tbody>${hasTotal?`<tfoot>${rowsMarkup([last])}</tfoot>`:''}</table>`;
};

/** For the global NAVILO print button; the controller adds company branding and page numbering. */
export function transportRegisteredPrintMarkup(report:ReportTable):string {
 const sections=transportPrintSections(report);
 const orientation=transportPrintPaper(report.columns.length).orientation;
 return `<div data-print-primary-source data-print-report-title="${escapePrintHtml(report.title)}" data-report-orientation="${orientation}"><p data-print-description>${escapePrintHtml(printReportDescription(report.description))}</p>${sections.map(s=>tableMarkup(s)).join('')}</div>`;
}

export const TRANSPORT_REPORT_PRINT_CSS=`
@page{size:__PAPER__ __ORIENTATION__;margin:8mm}
html,body{margin:0;background:white;color:#15243b;font-family:Arial,Helvetica,sans-serif;font-size:9pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.transport-financial-print{width:100%;max-width:100%;background:white}
.transport-financial-print .trp-header{display:flex;justify-content:space-between;align-items:flex-end;gap:8mm;border-bottom:2px solid #234c74;padding:0 0 3mm;margin-bottom:3mm}
.transport-financial-print .trp-brand{font-size:15pt;font-weight:800;color:#12375d;letter-spacing:.025em}
.transport-financial-print .trp-company{font-size:8pt;color:#455970;margin-top:1mm}
.transport-financial-print .trp-meta{text-align:right;font-size:7pt;color:#55677b;line-height:1.5}
.transport-financial-print h1{font-size:13pt;font-weight:800;line-height:1.25;margin:0 0 1mm;color:#122d4e}
.transport-financial-print .trp-criteria{font-size:7.5pt;color:#43566d;line-height:1.35;margin:0 0 3mm;overflow-wrap:anywhere}
.transport-financial-print h2{font-size:9pt;color:#12375d;margin:2mm 0 2mm;border-bottom:1px solid #d5dee8;padding-bottom:1mm}
.transport-financial-print .trp-table{border-collapse:collapse;table-layout:auto;width:100%;font-size:7.5pt;line-height:1.3;margin:0 0 3mm}
.transport-financial-print .trp-table caption{text-align:left;font-size:0;height:0;overflow:hidden}
.transport-financial-print .trp-table thead{display:table-header-group}
.transport-financial-print .trp-table tfoot{display:table-footer-group}
.transport-financial-print .trp-table th{background:#153e69;color:#fff;border:1px solid #153e69;padding:2mm 1.6mm;text-align:left;overflow-wrap:anywhere;font-size:7pt;vertical-align:top}
.transport-financial-print .trp-table td{border-bottom:1px solid #d8e1e9;padding:1.6mm;vertical-align:top;overflow-wrap:anywhere}
.transport-financial-print .trp-table tbody tr:nth-child(even) td{background:#f6f9fc}
.transport-financial-print .trp-table .trp-num{text-align:right;white-space:nowrap;overflow-wrap:normal;font-variant-numeric:tabular-nums}
.transport-financial-print .trp-table tr{break-inside:avoid;page-break-inside:avoid}
.transport-financial-print .trp-table .trp-total td,.transport-financial-print .trp-table tfoot td{font-weight:800;background:#e8f0f9;border-top:1.5px solid #234c74;border-bottom:1.5px solid #234c74}
.transport-financial-print .trp-annotation{font-size:7pt;color:#596b80;padding:1mm 0 2mm}
`;

export function transportStandalonePrintHtml(report:ReportTable,date=new Date(),identity?:{companyName?:string;businessUnitName?:string}):string {
 const layout=transportPrintPaper(report.columns.length);
 const styles=TRANSPORT_REPORT_PRINT_CSS.replace('__PAPER__',layout.paper.toUpperCase()).replace('__ORIENTATION__',layout.orientation);
 const criteria=printReportDescription(report.description);
 const scope=criteria.split(' · ')[0]||'Financial report';
 const companyName=identity?.companyName?.trim()||scope.split('/')[0]?.trim()||'Company';
 const businessUnitName=identity?.businessUnitName?.trim()||scope.split('/').slice(1).join('/').trim();
 const sections=transportPrintSections(report);
 const printed=new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapePrintHtml(report.title)}</title><style>${styles}</style></head><body><article class="transport-financial-print"><header class="trp-header"><div><div class="trp-brand">${escapePrintHtml(companyName)}</div><div class="trp-company">${escapePrintHtml(businessUnitName||'Financial reporting')}</div></div><div class="trp-meta">FINANCIAL REPORT · BASE CURRENCY<div>Prepared ${escapePrintHtml(printed)}</div></div></header><h1>${escapePrintHtml(report.title)}</h1><p class="trp-criteria">${escapePrintHtml(criteria)}</p>${sections.map(section=>`<section class="trp-section"><h2>${escapePrintHtml(section.title)}</h2>${tableMarkup(section)}</section>`).join('')}<p class="trp-annotation">Financial amounts are reproduced from the report without recalculation. Supporting sections repeat reference columns for matching.</p></article></body></html>`;
}
