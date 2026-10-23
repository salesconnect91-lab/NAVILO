import {describe,expect,it} from 'vitest';
import * as XLSX from 'xlsx';
import {createImportTemplateWorkbook} from './importExcelTemplate';
describe('NAVILO import workbook schema',()=>{
 it('keeps only real upload headers on the first sheet and isolates sample values in instructions',()=>{
  const w=createImportTemplateWorkbook({filename:'test.xlsx',sheetName:'Invoices',headers:['Source Reference','Invoice Date','Amount'],example:['0000123','2026-10-01',500],title:'Sales invoice',notes:['Only drafts']});
  expect(w.SheetNames).toEqual(['Invoices','Instructions']);
  expect(XLSX.utils.sheet_to_json<unknown[]>(w.Sheets.Invoices,{header:1})[0]).toEqual(['Source Reference','Invoice Date','Amount']);
  const roundtrip=XLSX.read(XLSX.write(w,{bookType:'xlsx',type:'array'}),{type:'array'});
  const rows=XLSX.utils.sheet_to_json<any>(roundtrip.Sheets.Invoices);
  expect(rows).toEqual([]);
  const instructions=XLSX.utils.sheet_to_json<unknown[]>(roundtrip.Sheets.Instructions,{header:1});
  expect(instructions.some(row=>String(row[1]).includes('0000123'))).toBe(true);
  expect(roundtrip.Sheets.Invoices['!autofilter']?.ref).toBe('A1:C1');
  expect(XLSX.utils.sheet_to_json<unknown[]>(roundtrip.Sheets.Instructions,{header:1}).length).toBeGreaterThan(5);
 });
 it('supports intentionally empty accounting templates with their actual upload headers only',()=>{
  const w=createImportTemplateWorkbook({filename:'journal.xlsx',sheetName:'Journal Import',headers:['entry_no','entry_date','debit','credit'],example:[],title:'Journal import',notes:['Draft only']});
  const roundtrip=XLSX.read(XLSX.write(w,{bookType:'xlsx',type:'array'}),{type:'array'});
  expect(roundtrip.SheetNames).toEqual(['Journal Import','Instructions']);
  expect(XLSX.utils.sheet_to_json<unknown[]>(roundtrip.Sheets['Journal Import'],{header:1})).toEqual([['entry_no','entry_date','debit','credit']]);
  expect(roundtrip.Sheets['Journal Import']['!autofilter']?.ref).toBe('A1:D1');
  const help=XLSX.utils.sheet_to_json<unknown[]>(roundtrip.Sheets.Instructions,{header:1});
  expect(help.some(row=>String(row[1]).includes('starting in row 2'))).toBe(true);
 });
 it('rejects a broken template where sample columns do not match headers',()=>{
  expect(()=>createImportTemplateWorkbook({filename:'bad.xlsx',sheetName:'Data',headers:['A','B'],example:['only one'],title:'Bad',notes:[]})).toThrow('example does not match headers');
 });
});
