import {escapePrintHtml} from './printDocument';
import {transportRegisteredPrintMarkup} from '@/modules/transport/transportReportPrint';
import type {ReportTable,ExportCell} from '@/modules/transport/transportPartyExport';

export type PrintMatrix=Array<Array<string|number|null|undefined>>;
export type PrintMatrixSection={title:string;matrix:PrintMatrix};
/** Professional financial document from the same filtered rows as Excel/CSV.
 * Multi-column invoice/aging data is paginated into financial and supporting sections
 * without dropping fields or altering posting evidence.
 */
export function financialMatrixPrint(title:string,description:string,sections:PrintMatrixSection[]):string{
 const tables=sections.filter(s=>s.matrix.length>0&&s.matrix[0].length).map(section=>{
  const columns=section.matrix[0].map(x=>String(x??''));
  const rows=section.matrix.slice(1).map(r=>columns.map((_,i)=>r[i]??'' as ExportCell));
  const report:ReportTable={title:section.title,description:'',columns,rows:rows as ExportCell[][]};
  return '<section class="financial-matrix-section"><h3>'+escapePrintHtml(section.title)+'</h3>'+transportRegisteredPrintMarkup(report)+'</section>';
 });
 return '<div class="financial-matrix-document" data-report-orientation="landscape" data-print-report-title="'+escapePrintHtml(title)+'">'+
  '<h2>'+escapePrintHtml(title)+'</h2><p data-print-description>'+escapePrintHtml(description)+'</p>'+tables.join('')+'</div>';
}
