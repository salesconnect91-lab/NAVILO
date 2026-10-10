import {describe,expect,it} from 'vitest';
import * as XLSX from 'xlsx';
import {createDailyTripTemplateWorkbook,createHistoricalTemplateWorkbook,TRANSPORT_TRIP_HEADERS} from './transportImportTemplates';
import {parseTripWorkbook} from './transportTripImport';
import {parseHistoricalWorkbook,HISTORY_COLUMNS,PAYMENT_COLUMNS} from './transportHistoricalImport';

const bytes=(wb:XLSX.WorkBook)=>XLSX.write(wb,{type:'array',bookType:'xlsx'}) as ArrayBuffer;
describe('NAVILO Transport Excel template/parser contracts',()=>{
 it('downloads only current daily operational fields and no manually selected Cash/Credit',()=>{
  const wb=createDailyTripTemplateWorkbook();
  expect(wb.SheetNames).toEqual(['Trips','Instructions']);
  const header=XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Trips,{header:1})[0] as string[];
  expect(header).toEqual([...TRANSPORT_TRIP_HEADERS]);
  expect(header).not.toContain('Sale Type (Cash / Credit)');
  expect(header).not.toContain('Driver Pay');
  expect(header).not.toContain('received from company');
  const parsed=parseTripWorkbook(bytes(wb));
  expect(parsed).toHaveLength(1);
  expect(parsed[0].customer).toBe('Replace with active Customer');
  expect(parsed[0].sale_type).toBe('');
  expect(parsed[0].customer_rate).toBe('1200');
  expect(parsed[0].ppr_status).toBe('pending');
 });
 it('keeps explicit historical evidence and Payments worksheet parser-compatible',()=>{
  const wb=createHistoricalTemplateWorkbook();
  expect(wb.SheetNames).toContain('Trips');
  expect(wb.SheetNames).toContain('Payments');
  expect(wb.SheetNames).toContain('Instructions');
  const rows=XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Trips,{header:1});
  const header=rows[0] as string[];
  for(const name of HISTORY_COLUMNS)expect(header).toContain(name);
  for(const name of PAYMENT_COLUMNS)expect(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Payments,{header:1})[0]).toContain(name);
  const parsed=parseHistoricalWorkbook(bytes(wb));
  expect(parsed).toHaveLength(1);
  expect(parsed[0].source_id).toBe('OLD-0001');
  expect(parsed[0].sale_type).toBe('credit');
  expect(parsed[0].customer_gross).toBe(2000);
  expect(parsed[0].received).toBe(600);
  expect(parsed[0].paid).toBe(1000);
  expect(parsed[0].errors).toEqual([]);
 });
});
