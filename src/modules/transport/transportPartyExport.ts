import { createPrintDocument, printReportDescription } from "@/lib/printDocument";
import {financialNumber} from './transportFinancialTypes';
export type ExportCell=string|number;
export type ReportTable={title:string;description:string;columns:string[];rows:ExportCell[][]};
export const reportCellText=(value:ExportCell)=>typeof value==='number'?financialNumber(value):value==='TOTAL · full filter'?'TOTAL':value;
const escapeHtml=(v:ExportCell)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function exportPartyReport(table:ReportTable,format:'xlsx'|'pdf'|'print'){
 const paper=table.columns.length>14?'a3':'a4';
 const orientation=table.columns.length>=7?'landscape':'portrait';
 const printDescription=printReportDescription(table.description);
 const filename=table.title.replace(/[^a-z0-9]+/gi,'-');
 if(format==='xlsx'){
 const XLSX=await import('xlsx');const wb=XLSX.utils.book_new();
 // Explicit string cell types prevent party names/references from becoming formulas.
 const ws=XLSX.utils.aoa_to_sheet([[table.title],[table.description],[],table.columns,...table.rows]);
 for(const key of Object.keys(ws)){if(!key.startsWith('!')&&ws[key]?.t==='n')ws[key].z='#,##0.00';}
 ws['!cols']=table.columns.map(()=>({wch:22}));XLSX.utils.book_append_sheet(wb,ws,'Transport');XLSX.writeFile(wb,`${filename}.xlsx`);return;
 }
 if(format==='pdf'){
 const [{jsPDF},{default:autoTable}]=await Promise.all([import('jspdf'),import('jspdf-autotable')]);
 const pdf=new jsPDF({orientation,unit:'mm',format:paper});pdf.setFontSize(13);pdf.text(table.title,12,12);pdf.setFontSize(8);
 const subtitle=pdf.splitTextToSize(printDescription,pdf.internal.pageSize.getWidth()-24);pdf.text(subtitle,12,19);
 autoTable(pdf,{head:[table.columns],body:table.rows.map(row=>row.map(reportCellText)),startY:20+subtitle.length*3,styles:{fontSize:7,cellPadding:1.2},margin:8});pdf.save(`${filename}.pdf`);return;
 }
 const win=createPrintDocument();if(!win)throw new Error('Allow the print window for this report.');
 win.document.write(`<!doctype html><html><head><title>${escapeHtml(table.title)}</title><style>@page{size:${paper.toUpperCase()} ${orientation};margin:8mm}body{font:11px Arial;color:#111}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:3px;text-align:left}.num{text-align:right;white-space:nowrap}thead{display:table-header-group}tr{break-inside:avoid}h1{font-size:18px}</style></head><body><h1>${escapeHtml(table.title)}</h1><p>${escapeHtml(printDescription)}</p><table><thead><tr>${table.columns.map(v=>`<th>${escapeHtml(v)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(r=>`<tr>${r.map(v=>`<td${typeof v==='number'?' class="num"':''}>${escapeHtml(reportCellText(v))}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`);
 win.document.close();win.focus();win.print();
}
