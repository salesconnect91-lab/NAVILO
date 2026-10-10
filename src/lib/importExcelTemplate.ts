import * as XLSX from 'xlsx';

export type ImportTemplateGuide={field:string;rule:string};
export type ImportTemplateSpec={
 filename:string;sheetName:string;headers:readonly string[];
 example:readonly (string|number|null)[];
 title:string;notes:readonly string[];
 fields?:readonly ImportTemplateGuide[];
};

/**
 * First sheet is always the raw upload schema; extra documentation is on
 * separate sheets so existing NAVILO import parsers keep reading row one.
 */
export function createImportTemplateWorkbook(spec:ImportTemplateSpec):XLSX.WorkBook{
 if(spec.headers.length!==spec.example.length)throw new Error(`Template ${spec.sheetName}: example does not match headers`);
 const book=XLSX.utils.book_new();
 const sheet=XLSX.utils.aoa_to_sheet([[...spec.headers],[...spec.example]]);
 sheet['!cols']=spec.headers.map(h=>({wch:Math.min(36,Math.max(15,h.length+3))}));
 sheet['!autofilter']={ref:`A1:${XLSX.utils.encode_col(spec.headers.length-1)}2`};
 XLSX.utils.book_append_sheet(book,sheet,spec.sheetName);
 const instructions=[
  ['NAVILO IMPORT TEMPLATE',spec.title],
  ['IMPORTANT','Replace the sample row with your own records before uploading.'],
  ['SCOPE','Import affects the currently selected and authorized Company/Business Unit only.'],
  ['DATES','Use YYYY-MM-DD (example: 2026-10-10).'],
  ['AMOUNTS','Use numeric values with a maximum of two decimal places unless a field says otherwise.'],
  ...spec.notes.map(note=>['NOTE',note]),
  ['',''],
  ['COLUMN','VALIDATION / PURPOSE'],
  ...(spec.fields?.length?spec.fields.map(f=>[f.field,f.rule]):spec.headers.map(h=>[h,'See module validation; match the column heading exactly.']))
 ];
 const help=XLSX.utils.aoa_to_sheet(instructions);
 help['!cols']=[{wch:32},{wch:102}];
 XLSX.utils.book_append_sheet(book,help,'Instructions');
 return book;
}

export function downloadImportTemplate(spec:ImportTemplateSpec):void{
 XLSX.writeFile(createImportTemplateWorkbook(spec),spec.filename);
}
