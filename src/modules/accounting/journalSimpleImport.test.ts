import {describe,expect,it,vi} from 'vitest';
import * as XLSX from 'xlsx';
import {SIMPLE_JOURNAL_HEADERS,isSimpleJournalTemplate,normalizeSimpleJournalRows,downloadSimpleJournalTemplate,journalImportISODate} from './journalSimpleImport';
vi.mock('xlsx',async(importOriginal)=>({...await importOriginal<typeof import('xlsx')>(),writeFile:vi.fn()}));

const headers=[...SIMPLE_JOURNAL_HEADERS];
const pair=[
 ['ORB-SEP-001','2026-09-05','General Expenses','Vehicle 7979 repair','',600,0],
 ['','','Amjad Payable','Paid by Amjad','',0,600],
];
describe('Simple Debit/Credit Journal import',()=>{
 it('uses the seven-column sheet and maps it to the validated RPC schema',()=>{
  const result=normalizeSimpleJournalRows([headers,...pair]);
  expect(headers).toEqual(['entry_no','entry_date','account_name','line_description','party','debit','credit']);
  expect(result[0]).toEqual(['entry_no','entry_date','description','account_name','line_description','party_type','party_name','debit','credit']);
  expect(result[1]).toEqual(['ORB-SEP-001','2026-09-05','Vehicle 7979 repair','General Expenses','Vehicle 7979 repair','','','600.00','0.00']);
  expect(result[2]).toEqual(['ORB-SEP-001','2026-09-05','Vehicle 7979 repair','Amjad Payable','Paid by Amjad','','','0.00','600.00']);
  expect(headers).not.toContain('vehicle_no');
 });
 it('reports multiple Excel row mistakes with row numbers',()=>{
  const wrong=[headers,
   ['ORB-SEP-002','2026-09-01','General Expenses','Repair','',600,600],
   ['ORB-SEP-003','2026-09-01','General Expenses','Fuel','Amjad Payable',500,500],
  ];
  let message='';try{normalizeSimpleJournalRows(wrong)}catch(e){message=String((e as Error).message)}
  expect(message).toContain('Row 2');
  expect(message).toContain('Party column');
  expect(message).toContain('problem(s)');
 });
 it('rejects vehicle allocation in new and legacy templates with a useful route',()=>{
  const oldHeaders=[...headers,'vehicle_no'];
  expect(()=>normalizeSimpleJournalRows([oldHeaders,
   ['JE','2026-09-05','General Expenses','Vehicle 7979 repair','',600,0,'7979'],
   ['','','Amjad Payable','Paid','','',0,600,''],
  ])).toThrow(/Vehicle allocation is not part of General Journal/);
  const relatedHeaders=[...headers,'related_to'];
  expect(()=>normalizeSimpleJournalRows([relatedHeaders,
   ['JE','2026-09-05','General Expenses','Vehicle 7979 repair','',600,0,'Vehicle: 7979'],
   ['','','Amjad Payable','Paid','','',0,600,''],
  ])).toThrow(/Transport Vehicle Expenses/);
 });
 it('groups blank entry numbers by date without inventing balancing lines',()=>{
  const rows=normalizeSimpleJournalRows([headers,
   ['', '2026-09-02','General Expenses','Locks','',40,0],
   ['', '2026-09-02','Amjad Payable','Funding','',0,40],
   ['', '2026-09-05','General Expenses','Welding','',250,0],
   ['', '2026-09-05','Amjad Payable','Funding','',0,250],
  ]);
  expect(rows.slice(1).map(row=>row[0])).toEqual(['IMPORT-2026-09-02','IMPORT-2026-09-02','IMPORT-2026-09-05','IMPORT-2026-09-05']);
  expect(()=>normalizeSimpleJournalRows([headers,['','2026-09-02','General Expenses','Unfunded','',40,0]])).toThrow(/at least two lines/);
 });
 it('accepts Excel serial dates and NAVILO dates without shifting calendar day',()=>{
  expect(journalImportISODate('46266')).toBe('2026-09-01');
  expect(journalImportISODate('01-Sep-26')).toBe('2026-09-01');
  expect(journalImportISODate('15-Oct-2026')).toBe('2026-10-15');
  expect(journalImportISODate('2026-09-05')).toBe('2026-09-05');
  expect(journalImportISODate(new Date('2026-09-02T00:00:00.000Z'))).toBe('2026-09-02');
  expect(journalImportISODate(new Date('2026-09-02T23:00:00.000Z'))).toBe('2026-09-02');
  const rows=normalizeSimpleJournalRows([headers,
   ['R','46266','General Expenses','Repair','',500,0],
   ['','','Amjad Payable','Funded','',0,500],
  ]);
  expect(rows[1][1]).toBe('2026-09-01');
 });
 it('supports legacy AR/AP party mapping but rejects ambiguous Related To values',()=>{
  const oldHeaders=[...headers,'related_to'];
  const ar=normalizeSimpleJournalRows([oldHeaders,
   ['AR','2026-09-08','Accounts Receivable','Customer opening','',500,0,'Customer: ABC Trading'],
   ['','','Amjad Payable','Funded','',0,500,''],
  ]);
  expect(ar[1].slice(5,7)).toEqual(['customer','ABC Trading']);
  expect(()=>normalizeSimpleJournalRows([oldHeaders,
   ['ERR','2026-09-08','Driver Salary Running Account','Salary','',500,0,'Yasir'],
   ['','','Amjad Payable','Funded','',0,500,''],
  ])).toThrow(/Related To is ambiguous/);
 });
 it('requires Party Type and Party Name together and preserves party identity',()=>{
  const typedHeaders=['entry_no','entry_date','account_name','line_description','party_type','party_name','debit','credit'];
  expect(()=>normalizeSimpleJournalRows([typedHeaders,
   ['X','2026-09-05','Accounts Receivable','Customer','customer','',600,0],
   ['','','Amjad Payable','Funded','','',0,600],
  ])).toThrow(/Party Type was supplied without Party Name/);
  const result=normalizeSimpleJournalRows([typedHeaders,
   ['AR','2026-09-08','Accounts Receivable','Customer opening','customer','ABC Trading',500,0],
   ['','2026-09-08','Service Revenue','Sales','','',0,500],
  ]);
  expect(result[1].slice(5,7)).toEqual(['customer','ABC Trading']);
  expect(result[2].slice(5,7)).toEqual(['','']);
 });
 it('rejects unbalanced, single-sided, invalid and conflicting journals before RPC',()=>{
  expect(()=>normalizeSimpleJournalRows([headers,pair[0]])).toThrow(/at least two/);
  expect(()=>normalizeSimpleJournalRows([headers,pair[0],['','','Amjad Payable','Paid by Amjad','',0,550]])).toThrow(/not balanced/);
  expect(()=>normalizeSimpleJournalRows([headers,['X','2026-02-31','General Expenses','Repair','',600,0],['','2026-02-31','Amjad Payable','Funded','',0,600]])).toThrow(/valid YYYY-MM-DD/);
  expect(()=>normalizeSimpleJournalRows([headers,['X','2026-09-05','General Expenses','repair','',600,0],['X','2026-09-06','Amjad Payable','funded','',0,600]])).toThrow(/conflicting dates/);
 });
 it('recognizes only the simple Debit/Credit layout',()=>{
  expect(isSimpleJournalTemplate(headers)).toBe(true);
  expect(isSimpleJournalTemplate(['entry_no','entry_date','account_name','line_description','related_to','amount','funding_account'])).toBe(false);
  expect(isSimpleJournalTemplate(['entry_no','entry_date','description','account_name','line_description','party_type','party_name','debit','credit'])).toBe(false);
 });
 it('downloads a blank import sheet without a Vehicle column',()=>{
  downloadSimpleJournalTemplate();
  const [book,filename]=vi.mocked(XLSX.writeFile).mock.calls[vi.mocked(XLSX.writeFile).mock.calls.length-1];
  expect(filename).toBe('NAVILO-Journal-Simple-Debit-Credit.xlsx');
  expect(book.SheetNames).toEqual(['Journal Import','Instructions','Worked Examples - DO NOT IMPORT']);
  expect(XLSX.utils.sheet_to_json<any[]>(book.Sheets['Journal Import'],{header:1})).toEqual([headers]);
  expect(headers).not.toContain('vehicle_no');
  expect(XLSX.utils.sheet_to_json<any[]>(book.Sheets['Worked Examples - DO NOT IMPORT'],{header:1}).length).toBeGreaterThan(5);
 });
});
