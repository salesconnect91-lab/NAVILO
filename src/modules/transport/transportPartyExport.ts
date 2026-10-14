import { createPrintDocument, printReportDescription } from "@/lib/printDocument";
import {transportPrintPaper,transportPrintSections,transportStandalonePrintHtml,transportPrintTotalRow} from './transportReportPrint';
import {financialNumber} from './transportFinancialTypes';
export type ExportCell=string|number;
export type ReportTable={title:string;description:string;columns:string[];rows:ExportCell[][]};
export const reportCellText=(value:ExportCell)=>typeof value==='number'?financialNumber(value):value==='TOTAL · full filter'?'TOTAL':value;
export async function exportPartyReport(table:ReportTable,format:'xlsx'|'pdf'|'print',identity?:{companyName?:string;businessUnitName?:string}){
 const {paper,orientation}=transportPrintPaper(table.columns.length);
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
 const pdf=new jsPDF({orientation,unit:'mm',format:paper});
 pdf.setProperties({title:table.title,subject:'NAVILO financial report'});
 const sections=transportPrintSections(table);
 sections.forEach((section,sectionIndex)=>{
   if(sectionIndex)pdf.addPage(paper,orientation);
   const pageWidth=pdf.internal.pageSize.getWidth();
   const criteria=pdf.splitTextToSize(printDescription,pageWidth-22);
   const headerBottom=34+criteria.length*3;
   const numericIndexes=section.columns.flatMap((_,i)=>section.rows.slice(0,30).some(row=>typeof row[i]==='number')?[i]:[]);
   const columnStyles=Object.fromEntries(numericIndexes.map(i=>[i,{halign:'right' as const}]));
   const totalRow=section.rows[section.rows.length-1];
   const hasTotal=Boolean(totalRow&&transportPrintTotalRow(totalRow));
   autoTable(pdf,{
     head:[section.columns],
     body:(hasTotal?section.rows.slice(0,-1):section.rows).map(row=>row.map(reportCellText)),
     foot:hasTotal?[totalRow.map(reportCellText)]:undefined,
     showFoot:'lastPage',
     startY:headerBottom+4,
     margin:{top:headerBottom+4,left:10,right:10,bottom:17},
     theme:'grid',
     styles:{font:'helvetica',fontSize:7,cellPadding:1.6,overflow:'linebreak',lineColor:[217,226,235],lineWidth:0.1,textColor:[24,39,59]},
     headStyles:{fillColor:[21,62,105],textColor:255,fontStyle:'bold'},
     footStyles:{fillColor:[232,240,249],textColor:[18,45,78],fontStyle:'bold'},
     alternateRowStyles:{fillColor:[247,250,252]},
     columnStyles,
     didDrawPage:()=>{
       pdf.setFont('helvetica','bold');pdf.setFontSize(14);pdf.setTextColor(18,55,93);
       pdf.setFontSize(9);pdf.text(identity?.companyName||printDescription.split(' · ')[0].split('/')[0]||'Company',10,10);
       pdf.setFontSize(14);pdf.text(table.title,10,17);
       pdf.setFontSize(8);pdf.text(section.title,10,23);
       pdf.setFont('helvetica','normal');pdf.setFontSize(7);pdf.setTextColor(76,96,115);
       pdf.text(criteria,10,30);
       pdf.setDrawColor(31,72,116);pdf.line(10,headerBottom,pageWidth-10,headerBottom);
     },
   });
 });
 const count=pdf.getNumberOfPages();
 for(let n=1;n<=count;n++){
   pdf.setPage(n);pdf.setFont('helvetica','normal');pdf.setFontSize(7);pdf.setTextColor(95,111,129);
   pdf.line(10,pdf.internal.pageSize.getHeight()-13,pdf.internal.pageSize.getWidth()-10,pdf.internal.pageSize.getHeight()-13);
   pdf.text(`Page ${n} / ${count}`,pdf.internal.pageSize.getWidth()-10,pdf.internal.pageSize.getHeight()-9,{align:'right'});
 }
 pdf.save(`${filename}.pdf`);return;
 }
 const win=createPrintDocument();if(!win)throw new Error('Allow the print window for this report.');
 win.document.write(transportStandalonePrintHtml(table,new Date(),identity));
 win.document.close();win.focus();win.print();
}
