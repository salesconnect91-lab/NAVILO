export type ExportCell=string|number;
export type ReportTable={title:string;description:string;columns:string[];rows:ExportCell[][]};
const escapeHtml=(v:ExportCell)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function exportPartyReport(table:ReportTable,format:'xlsx'|'pdf'|'print'){
 const filename=table.title.replace(/[^a-z0-9]+/gi,'-');
 if(format==='xlsx'){
 const XLSX=await import('xlsx');const wb=XLSX.utils.book_new();
 // Explicit string cell types prevent party names/references from becoming formulas.
 const ws=XLSX.utils.aoa_to_sheet([[table.title],[table.description],[],table.columns,...table.rows]);
 ws['!cols']=table.columns.map(()=>({wch:22}));XLSX.utils.book_append_sheet(wb,ws,'Transport');XLSX.writeFile(wb,`${filename}.xlsx`);return;
 }
 if(format==='pdf'){
 const [{jsPDF},{default:autoTable}]=await Promise.all([import('jspdf'),import('jspdf-autotable')]);
 const pdf=new jsPDF({orientation:'landscape',unit:'mm',format:'a3'});pdf.setFontSize(13);pdf.text(table.title,12,12);pdf.setFontSize(8);
 const subtitle=pdf.splitTextToSize(table.description,390);pdf.text(subtitle,12,19);
 autoTable(pdf,{head:[table.columns],body:table.rows,startY:21+subtitle.length*4,styles:{fontSize:7},margin:12});pdf.save(`${filename}.pdf`);return;
 }
 const win=window.open('','_blank','width=1100,height=750');if(!win)throw new Error('Allow the print window for this report.');
 win.document.write(`<!doctype html><html><head><title>${escapeHtml(table.title)}</title><style>@page{size:A3 landscape;margin:10mm}body{font:11px Arial;color:#111}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:5px;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}h1{font-size:18px}</style></head><body><h1>${escapeHtml(table.title)}</h1><p>${escapeHtml(table.description)}</p><table><thead><tr>${table.columns.map(v=>`<th>${escapeHtml(v)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(r=>`<tr>${r.map(v=>`<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`);
 win.document.close();win.focus();win.print();
}
