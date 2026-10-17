import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {HISTORY_COLUMNS,PAYMENT_COLUMNS,parseHistoricalWorkbook,historicalTotals} from './transportHistoricalImport';
const operational=['DATE','TRUCK TYPE','PO/DO/JOB NO.','COMPANY NAME','DRIVER NAME','OWNER','PLATE #','FROM','TO','PAPER RECEIVED BY','Customer Rate','Supplier Rent','Sale Type (Cash / Credit)','Driver Pay'];
const row=['2026-10-01','Flatbed','JOB-1','Customer','Driver','Supplier','ABC-123','A','B','PPR PENDING',2000,1700,'Credit',0,'OLD-1','Yes','2026-10-01','No',2000,600,1400,'Yes','2026-10-01','No',1700,1000,700];
const paymentRows=[['OLD-1','customer','2026-10-02',600,'1001','R-1'],['OLD-1','supplier','2026-10-02',500,'1001','P-1'],['OLD-1','supplier','2026-10-02',500,'1001','P-1']];
function file(rows:unknown[][],payments:unknown[][]=paymentRows,invoiceNumbers?:string[]){const w=XLSX.utils.book_new();const withInvoice=rows.map((r,i)=>[...r.slice(0,operational.length),invoiceNumbers?.[i]??`ORIG-${i+1}`,...r.slice(operational.length)]);XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([[...operational,'INVOICE NUMBER',...HISTORY_COLUMNS],...withInvoice]),'Trips');XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([[...PAYMENT_COLUMNS],...payments]),'Payments');return XLSX.write(w,{type:'array',bookType:'xlsx'});}
describe('one-time historical accounting workbook',()=>{
 it('retains dated partial payments including identical split payments and reconciles controls',()=>{const rows=parseHistoricalWorkbook(file([row]));expect(rows[0].errors).toEqual([]);expect(rows[0].payments).toHaveLength(3);expect(historicalTotals(rows)).toEqual({trips:1,customer_gross:2000,supplier_gross:1700,received:600,paid:1000,customer_remaining:1400,supplier_remaining:700});});
 it('rejects missing and remark-based original invoice references for posted Credit Sales',()=>{
  for(const reference of ['', 'Yes', 'CLEARED', 'NO INVOICE', 'BAD DEBTS', 'H-S-000001', 'pending']){
   const parsed=parseHistoricalWorkbook(file([row],paymentRows,[reference]));
   expect(parsed[0].errors.join('; ')).toContain('original invoice number');
  }
  const valid=parseHistoricalWorkbook(file([row],paymentRows,['INV-2026-001']));
  expect(valid[0].source_invoice_no).toBe('INV-2026-001');
  expect(valid[0].errors).toEqual([]);
  const unposted=[...row];unposted[15]='No';unposted[16]='';unposted[18]=unposted[19]=unposted[20]=0;
  expect(parseHistoricalWorkbook(file([unposted],paymentRows,['']))[0].errors.join()).not.toContain('original invoice number');
 });
 it('allows identical same-day journeys only with distinct source identities',()=>{const second=[...row];second[14]='OLD-2';const rows=parseHistoricalWorkbook(file([row,second],[...paymentRows,...paymentRows.map(p=>['OLD-2',...p.slice(1)])]));expect(rows.every(r=>r.errors.length===0)).toBe(true);expect(parseHistoricalWorkbook(file([row,row]))[1].errors.join()).toContain('Unique Source Record ID');});
 it('requires every receipt/payment to reconcile and rejects payment before billing',()=>{const bad=[...paymentRows.map(p=>[...p])];bad[0][3]=599;bad[1][2]='2026-09-30';const errors=parseHistoricalWorkbook(file([row],bad))[0].errors.join();expect(errors).toContain('reconcile');expect(errors).toContain('precede invoice');});
 it('never converts unposted amounts or missing explicit flags into posted accounting',()=>{const r=[...row];r[15]='No';const errors=parseHistoricalWorkbook(file([r]))[0].errors.join();expect(errors).toContain('unposted');r[21]='';expect(parseHistoricalWorkbook(file([r]))[0].errors.join()).toContain('Yes or No required');});
 it('rejects unknown payment source IDs and incomplete historical columns',()=>{expect(()=>parseHistoricalWorkbook(file([row],[['UNKNOWN',...paymentRows[0].slice(1)]]))).toThrow('unknown Source');const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([operational,row.slice(0,14)]),'Trips');expect(()=>parseHistoricalWorkbook(XLSX.write(w,{type:'array',bookType:'xlsx'}))).toThrow('explicit accounting columns');});
 it('validates gross minus payments against remaining without floating point drift',()=>{const r=[...row];r[18]=0.3;r[19]=0.1;r[20]=0.2;r[24]=0.3;r[25]=0.1;r[26]=0.2;const result=parseHistoricalWorkbook(file([r],[['OLD-1','customer','2026-10-02',0.1,'1001','R'],['OLD-1','supplier','2026-10-02',0.1,'1001','P']]));expect(result[0].errors).toEqual([]);});
 it('rejects a file above 20,000 Trips and handles the full supported manifest',()=>{const rows=Array.from({length:20000},(_,i)=>{const r=[...row];r[14]=`OLD-${i}`;r[15]='No';r[16]='';r[18]=r[19]=r[20]=0;r[21]='No';r[22]='';r[24]=r[25]=r[26]=0;return r;});const result=parseHistoricalWorkbook(file(rows,[]));expect(result).toHaveLength(20000);expect(historicalTotals(result).trips).toBe(20000);expect(result.every(r=>!r.errors.length)).toBe(true);expect(()=>parseHistoricalWorkbook(file([...rows,rows[0]],[]))).toThrow('20,000');});
});
