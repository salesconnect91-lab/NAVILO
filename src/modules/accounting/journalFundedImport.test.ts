import {describe,expect,it,vi} from 'vitest';
import * as XLSX from 'xlsx';
import {expandFundedJournalRows,isFundedJournalTemplate,FUNDED_HEADERS,downloadFundedJournalTemplate} from './journalFundedImport';
vi.mock('xlsx',async(importOriginal)=>({...await importOriginal<typeof import('xlsx')>(),writeFile:vi.fn()}));
const h=[...FUNDED_HEADERS];
const item=(entry_no:string,account_name:string,amount:unknown,funding_account='Amjad Payable')=>
 [entry_no,'2026-09-05',account_name,'Orbit funded expense',amount,funding_account];
describe('Funded journal imports use canonical 2-line Draft JEs',()=>{
 it('converts a funded expense to balanced General Journal lines without vehicle attribution',()=>{
  const result=expandFundedJournalRows([h,item('ORB-001','General Expenses',600)]);
  expect(result).toHaveLength(3);
  expect(result[1]).toEqual(['ORB-001','2026-09-05','Orbit funded expense','General Expenses','Orbit funded expense','','','600.00','0']);
  expect(result[2][3]).toBe('Amjad Payable');
  expect(result[2][6]).toBe('');
  expect(result[2].slice(-2)).toEqual(['0','600.00']);
 });
 it('clears an EXISTING driver running balance rather than introducing new salary expense',()=>{
  const result=expandFundedJournalRows([h,item('ORB-002','Asif Driver Salary Running Account',1500)]);
  expect(result[1][3]).toBe('Asif Driver Salary Running Account');
  expect(result[1][6]).toBe('');
  expect(result[2][3]).toBe('Amjad Payable');
 });
 it('supports Syarah CURRENT ASSET recharge without claiming fuel cost',()=>{
  const result=expandFundedJournalRows([h,item('ORB-003','Syarah Fuel Payable',1000)]);
  expect(result[1][3]).toBe('Syarah Fuel Payable');
  expect(result[1][6]).toBe('');
 });
 it('will not mask zeros, negative amounts, imprecise amounts, duplicate numbers, or missing creditor',()=>{
  for(const amount of ['-2','0','1.234','abc',''])expect(()=>expandFundedJournalRows([h,item('A','General Expenses',amount)])).toThrow();
  expect(()=>expandFundedJournalRows([h,item('A','General Expenses',10),item('a','General Expenses',11)])).toThrow(/duplicate Entry No/);
  expect(()=>expandFundedJournalRows([h,item('A','General Expenses',10,'')])).toThrow(/Funding Account/);
  expect(()=>expandFundedJournalRows([h,item('A','Amjad Payable',10)])).toThrow(/cannot equal Funding/);
 });
 it('rejects wrong date and keeps 2-line JE grouping stable',()=>{
  expect(()=>expandFundedJournalRows([h,['A','2026-02-31','General Expenses','repair','600','Amjad Payable']])).toThrow(/date/);
  const result=expandFundedJournalRows([h,item('A','General Expenses',600),item('B','Driver Salary & Wages',450)]);
  expect(result.map(r=>r[0])).toEqual(['entry_no','A','A','B','B']);
 });
 it('recognizes funded template, while preserving advanced template routing',()=>{
  expect(isFundedJournalTemplate(h)).toBe(true);
  expect(isFundedJournalTemplate(['entry_no','entry_date','account_name','debit','credit'])).toBe(false);
 });
 it('generates an upload schema sheet with worked examples only in a separate sheet',()=>{
  downloadFundedJournalTemplate();
  expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
  const [book,filename]=vi.mocked(XLSX.writeFile).mock.calls[0];
  expect(filename).toBe('NAVILO-Funded-Journals-Simple.xlsx');
  expect(book.SheetNames).toEqual(['Funded Journal','Instructions','Worked Examples - NOT IMPORT']);
  expect(XLSX.utils.sheet_to_json<any[]>(book.Sheets['Funded Journal'],{header:1})).toEqual([h]);
 });
 it('rejects vehicle allocation in legacy funded templates',()=>{
  const legacy=['entry_no','entry_date','account_name','line_description','related_to','amount','funding_account'];
  expect(isFundedJournalTemplate(legacy)).toBe(true);
  expect(()=>expandFundedJournalRows([legacy,['A','2026-09-05','General Expenses','repair 7979','7979',600,'Amjad Payable']])).toThrow(/not part of General Journal/);
 });
});
