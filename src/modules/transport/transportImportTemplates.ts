import * as XLSX from 'xlsx';
import {HISTORY_COLUMNS,PAYMENT_COLUMNS} from './transportHistoricalImport';
import {createImportTemplateWorkbook} from '@/lib/importExcelTemplate';

/** Daily operational trips: Cash/Credit comes from Transport Customer Master. */
export const TRANSPORT_TRIP_HEADERS=[
 'DATE','TRUCK TYPE','PO/DO/JOB NO.','COMPANY NAME','DRIVER NAME','OWNER','PLATE #','FROM','TO',
 'PAPER RECEIVED BY','DATE','Customer Rate','Supplier Rent','INVOICE NUMBER','Notes','TRIP NO'
] as const;

export function createDailyTripTemplateWorkbook(){
 const example=[
  '15-Oct-26','Flatbed','PO-001','Replace with active Customer','Driver A','', 'ABC-123',
  'Dammam','Riyadh','PPR PENDING','',1200,'','','',''
 ];
 return createImportTemplateWorkbook({
  filename:'Transport_Daily_Trips_NAVILO.xlsx',
  sheetName:'Trips',title:'NAVILO Transport daily operational Trip upload',
  headers:TRANSPORT_TRIP_HEADERS,example,
  notes:[
   'Upload creates TRIP RECORDS ONLY. It does not create Sales/Purchase invoices, payment receipts or accounting journals.',
   'Customer Cash (without VAT) / Credit (with VAT) comes automatically from Transport Customer Master > Cash/Credit Billing Rules. Do NOT add a Sale Type column.',
   'Customer, Truck Type, Vehicle, Driver, From and To must resolve to active records in the selected Transport business.',
   'OWNER is optional but, when entered, must match the dated Vehicle Ownership History. Supplier Rent is only for Supplier-owned vehicles.',
   'PAPER RECEIVED BY: PPR PENDING, N/A, or an actual receiving Employee name. The SECOND DATE column is the PPR receiving date (only for a received PPR).',
   'Customer Rate and Supplier Rent may be blank (pending) or nonnegative amounts up to two decimal places. Do not upload Driver Pay here.',
   'INVOICE NUMBER is a source reference only; it does not create or post an invoice.',
   'TRIP NO is optional: supplied numeric numbers are preserved; blank values get a company-wide automatic numeric Trip Number. Duplicate numbers are rejected.',
   'Maximum 20,000 rows per file. Duplicate journeys are detected; repeat real trips need different PO/DO/Job No or distinct source identity.'
  ],
  fields:[
   {field:'DATE (first)',rule:'Required Trip Date (dd-mmm-yy, e.g. 15-Oct-26; ISO and Excel dates are also accepted).'},
   {field:'COMPANY NAME',rule:'Required Customer name from shared Customer Master; billing mode must already be configured for active Transport business.'},
   {field:'FROM / TO',rule:'Required active Transport Locations.'},
   {field:'TRUCK TYPE / PLATE # / DRIVER NAME',rule:'Active Transport master values. Vehicle ownership must cover Trip Date.'},
   {field:'PAPER RECEIVED BY + DATE (second)',rule:'PPR PENDING or N/A, else actual receiving Employee and receiving date.'},
   {field:'Customer Rate / Supplier Rent',rule:'Optional amounts with at most 2 decimal places. Finalization permissions are enforced.'},
   {field:'INVOICE NUMBER',rule:'Optional reference; no invoice is posted by this upload.'},
   {field:'TRIP NO',rule:'Optional positive numeric number (up to 12 digits). Blank generates the next available company-wide Trip Number.'}
  ]
 });
}
export function downloadDailyTripTemplate(){
 XLSX.writeFile(createDailyTripTemplateWorkbook(),'Transport_Daily_Trips_NAVILO.xlsx');
}

/** One-time historical accounting import retains the explicit evidence fields. */
export function createHistoricalTemplateWorkbook(){
 const headers=[
  'DATE','TRUCK TYPE','PO/DO/JOB NO.','INVOICE NUMBER','COMPANY NAME','DRIVER NAME','OWNER',
  'PLATE #','FROM','TO','PAPER RECEIVED BY','Customer Rate','Supplier Rent',
  'Sale Type (Cash / Credit)',...HISTORY_COLUMNS,'TRIP NO'
 ];
 const sample=[
  '15-Oct-26','Flatbed','JOB-1','ORIG-2026-001','Example Customer','Example Driver','Example Supplier',
  'ABC-123','From','To','PPR PENDING',2000,1700,'Credit',
  'OLD-0001','Yes','15-Oct-26','No',2000,600,1400,'Yes','15-Oct-26','No',1700,1000,700,''
 ];
 const wb=createImportTemplateWorkbook({
  filename:'Transport-One-time-Import-Template.xlsx',sheetName:'Trips',
  headers,example:sample,title:'One-time Transport invoices, trips and settlements',
  notes:[
   'WARNING: One-time Import may POST financial invoices, purchases and dated payments. Use only after opening balance reconciliation and approval.',
   'Unlike DAILY Trip Upload, one-time records require an explicit Sale Type (Cash / Credit) as source evidence. This must agree with the target Customer Master policy; do not reclassify posted history silently.',
   'Source Record ID must be unique for each real Trip. Same-date repeat journeys need different Source Record IDs.',
   'TRIP NO is optional and separate from Source Record ID. A supplied numeric Trip Number is preserved; blank values generate the next company-wide number.',
   'Customer Posted / Supplier Posted / Customer VAT / Supplier VAT accept ONLY Yes or No. Rates and Supplier Rent are EXCLUDING VAT; gross and remaining amounts include VAT.',
   'Unposted sides require zero gross, payment and remaining, with VAT No. Posted sides require invoice date and positive gross within the cutoff date.',
   'For posted CREDIT customer Sales, INVOICE NUMBER must contain the actual original invoice number. YES, CLEARED, NO INVOICE, BAD DEBTS and H-S references are not invoice numbers. Missing numbers cannot be posted.',
   'Customer Gross - Customer Received = Customer Remaining; Supplier Gross - Supplier Paid = Supplier Remaining.',
   'For any nonzero amount received/paid, add matching actual dated allocations to the Payments sheet using existing Chart of Accounts cash/bank CODES.',
   'Each Payments row requires Source Record ID, customer/supplier Side, Date (dd-mmm-yy, e.g. 15-Oct-26), positive Amount, Cash / Bank Account Code and Reference.',
   'The Payments upload sheet is intentionally blank. Never import fabricated receipt or supplier payment rows.',
   'Do not duplicate balances in accounting openings; closed periods and ownership histories must be reviewed before confirmation.'
  ]
 });
 const payments=XLSX.utils.aoa_to_sheet([[...PAYMENT_COLUMNS]]);
 payments['!cols']=PAYMENT_COLUMNS.map(h=>({wch:Math.min(34,Math.max(18,h.length+3))}));
 payments['!autofilter']={ref:`A1:${XLSX.utils.encode_col(PAYMENT_COLUMNS.length-1)}1`};
 XLSX.utils.book_append_sheet(wb,payments,'Payments');
 wb.SheetNames=['Trips','Payments','Instructions'];
 return wb;
}
export function downloadHistoricalTemplate(){
 XLSX.writeFile(createHistoricalTemplateWorkbook(),'Transport-One-time-Import-Template.xlsx');
}
