import {describe,expect,it,vi} from 'vitest';
import * as XLSX from 'xlsx';
import {SIMPLE_JOURNAL_HEADERS,isSimpleJournalTemplate,normalizeSimpleJournalRows,downloadSimpleJournalTemplate,journalImportISODate} from './journalSimpleImport';
vi.mock('xlsx',async(importOriginal)=>({...await importOriginal<typeof import('xlsx')>(),writeFile:vi.fn()}));

const headers=[...SIMPLE_JOURNAL_HEADERS];
describe('Simple Debit/Credit Journal import',()=>{
 it('uses the single-Party seven-column template and maps balanced lines',()=>{
  const result=normalizeSimpleJournalRows([headers,
   ['ORB-SEP-001','2026-09-05','General Expenses','Vehicle 7979 repair','',600,0],
   ['','','Amjad Payable','Paid by Amjad','',0,600],
  ]);
  expect(headers).toEqual(['entry_no','entry_date','account_name','line_description','party','debit','credit']);
  expect(result[0]).toEqual(['entry_no','entry_date','description','account_name','line_description','party_type','party_name','debit','credit']);
  expect(result[1]).toEqual(['ORB-SEP-001','2026-09-05','Vehicle 7979 repair','General Expenses','Vehicle 7979 repair','','','600.00','0.00']);
  expect(result[2]).toEqual(['ORB-SEP-001','2026-09-05','Vehicle 7979 repair','Amjad Payable','Paid by Amjad','','','0.00','600.00']);
 });
 it('parses tagged customer/supplier names from the combined Party column',()=>{
  const result=normalizeSimpleJournalRows([headers,
   ['JE-AR-1','2026-09-05','Accounts Receivable','Customer invoice settlement','Customer: Test Customer',100,0],
   ['','','Bank','Receipt received','',0,100],
  ]);
  expect(result[1].slice(5,7)).toEqual(['customer','Test Customer']);
  expect(result[2].slice(5,7)).toEqual(['','']);
  expect(()=>normalizeSimpleJournalRows([headers,
   ['JE-AR-2','2026-09-05','General Expenses','Ambiguous party','Test Customer',100,0],
   ['','','Bank','Funding','',0,100],
  ])).toThrow(/Related To is ambiguous/);
 });
 it('inherits the date only on continuation rows in the same journal',()=>{
  const result=normalizeSimpleJournalRows([headers,
   ['JE-1','2026-09-02','General Expenses','Locks','',40,0],
   ['','','Amjad Payable','Funding','',0,40],
  ]);
  expect(result.slice(1).map(row=>row[1])).toEqual(['2026-09-02','2026-09-02']);
 });
 it('rejects a blank date when a new explicit journal starts',()=>{
  expect(()=>normalizeSimpleJournalRows([headers,
   ['JE-1','2026-09-02','General Expenses','Locks','',40,0],
   ['JE-2','','Amjad Payable','Funding','',0,40],
  ])).toThrow(/valid date such as 17-Oct-26/);
 });
 it('groups entirely blank entry numbers by date and rejects missing first dates',()=>{
  const result=normalizeSimpleJournalRows([headers,
   ['','2026-09-02','General Expenses','Locks','',40,0],
   ['','','Amjad Payable','Funding','',0,40],
  ]);
  expect(result.slice(1).map(row=>row[0])).toEqual(['IMPORT-2026-09-02','IMPORT-2026-09-02']);
  expect(()=>normalizeSimpleJournalRows([headers,
   ['','','General Expenses','Locks','',40,0],
   ['','','Amjad Payable','Funding','',0,40],
  ])).toThrow(/Entry No is required for the first row of every journal/);
 });
 it('rejects invalid calendar dates and unbalanced journals',()=>{
  expect(()=>normalizeSimpleJournalRows([headers,
   ['JE','2026-02-31','General Expenses','Repair','',600,0],
   ['','','Amjad Payable','Funded','',0,600],
  ])).toThrow(/valid date such as 17-Oct-26/);
  expect(()=>normalizeSimpleJournalRows([headers,
   ['JE','2026-09-05','General Expenses','Repair','',600,0],
   ['','','Amjad Payable','Funded','',0,550],
  ])).toThrow(/not balanced/);
 });
 it('accepts Excel serial dates and NAVILO dates without shifting calendar day',()=>{
  expect(journalImportISODate('46266')).toBe('2026-09-01');
  expect(journalImportISODate('46266.5')).toBe('2026-09-01');
  expect(journalImportISODate('46266.99999')).toBe('2026-09-01');
  expect(journalImportISODate('01-Sep-26')).toBe('2026-09-01');
  expect(journalImportISODate('17-Oct-26')).toBe('2026-10-17');
  expect(journalImportISODate('15-Oct-2026')).toBe('2026-10-15');
  expect(journalImportISODate('2026-09-05')).toBe('2026-09-05');
  expect(journalImportISODate('| 2026-09-02 |')).toBe('2026-09-02');
 });
 it('recognizes the combined Party column and keeps vehicle out',()=>{
  expect(isSimpleJournalTemplate(headers)).toBe(true);
  expect(isSimpleJournalTemplate(['entry_no','entry_date','account_name','line_description','debit','credit','vehicle_no'])).toBe(true);
  downloadSimpleJournalTemplate();
  const [book,filename]=vi.mocked(XLSX.writeFile).mock.calls[vi.mocked(XLSX.writeFile).mock.calls.length-1];
  expect(filename).toBe('NAVILO-Journal-Simple-Debit-Credit.xlsx');
  expect(XLSX.utils.sheet_to_json<any[]>(book.Sheets['Journal Import'],{header:1})).toEqual([headers]);
 });
});
