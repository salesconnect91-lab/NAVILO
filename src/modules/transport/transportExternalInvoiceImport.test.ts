import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {assertExternalInvoicePreviewDates,invoiceImportDate,parseExternalInvoiceRows} from './transportExternalInvoiceImport';
const row={'TRIP NO.':16512,DATE:'2026-06-04','Invoice / Bill Date':'31-Aug-26',INVOICED:'2026-03098','COMPANY NAME':'ENERCO','PLATE #':7979,'RATE WITH COMPANY':3000,'TAX (%)':15,'TAX AMOUNT':450,'BILL AMOUNT':3450,'Cash/Credit':'Credit',Discription:'Delivery'};
describe('external invoice import',()=>{
 it('preserves invoice dates independently of source trip dates and supports multiple vehicles',()=>{const rows=parseExternalInvoiceRows([row,{...row,'TRIP NO.':16521,'PLATE #':5731,DATE:'2026-06-05'}]);expect(rows.map(r=>r.invoice_no)).toEqual(['2026-03098','2026-03098']);expect(rows[0].invoice_date).toBe('2026-08-31');expect(rows[0].reference_date).toBe('2026-06-04');expect(rows[1].vehicle_no).toBe('5731');});
 it('reads real Excel 01-Sep-2026 date serial 46266 without shifting it back to 31-Aug',()=>{
  // Reproduces the uploaded NAVILO-External-Transport-Invoices.xlsx:
  // 16 cash-bill lines used serial 46266 for Invoice / Bill Date.
  expect(invoiceImportDate(46266)).toBe('2026-09-01');
  const headers=['Source Reference','TRIP NO.','Reference Date','Invoice No','Invoice / Bill Date','Customer','Vehicle No','Amount','TAX (%)','TAX AMOUNT','BILL AMOUNT','Cash/Credit'];
  const sheet=XLSX.utils.aoa_to_sheet([
   headers,
   ['',18345,46266,'Cash Bill-1',46266,'CASH-SHAHRIYAR DYNA',7979,1100,0,0,1100,'Cash'],
   ['',18392,46268,'Cash Bill-3',46266,'CASH-HUMAYUN CONTAINER',5731,1000,0,0,1000,'Cash'],
  ]);
  sheet['C2'].z='dd-mmm-yy';
  sheet['E2'].z='dd-mmm-yy';
  sheet['C3'].z='dd-mmm-yy';
  sheet['E3'].z='dd-mmm-yy';
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,sheet,'Invoices');
  const buffer=XLSX.write(book,{type:'array',bookType:'xlsx'});
  const parsedBook=XLSX.read(buffer,{type:'array',cellDates:false});
  const excelRows=XLSX.utils.sheet_to_json<Record<string,unknown>>(parsedBook.Sheets['Invoices'],{defval:'',raw:true});
  expect(excelRows[0]['Invoice / Bill Date']).toBe(46266);
  const result=parseExternalInvoiceRows(excelRows);
  expect(result).toHaveLength(2);
  expect(result.map(r=>r.invoice_date)).toEqual(['2026-09-01','2026-09-01']);
  expect(result.map(r=>r.reference_date)).toEqual(['2026-09-01','2026-09-03']);
 });
 it('keeps text dates and numeric dates consistent in one upload',()=>{
  const result=parseExternalInvoiceRows([{...row,DATE:46266,'Invoice / Bill Date':'01-Sep-26'}]);
  expect(result[0].invoice_date).toBe('2026-09-01');
  expect(result[0].reference_date).toBe('2026-09-01');
 });
 it('blocks any mismatched preview date before a draft can be imported',()=>{
  const original=[{source_reference:'18345',invoice_date:'2026-09-01'}];
  expect(()=>assertExternalInvoicePreviewDates(original,[{source_reference:'18345',invoice_date:'2026-08-31'}])).toThrow('Import preview invoice date differs');
  expect(()=>assertExternalInvoicePreviewDates(original,[{source_reference:'18345',invoice_date:'2026-09-01'}])).not.toThrow();
  expect(()=>assertExternalInvoicePreviewDates(original,[])).toThrow('row count differs');
 });
 it('treats CLEARED as blank but retains Cash type without inventing a receipt',()=>{const rows=parseExternalInvoiceRows([{...row,INVOICED:'CLEARED ASAD','Cash/Credit':'Cash','TAX (%)':0,'TAX AMOUNT':0,'BILL AMOUNT':3000}]);expect(rows[0].invoice_no).toBe('');expect(rows[0].sale_type).toBe('Cash');expect(rows[0]).not.toHaveProperty('paid_amount');});
 it('rejects inconsistent invoice headers, duplicates, missing dates and wrong source totals',()=>{
 expect(()=>parseExternalInvoiceRows([row,{...row,'TRIP NO.':99,'COMPANY NAME':'Other'}])).toThrow('same Customer');
 expect(()=>parseExternalInvoiceRows([row,row])).toThrow('duplicate source');
 expect(()=>parseExternalInvoiceRows([{...row,'Invoice / Bill Date':''}])).toThrow('Invoice / Bill Date');
 expect(()=>parseExternalInvoiceRows([{...row,'BILL AMOUNT':3000}])).toThrow('reconcile');
 });
});
