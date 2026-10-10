import * as XLSX from 'xlsx';
import {HISTORY_COLUMNS,PAYMENT_COLUMNS} from './transportHistoricalImport';
import {createImportTemplateWorkbook} from '@/lib/importExcelTemplate';

/** Daily operational trips: Cash/Credit comes from Transport Customer Master. */
export const TRANSPORT_TRIP_HEADERS=[
 'DATE','TRUCK TYPE','PO/DO/JOB NO.','COMPANY NAME','DRIVER NAME','OWNER','PLATE #','FROM','TO',
 'PAPER RECEIVED BY','DATE','Customer Rate','Supplier Rent','INVOICE NUMBER','Notes'
] as const;

export function createDailyTripTemplateWorkbook(){
 const example=[
  '2026-10-01','Flatbed','PO-001','Replace with active Customer','Driver A','', 'ABC-123',
  'Dammam','Riyadh','PPR PENDING','',1200,'','',''
 ];
 return createImportTemplateWorkbook({
  filename:'Transport_Daily_Trips_NAVILO.xlsx',
  sheetName:'Trips',title:'NAVILO Transport daily operational Trip upload',
  headers:TRANSPORT_TRIP_HEADERS,example,
  notes:[
   'Upload creates TRIP RECORDS ONLY. It does not create Sales/Purchase invoices, payment receipts or accounting journals.',
   'Customer Cash Only / Credit Only comes automatically from Transport Customer Master > Cash/Credit Billing Rules. Do NOT add a Sale Type column.',
   'Customer, Truck Type, Vehicle, Driver, From and To must resolve to active records in the selected Transport business.',
   'OWNER is optional but, when entered, must match the dated Vehicle Ownership History. Supplier Rent is only for Supplier-owned vehicles.',
   'PAPER RECEIVED BY: PPR PENDING, N/A, or an actual receiving Employee name. The SECOND DATE column is the PPR receiving date (only for a received PPR).',
   'Customer Rate and Supplier Rent may be blank (pending) or nonnegative amounts up to two decimal places. Do not upload Driver Pay here.',
   'INVOICE NUMBER is a source reference only; it does not create or post an invoice.',
   'Maximum 20,000 rows per file. Duplicate journeys are detected; repeat real trips need different PO/DO/Job No or distinct source identity.'
  ],
  fields:[
   {field:'DATE (first)',rule:'Required Trip Date (YYYY-MM-DD).'},
   {field:'COMPANY NAME',rule:'Required Customer name from shared Customer Master; billing mode must already be configured for active Transport business.'},
   {field:'FROM / TO',rule:'Required active Transport Locations.'},
   {field:'TRUCK TYPE / PLATE # / DRIVER NAME',rule:'Active Transport master values. Vehicle ownership must cover Trip Date.'},
   {field:'PAPER RECEIVED BY + DATE (second)',rule:'PPR PENDING or N/A, else actual receiving Employee and receiving date.'},
   {field:'Customer Rate / Supplier Rent',rule:'Optional amounts with at most 2 decimal places. Finalization permissions are enforced.'},
   {field:'INVOICE NUMBER',rule:'Optional reference; no invoice is posted by this upload.'}
  ]
 });
}
export function downloadDailyTripTemplate(){
 XLSX.writeFile(createDailyTripTemplateWorkbook(),'Transport_Daily_Trips_NAVILO.xlsx');
}

/** One-time historical accounting import retains the explicit evidence fields. */
export function createHistoricalTemplateWorkbook(){
 const headers=[
  'DATE','TRUCK TYPE','PO/DO/JOB NO.','INVOICED','COMPANY NAME','DRIVER NAME','OWNER',
  'PLATE #','FROM','TO','PAPER RECEIVED BY','Customer Rate','Supplier Rent',
  'Sale Type (Cash / Credit)',...HISTORY_COLUMNS
 ];
 const sample=[
  '2026-10-01','Flatbed','JOB-1','Yes','Example Customer','Example Driver','Example Supplier',
  'ABC-123','From','To','PPR PENDING',2000,1700,'Credit',
  'OLD-0001','Yes','2026-10-01','No',2000,600,1400,'Yes','2026-10-01','No',1700,1000,700
 ];
 const wb=createImportTemplateWorkbook({
  filename:'Transport-Historical-Import-Template.xlsx',sheetName:'Trips',
  headers,example:sample,title:'One-time Transport historical invoices, trips and settlements',
  notes:[
   'WARNING: Historical Import may POST financial invoices, purchases and dated payments. Use only after opening balance reconciliation and approval.',
   'Unlike DAILY Trip Upload, historical records require an explicit Sale Type (Cash / Credit) as source evidence. This must agree with the target Customer Master policy; do not reclassify posted history silently.',
   'Source Record ID must be unique for each real Trip. Same-date repeat journeys need different Source Record IDs.',
   'Customer Posted / Supplier Posted / Customer VAT / Supplier VAT accept ONLY Yes or No. Rates and Supplier Rent are EXCLUDING VAT; gross and remaining amounts include VAT.',
   'Unposted sides require zero gross, payment and remaining, with VAT No. Posted sides require invoice date and positive gross within the cutoff date.',
   'Customer Gross - Customer Received = Customer Remaining; Supplier Gross - Supplier Paid = Supplier Remaining.',
   'For any nonzero amount received/paid, add matching actual dated allocations to the Payments sheet using existing Chart of Accounts cash/bank CODES.',
   'Each Payments row requires Source Record ID, customer/supplier Side, Date, positive Amount, Cash / Bank Account Code and Reference.',
   'Do not duplicate balances in accounting openings; closed periods and ownership histories must be reviewed before confirmation.'
  ]
 });
 const payments=XLSX.utils.aoa_to_sheet([
  [...PAYMENT_COLUMNS],
  ['OLD-0001','customer','2026-10-02',600,'REPLACE-WITH-CASH-CODE','RCPT-1'],
  ['OLD-0001','supplier','2026-10-02',1000,'REPLACE-WITH-BANK-CODE','PAY-1']
 ]);
 payments['!cols']=PAYMENT_COLUMNS.map(h=>({wch:Math.min(34,Math.max(18,h.length+3))}));
 payments['!autofilter']={ref:'A1:F3'};
 XLSX.utils.book_append_sheet(wb,payments,'Payments');
 wb.SheetNames=['Trips','Payments','Instructions'];
 return wb;
}
export function downloadHistoricalTemplate(){
 XLSX.writeFile(createHistoricalTemplateWorkbook(),'Transport-Historical-Import-Template.xlsx');
}
