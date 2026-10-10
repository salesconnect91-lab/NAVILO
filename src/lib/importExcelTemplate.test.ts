import {describe,expect,it} from 'vitest';
import * as XLSX from 'xlsx';
import {createImportTemplateWorkbook} from './importExcelTemplate';
describe('NAVILO import workbook schema',()=>{
 it('preserves original headers and leading-zero reference as first-sheet input while isolating instructions',()=>{
  const w=createImportTemplateWorkbook({filename:'test.xlsx',sheetName:'Invoices',headers:['Source Reference','Invoice Date','Amount'],example:['0000123','2026-10-01',500],title:'Sales invoice',notes:['Only drafts']});
  expect(w.SheetNames).toEqual(['Invoices','Instructions']);
  expect(XLSX.utils.sheet_to_json<unknown[]>(w.Sheets.Invoices,{header:1})[0]).toEqual(['Source Reference','Invoice Date','Amount']);
  const roundtrip=XLSX.read(XLSX.write(w,{bookType:'xlsx',type:'array'}),{type:'array'});
  const rows=XLSX.utils.sheet_to_json<any>(roundtrip.Sheets.Invoices);
  expect(rows[0]['Source Reference']).toBe('0000123');
  expect(rows[0].Amount).toBe(500);
  expect(XLSX.utils.sheet_to_json<unknown[]>(roundtrip.Sheets.Instructions,{header:1}).length).toBeGreaterThan(5);
 });
 it('rejects a broken template where sample columns do not match headers',()=>{
  expect(()=>createImportTemplateWorkbook({filename:'bad.xlsx',sheetName:'Data',headers:['A','B'],example:['only one'],title:'Bad',notes:[]})).toThrow('example does not match headers');
 });
});
