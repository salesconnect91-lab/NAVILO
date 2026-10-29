import * as XLSX from 'xlsx';

export type ImportTemplateGuide={field:string;rule:string};

/** Parse NAVILO import dates consistently. Display/input format is dd-mmm-yy (15-Oct-26); ISO and Excel dates remain accepted for backward compatibility. */
export function parseNaviloImportDate(input:unknown):string{
 const valid=(y:number,m:number,d:number)=>{
  const dt=new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d?dt.toISOString().slice(0,10):'';
 };
 if(input instanceof Date&&!Number.isNaN(input.getTime()))return valid(input.getUTCFullYear(),input.getUTCMonth()+1,input.getUTCDate());
 if(typeof input==='number'&&Number.isFinite(input)&&input>20000&&input<80000){
  const dt=new Date(Date.UTC(1899,11,30)+Math.floor(input)*86400000);
  return valid(dt.getUTCFullYear(),dt.getUTCMonth()+1,dt.getUTCDate());
 }
 const s=String(input??'').trim().replace(/^\\|+|\\|+$/g,'').trim();if(!s)return '';
 const iso=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[Tt ].*)?$/);
 if(iso)return valid(+iso[1],+iso[2],+iso[3]);
 const named=s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2}|\d{4})$/);
 if(named){
  const m=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[2].toLowerCase().slice(0,3))+1;
  const yr=named[3].length===2?2000+Number(named[3]):Number(named[3]);
  return m?valid(yr,m,Number(named[1])):'';
 }
 const slash=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
 if(slash)return valid(slash[3].length===2?2000+Number(slash[3]):Number(slash[3]),Number(slash[1]),Number(slash[2]));
 return '';
}

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
 if(spec.example.length>0 && spec.headers.length!==spec.example.length)throw new Error(`Template ${spec.sheetName}: example does not match headers`);
 const book=XLSX.utils.book_new();
 const sheet=XLSX.utils.aoa_to_sheet([[...spec.headers]]);
 sheet['!cols']=spec.headers.map(h=>({wch:Math.min(36,Math.max(15,h.length+3))}));
 sheet['!autofilter']={ref:`A1:${XLSX.utils.encode_col(spec.headers.length-1)}1`};
 XLSX.utils.book_append_sheet(book,sheet,spec.sheetName);
 const instructions=[
  ['NAVILO IMPORT TEMPLATE',spec.title],
  ['IMPORTANT','Blank upload sheet: add real records starting in row 2. Example values are shown only on this Instructions sheet and must never be uploaded as live data.'],
  ['SCOPE','Import affects the currently selected and authorized Company/Business Unit only.'],
  ['DATES','Use dd-mmm-yy (example: 15-Oct-26). NAVILO also accepts existing YYYY-MM-DD dates and real Excel date cells.'],
  ['AMOUNTS','Use numeric values with a maximum of two decimal places unless a field says otherwise.'],
  ...(spec.example.length?[['EXAMPLE ONLY — DO NOT IMPORT',spec.example.map((v,i)=>`${spec.headers[i]}: ${String(v??'')}`).join(' | ')]]:[]),
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
