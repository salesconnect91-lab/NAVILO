import * as XLSX from 'xlsx';
import {createImportTemplateWorkbook,parseNaviloImportDate} from '@/lib/importExcelTemplate';

/**
 * Excel import includes explicit party fields for genuine AR/AP journal lines.
 * The Action column is a UI control and must not appear in an Excel data file.
 */
export const SIMPLE_JOURNAL_HEADERS=[
 'entry_no','entry_date','account_name','line_description','party_type','party_name','debit','credit'
] as const;
const str=(v:unknown)=>String(v??'').trim();
const key=(v:unknown)=>str(v).toLowerCase().replace(/[\s_-]+/g,'');
const validDate=(s:string)=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
 const d=new Date(s+'T00:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;
};
/** Accept ISO dates, Excel serial dates, or NAVILO dd-mmm-yy display dates. */
export function journalImportISODate(input:unknown):string{
 if(input instanceof Date && Number.isFinite(input.getTime())){
  const iso=`${input.getUTCFullYear()}-${String(input.getUTCMonth()+1).padStart(2,'0')}-${String(input.getUTCDate()).padStart(2,'0')}`;
  if(validDate(iso))return iso;
 }
 const value=str(input).replace(/^\|+|\|+$/g,'').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\u00a0/g,' ').trim();
 // Do not pass impossible ISO dates to permissive parsers that normalize them.
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return validDate(value)?value:'';
 const sharedDate=parseNaviloImportDate(value);
 if(validDate(sharedDate))return sharedDate;
 if(validDate(value))return value;
 const isoDateTime=value.match(/^(\d{4}-\d{2}-\d{2})(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)$/);
 if(isoDateTime&&validDate(isoDateTime[1]))return isoDateTime[1];
 const slash=value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
 if(slash){
  const month=Number(slash[1]),day=Number(slash[2]),rawYear=Number(slash[3]);
  const year=slash[3].length===2?2000+rawYear:rawYear;
  const iso=String(year)+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  if(validDate(iso))return iso;
 }
 if(/^\d{5}(?:\.\d+)?$/.test(value)){
  const serial=Number(value);
  if(Number.isFinite(serial)&&serial>20000&&serial<80000){
   const wholeDay=Math.floor(serial);
   const result=new Date(Date.UTC(1899,11,30)+wholeDay*86400000).toISOString().slice(0,10);
   if(validDate(result))return result;
  }
 }
 const named=value.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2}|\d{4})(?:\s+.*)?$/);
 if(named){
  const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const month=months.indexOf(named[2].toLowerCase().slice(0,3))+1;
  const yr=Number(named[3]);
  const year=named[3].length===2?2000+yr:yr;
  if(month){
   const iso=String(year)+'-'+String(month).padStart(2,'0')+'-'+String(Number(named[1])).padStart(2,'0');
   if(validDate(iso))return iso;
  }
 }
 const parsedTime=Date.parse(value);
 if(Number.isFinite(parsedTime)){
  const d=new Date(parsedTime);
  const iso=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  if(validDate(iso))return iso;
 }
 return value;
}
function money(input:unknown,line:number,name:string):number{
 const s=str(input).replace(/,/g,'');
 if(s===''||s==='—'||s==='-')return 0;
 if(!/^(?:\d+)(?:\.\d{1,2})?$/.test(s))throw Error(`Row ${line}: ${name} must be zero or a nonnegative number (maximum 2 decimal places).`);
 const n=Number(s);
 if(!Number.isFinite(n)||n>99999999999.99)throw Error(`Row ${line}: ${name} amount is invalid.`);
 return n;
}
/** Legacy combined column support is limited to genuine AR/AP parties. */
function legacyRelatedTo(value:unknown,line:number,account:string){
 const s=str(value);
 if(!s)return {partyType:'',partyName:''};
 const p=s.match(/^(customer|supplier)\s*:\s*(.+)$/i);
 if(p)return {partyType:p[1].toLowerCase(),partyName:p[2].trim()};
 if(/^(customer|supplier)\s*:\s*$/i.test(s))throw Error(`Row ${line}: Related To party name is missing.`);
 if(/^vehicle\s*[:#-]?\s*.+$/i.test(s))throw Error(`Row ${line}: Vehicle allocation is not part of General Journal. Use the Transport Vehicle Expenses module for vehicle-specific costs.`);
 const normalizedAccount=account.toLowerCase().replace(/\s+/g,' ').trim();
 if(normalizedAccount==='accounts receivable')return {partyType:'customer',partyName:s};
 if(normalizedAccount==='accounts payable')return {partyType:'supplier',partyName:s};
 throw Error(`Row ${line}: Related To is ambiguous. Use the single Party column only on the mapped Accounts Receivable or Accounts Payable account. Vehicle is not selected on General Journal lines.`);
}
export function isSimpleJournalTemplate(headers:readonly unknown[]):boolean{
 const h=headers.map(key);
 const core=['entry_no','entry_date','account_name','line_description','debit','credit'];
 const hasLegacyParty=h.includes(key('party'))||(h.includes(key('party_type'))&&h.includes(key('party_name')))||h.includes(key('related_to'));
 return core.every(x=>h.includes(key(x)))&&!h.includes('fundingaccount')&&!h.includes(key('description'))&&(!hasLegacyParty||h.includes(key('party'))||(h.includes(key('party_type'))&&h.includes(key('party_name')))||h.includes(key('related_to')));
}
export function normalizeSimpleJournalRows(rows:readonly (readonly unknown[])[]):string[][]{
 if(rows.length<2)throw Error('Add at least two journal lines below the Excel headers.');
 const headers=rows[0].map(key);
 for(const h of ['entry_no','entry_date','account_name','line_description','debit','credit'])if(!headers.includes(key(h)))throw Error(`Missing simple journal column: ${h}.`);
 const partyIndex=headers.indexOf(key('party'));
 const partyTypeIndex=headers.indexOf(key('party_type'));
 const partyNameIndex=headers.indexOf(key('party_name'));
 const idx=(h:string)=>headers.indexOf(key(h));
 const legacyRelatedToIndex=headers.indexOf(key('related_to'));
 const supplied=rows.slice(1).map((r,index)=>({r,line:index+2})).filter(({r})=>r.some(cell=>str(cell)));
 const problems:string[]=[];
 for(const {r,line} of supplied){
  const dr=Number(str(r[idx('debit')]).replace(/,/g,'')),cr=Number(str(r[idx('credit')]).replace(/,/g,''));
  if(Number.isFinite(dr)&&Number.isFinite(cr)&&dr>0&&cr>0)problems.push(`Row ${line}: enter a positive Debit OR Credit, not both. Move the funding side to another row (e.g. Amjad Payable Credit).`);
  const partyValue=partyIndex>=0?str(r[partyIndex]):str(r[partyNameIndex]);
  if(partyValue.toLowerCase()==='amjad payable')problems.push(`Row ${line}, Party column: Amjad Payable is a Chart of Accounts name, not a Party. Use Amjad Payable as Account Name on a separate Credit row.`);
 }
 if(problems.length){
  const visible=problems.slice(0,9),remaining=problems.length-visible.length;
  throw Error('Excel validation found '+problems.length+' problem(s):\n'+visible.join('\n')+(remaining?'\n…and '+remaining+' more similar issues.':''));
 }
 const output:string[][]=[['entry_no','entry_date','description','account_name','line_description','party_type','party_name','debit','credit']];
 const groups=new Map<string,{date:string,debit:number,credit:number,lines:number,firstDescription:string}>();
 let currentEntry='',currentDate='';
 const allEntryNumbersBlank=supplied.length>0&&supplied.every(({r})=>!str(r[idx('entry_no')]));
 for(let i=1;i<rows.length;i++){
  const row=rows[i];
  if(!row.some(c=>str(c)))continue;
  const line=i+1,suppliedId=str(row[idx('entry_no')]),suppliedDate=journalImportISODate(row[idx('entry_date')]);
  if(suppliedId&&!suppliedDate)currentDate='';
  const date=suppliedDate||(!suppliedId?currentDate:'');
  const entry=allEntryNumbersBlank?(validDate(date)?`IMPORT-${date}`:''):(suppliedId||currentEntry);
  if(!entry||entry.length>80)throw Error(`Row ${line}: Entry No is required for the first row of every journal (max 80 characters).`);
  if(!validDate(date))throw Error(`Row ${line}: enter a valid date such as 17-Oct-26 (YYYY-MM-DD is also accepted) on the first row of this journal.`);
  currentDate=date;
  if(suppliedId)currentEntry=entry;
  const account=str(row[idx('account_name')]),description=str(row[idx('line_description')]);
  if(!account)throw Error(`Row ${line}: Account is required on every debit/credit line.`);
  if(!description)throw Error(`Row ${line}: Line Description is required on every line.`);
  const debit=money(row[idx('debit')],line,'Debit'),credit=money(row[idx('credit')],line,'Credit');
  if((debit>0)===(credit>0))throw Error(`Row ${line}: enter a positive Debit OR Credit, not both or neither.`);
  const partyType=partyTypeIndex>=0?str(row[partyTypeIndex]).toLowerCase():'';
  const legacyPartyName=partyNameIndex>=0?str(row[partyNameIndex]):'';
  const partyName=partyIndex>=0?str(row[partyIndex]):legacyPartyName;
  if(partyIndex>=0&&legacyPartyName)throw Error(`Row ${line}: enter the party once in the Party column.`);
  if(partyTypeIndex>=0&&partyType&&!legacyPartyName)throw Error(`Row ${line}: Party Type was supplied without Party Name.`);
  if(!partyType&&legacyPartyName)throw Error(`Row ${line}: Party Type is required when Party Name is supplied.`);
  const vehicleIndex=headers.indexOf(key('vehicle_no')),vehicle=vehicleIndex>=0?str(row[vehicleIndex]):'';
  if(vehicle)throw Error(`Row ${line}: Vehicle allocation is not part of General Journal. Use the Transport Vehicle Expenses module for vehicle-specific costs.`);
  const legacy=legacyRelatedToIndex>=0?legacyRelatedTo(row[legacyRelatedToIndex],line,account):{partyType:'',partyName:''};
  const related={partyType:partyType||legacy.partyType,partyName:partyName||legacy.partyName};
  if((partyType||partyName)&&(legacy.partyType||legacy.partyName))throw Error(`Row ${line}: use either the Party column or the legacy Related To column, not both.`);
  if(related.partyType&&!['customer','supplier'].includes(related.partyType))throw Error(`Row ${line}: legacy Party Type must be Customer or Supplier.`);
  if(related.partyType&&!related.partyName)throw Error(`Row ${line}: legacy Party Name is required when Party Type is provided.`);
  const groupKey=entry.toLowerCase(),prior=groups.get(groupKey);
  if(prior&&prior.date!==date)throw Error(`Row ${line}: Entry No ${entry} has conflicting dates.`);
  const group=prior??{date,debit:0,credit:0,lines:0,firstDescription:description};
  group.debit+=debit;group.credit+=credit;group.lines++;
  groups.set(groupKey,group);
  output.push([entry,date,group.firstDescription,account,description,related.partyType,related.partyName,debit.toFixed(2),credit.toFixed(2)]);
 }
 if(!groups.size)throw Error('No journal rows were found.');
 if(groups.size>200)throw Error('Maximum 200 journal entries per file.');
 for(const [id,g] of groups){
  if(g.lines<2)throw Error(`Entry ${id}: at least two lines are required: one Debit and one Credit. Check that both sides use the same date and reference.`);
  if(Math.abs(Math.round(g.debit*100)-Math.round(g.credit*100))>0)throw Error(`Entry ${id}: not balanced — Debit ${g.debit.toFixed(2)}, Credit ${g.credit.toFixed(2)}.`);
 }
 return output;
}
export function downloadSimpleJournalTemplate():void{
 const book=createImportTemplateWorkbook({
  filename:'NAVILO-Journal-Simple-Debit-Credit.xlsx',
  sheetName:'Journal Import',headers:SIMPLE_JOURNAL_HEADERS,example:[],
  title:'NAVILO General Journal — Account, Description, Debit and Credit',
  notes:[
   'Each transaction must have TWO or more lines with matching Debit/Credit totals. When the entire Entry No column is blank, entries are automatically grouped by date (one compound draft per date).',
   'For individual vouchers write Entry No on the first row of each group and repeat it or leave it blank on continuation lines. To group ALL rows by date, leave EVERY Entry No blank and supply a date on EVERY row.',
   'Line Description explains the original receipt or transaction. Account Name must exactly match an active Chart of Accounts posting account.',
   'Party Type must be customer or supplier and Party Name must match an active party linked to the mapped AR/AP control account. Leave both blank for ordinary GL lines. Vehicle is not selected on journal lines.',
   'Orbit Example: Vehicle 7979 repair SAR 600: Debit the applicable Expense GL 600; Credit Amjad Payable 600. To attach the expense to a vehicle ledger, record it through Transport Vehicle Expenses.',
   'Syarah Fuel is a prepaid CURRENT ASSET: wallet top-up Debit Syarah Fuel Payable, Credit Amjad Payable. Later fuel consumption uses the relevant expense workflow and credits Syarah Fuel Payable.',
   'Existing driver salary liability payment: Debit Asif Driver Salary Running Account and Credit Amjad Payable. DO NOT expense driver wages again if already accrued.',
   'New, not-yet-accrued driver wages: Debit Driver Salary & Wages; Credit Amjad Payable. Avoid double-counting.',
   'Imported journals first become DRAFTS. Posting after review affects GL, genuine Party ledgers and P&L. For AR/AP lines, fill party_type and party_name together. General Journal entries are not attributed to a vehicle.',
   'Do not re-import posted journals or reversed transactions. An existing Entry No will fail duplicate checks. No cash/bank account is invented.',
   'Worked Examples sheet is for learning and is NEVER imported. The first sheet is deliberately empty.'
  ],fields:[
   {field:'entry_no',rule:'Unique reference per journal, same on its Debit and Credit lines'},
   {field:'entry_date',rule:'dd-mmm-yy (e.g. 15-Oct-26) on each line or just first line of each journal'},
   {field:'account_name',rule:'Exact Debit/Credit GL account from Chart of Accounts'},
   {field:'line_description',rule:'What was paid/earned, vehicle/driver details, supplier and receipt reference'},
  {field:'party_type',rule:'customer for mapped Accounts Receivable, supplier for mapped Accounts Payable; otherwise blank'},
  {field:'party_name',rule:'Exact active customer/supplier name linked to that AR/AP account; otherwise blank'}, 
   {field:'debit',rule:'Amount ONLY for debit line; other side blank or 0'},
   {field:'credit',rule:'Amount ONLY for credit line; other side blank or 0'},
  ]
 });
 const examples=XLSX.utils.aoa_to_sheet([
  ['Scenario','entry_no','entry_date','account_name','line_description','party_type','party_name','debit','credit'],
  ['Repair funded by Amjad','EXAMPLE-001','2026-09-05','General Expenses','Vehicle 7979 repair','', '',600,0],
  ['↳ Amjad owes','','','Amjad Payable','Repair paid by Amjad','', '',0,600],
  ['New driver wages','EXAMPLE-002','2026-09-06','Driver Salary & Wages','Driver wages for 7979','', '',250,0],
  ['↳ Amjad owes','','','Amjad Payable','Paid by Amjad','', '',0,250],
  ['Existing driver liability','EXAMPLE-003','2026-09-07','Asif Driver Salary Running Account','Settle previously accrued wages','', '',417,0],
  ['↳ Amjad owes','','','Amjad Payable','Paid by Amjad','', '',0,417],
  ['Syarah wallet recharge','EXAMPLE-004','2026-09-08','Syarah Fuel Payable','Syarah wallet credit','', '',1000,0],
  ['↳ Amjad owes','','','Amjad Payable','Wallet funded by Amjad','', '',0,1000],
  ['Syarah fuel consumption','EXAMPLE-005','2026-09-09','Transport & Freight','Fuel consumed by 7979','', '',300,0],
  ['↳ wallet decreases','','','Syarah Fuel Payable','Deduct from Syarah wallet','', '',0,300],
 ]);
 examples['!cols']=[{wch:26},{wch:20},{wch:16},{wch:36},{wch:44},{wch:14},{wch:28},{wch:14},{wch:14}];
 XLSX.utils.book_append_sheet(book,examples,'Worked Examples - DO NOT IMPORT');
 XLSX.writeFile(book,'NAVILO-Journal-Simple-Debit-Credit.xlsx');
}
