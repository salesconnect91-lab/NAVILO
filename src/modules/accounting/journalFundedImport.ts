import * as XLSX from 'xlsx';
import {createImportTemplateWorkbook} from '@/lib/importExcelTemplate';

export const FUNDED_HEADERS=[
 'entry_no','entry_date','account_name','line_description','amount','funding_account'
] as const;

const normal=(v:unknown)=>String(v??'').trim();
const compact=(v:unknown)=>normal(v).toLowerCase().replace(/[\s_-]+/g,'');
const isoDate=(s:string)=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
 const d=new Date(s+'T00:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;
};
const amt=(raw:unknown,line:number)=>{
 const s=normal(raw).replace(/,/g,'');
 if(!/^(?:\d+)(?:\.\d{1,2})?$/.test(s))throw Error(`Row ${line}: Amount must be positive with a maximum of 2 decimals.`);
 const v=Number(s);
 if(!Number.isFinite(v)||v<=0||v>99999999999.99)throw Error(`Row ${line}: Amount must be a positive amount.`);
 return v.toFixed(2);
};
/**
 * Converts one-row-per-Amjad-funded transaction into the canonical two-line
 * Journal Import schema. This does NOT create a payment or post an entry.
 * Funding account MUST be explicit and is never silently inferred from company.
 */
export function expandFundedJournalRows(rows:readonly (readonly unknown[])[]):string[][]{
 if(rows.length<2)throw Error('Add expense rows below the funded journal template headers.');
 const headers=rows[0].map(compact);
 for(const required of FUNDED_HEADERS){
  if(!headers.includes(compact(required)))throw Error(`Missing funded journal column ${required}. Download the latest funded template.`);
 }
 const idx=(key:string)=>headers.indexOf(compact(key));
 const oldRelatedToIndex=idx('related_to');
 const out:string[][]=[['entry_no','entry_date','description','account_name','line_description','vehicle_no','debit','credit']];
 const references=new Set<string>();
 let count=0;
 for(let i=1;i<rows.length;i++){
  const r=rows[i];if(!r.some(x=>normal(x)))continue;
  const line=i+1;
  const id=normal(r[idx('entry_no')]),date=normal(r[idx('entry_date')]);
  const account=normal(r[idx('account_name')]),desc=normal(r[idx('line_description')]);
  const funding=normal(r[idx('funding_account')]);
  if(!id||id.length>80)throw Error(`Row ${line}: unique Entry No required (maximum 80 characters).`);
  if(references.has(id.toLowerCase()))throw Error(`Row ${line}: duplicate Entry No ${id} in file.`);
  references.add(id.toLowerCase());
  if(!isoDate(date))throw Error(`Row ${line}: date must be valid YYYY-MM-DD.`);
  if(!account)throw Error(`Row ${line}: Debit Account is required.`);
  if(!desc)throw Error(`Row ${line}: Line Description is required.`);
  if(!funding)throw Error(`Row ${line}: Funding Account required (for Orbit, Amjad Payable).`);
  if(oldRelatedToIndex>=0&&normal(r[oldRelatedToIndex]))throw Error(`Row ${line}: Vehicle expenses are not allocated separately. Put vehicle and expense details in Line Description.`);
  if(account.toLowerCase()===funding.toLowerCase())throw Error(`Row ${line}: Debit Account cannot equal Funding Account.`);
  const amount=amt(r[idx('amount')],line);
  out.push([id,date,desc,account,desc,'',amount,'0']);
  out.push([id,date,desc,funding,`Funded by ${funding}: ${desc}`,'','0',amount]);
  count++;
 }
 if(!count)throw Error('No funded transactions were found.');
 if(count>200)throw Error('Maximum 200 funded transactions per upload.');
 return out;
}

export function isFundedJournalTemplate(header:readonly unknown[]):boolean{
 const h=header.map(compact);
 return h.includes('fundingaccount')&&h.includes('amount')&&h.includes('entryno')&&h.includes('accountname');
}
export function downloadFundedJournalTemplate():void{
 const book=createImportTemplateWorkbook({
  filename:'NAVILO-Funded-Journals-Simple.xlsx',sheetName:'Funded Journal',
  headers:FUNDED_HEADERS,example:[],
  title:'NAVILO Funded Journal — one row per transaction, 2 balanced lines automatically',
  notes:[
   'ONE transaction per row. Entry No must be unique; you may choose your own reference. Add the first transaction on row 2.',
   'Funding Account for Orbit is Amjad Payable. Use the EXACT active Chart of Accounts name; nothing posts automatically.',
   'Example: Debit General Expenses SAR 600, Line Description "Vehicle 7979 repair", Funding Account Amjad Payable: NAVILO previews a credit to Amjad Payable SAR 600.',
   'For EXISTING driver payable: Debit Asif Driver Salary Running Account, Funding Account Amjad Payable. This settles existing liability, NOT new wages expense.',
   'For NEW driver wages expense: Debit Driver Salary & Wages, Funding Account Amjad Payable. Put vehicle/driver details in Line Description.',
   'Syarah Fuel is a CURRENT ASSET prepaid wallet. Recharge: Debit Syarah Fuel Payable, Funding Account Amjad Payable. Fuel consumption is a SEPARATE entry: Debit expense, Credit Syarah Fuel Payable, use Advanced Journal template.',
   'Use the actual operating EXPENSE account for repair/fuel. Record vehicle details in Line Description; do not allocate the expense to a vehicle account. No duplicate Vehicle Expense invoice should be created.',
   'All file rows create balanced DRAFT journals after validation. Expense GL and Amjad Payable update only after explicit Post; vehicle expenses are not allocated separately.',
   'Do not reimport existing posted/reversed transactions; duplicate Entry No is refused.',
   'This format assumes funds are paid DIRECTLY on Orbit behalf by the funding party. If funds were first deposited in company cash/bank, use an ordinary two-line journal.'
  ],fields:[
   {field:'entry_no',rule:'Unique reference per transaction, e.g. ORB-SEP-001 (must not already exist)'},
   {field:'entry_date',rule:'YYYY-MM-DD (real transaction date)'},
   {field:'account_name',rule:'Debit account: General Expenses, Driver Salary & Wages, existing Driver Running Account, or Syarah wallet'},
   {field:'line_description',rule:'What was paid; keep original receipt/ref details'},
   {field:'amount',rule:'Positive SAR amount; maximum 2 decimals'},
   {field:'funding_account',rule:'Original creditor GL, e.g. Amjad Payable'}
  ]
 });
 const guide=XLSX.utils.aoa_to_sheet([
  ['SCENARIO','Debit Account','Credit Account (Funded by)','Important'],
  ['Vehicle 7979 repair','General Expenses','Amjad Payable','Vehicle and repair details go in Line Description'],
  ['New driver wages','Driver Salary & Wages','Amjad Payable','Only when wages have NOT been accrued already; details go in Line Description'],
  ['Settle old driver payable','Asif Driver Salary Running Account','Amjad Payable','Payment clears running liability, no new P&L cost'],
  ['Recharge Syarah fuel wallet','Syarah Fuel Payable','Amjad Payable','Asset recharge, not a fuel expense'],
  ['Consume Syarah fuel','Transport & Freight','Syarah Fuel Payable','ADVANCED 2-line Journal template; not this Amjad-funded upload'],
  ['Refund Amjad from bank','Amjad Payable','Al-Rajhi Bank','ADVANCED 2-line Journal, when Orbit actually has money']
 ]);
 guide['!cols']=[{wch:30},{wch:36},{wch:32},{wch:78}];
 XLSX.utils.book_append_sheet(book,guide,'Worked Examples - NOT IMPORT');
 XLSX.writeFile(book,'NAVILO-Funded-Journals-Simple.xlsx');
}
