import {describe,expect,it,vi} from 'vitest';
import * as XLSX from 'xlsx';
import {SIMPLE_JOURNAL_HEADERS,isSimpleJournalTemplate,normalizeSimpleJournalRows,downloadSimpleJournalTemplate,journalImportISODate} from './journalSimpleImport';
vi.mock('xlsx',async(importOriginal)=>({...await importOriginal<typeof import('xlsx')>(),writeFile:vi.fn()}));
const headers=[...SIMPLE_JOURNAL_HEADERS];
const pair=[
 ['ORB-SEP-001','2026-09-05','General Expenses','Vehicle 7979 repair','',600,''],
 ['','','Amjad Payable','Paid by Amjad','','',600]
];
describe('Simple Debit/Credit Journal import matches General Journal Entry form',()=>{
 it('explains multiple file mistakes with precise columns and row numbers in one upload',()=>{
  const wrong=[headers,
   ['', '2026-09-01','Vehicle 7979 Income','PAID FOR REPAIR OF 7979','Amjad Payable',600,600],
   ['', '2026-09-01','General Expenses','Fuel','Amjad Payable',500,500]
  ];
  let message='';
  try{normalizeSimpleJournalRows(wrong)}catch(e){message=String((e as Error).message)}
  expect(message).toContain('Row 2, columns F/G');
  expect(message).toContain('Row 2, column E (related_to)');
  expect(message).toContain('Row 3, columns F/G');
  expect(message).toContain('4 problem(s)');
 });

 it('groups entirely blank entry numbers by date without inventing balancing lines',()=>{
  const rows=normalizeSimpleJournalRows([headers,
   ['', '2026-09-02','General Expenses','Locks','5731',40,0],
   ['', '2026-09-02','Amjad Payable','Funding','',0,40],
   ['', '2026-09-05','General Expenses','Welding','5731',250,0],
   ['', '2026-09-05','Amjad Payable','Funding','',0,250],
  ]);
  expect(rows.slice(1).map(row=>row[0])).toEqual(['IMPORT-2026-09-02','IMPORT-2026-09-02','IMPORT-2026-09-05','IMPORT-2026-09-05']);
  expect(()=>normalizeSimpleJournalRows([headers,['','2026-09-02','General Expenses','Unfunded','5731',40,0]])).toThrow(/at least two lines/);
 });
 it('accepts uploaded Excel serial dates and NAVILO dd-MMM-yy without changing entry date',()=>{
  expect(journalImportISODate('46266')).toBe('2026-09-01');
  expect(journalImportISODate('01-Sep-26')).toBe('2026-09-01');
  expect(journalImportISODate('15-Oct-2026')).toBe('2026-10-15');
  expect(journalImportISODate('2026-09-05')).toBe('2026-09-05');
  expect(journalImportISODate('2026-02-31')).toBe('2026-02-31');
  const rows=normalizeSimpleJournalRows([headers,['R','46266','General Expenses','Repair','',500,0],['R','','Amjad Payable','Funded','','',500]]);
  expect(rows[1][1]).toBe('2026-09-01');
  expect(rows[2][1]).toBe('2026-09-01');
 });

 it('keeps vehicle expense details in the description without a Related To allocation',()=>{
  const result=normalizeSimpleJournalRows([headers,...pair]);
  expect(result[0]).toEqual(['entry_no','entry_date','description','account_name','line_description','party_type','party_name','vehicle_no','debit','credit']);
  expect(result[1]).toEqual(['ORB-SEP-001','2026-09-05','Vehicle 7979 repair','General Expenses','Vehicle 7979 repair','','','','600.00','0.00']);
  expect(result[2]).toEqual(['ORB-SEP-001','2026-09-05','Vehicle 7979 repair','Amjad Payable','Paid by Amjad','','','','0.00','600.00']);
 });
 it('allows the same entry number/date on both lines and separates a second entry',()=>{
  const rows=normalizeSimpleJournalRows([headers,...pair,['ORB-SEP-002','2026-09-06','Asif Driver Salary Running Account','Old salary settled','','417',0],['ORB-SEP-002','2026-09-06','Amjad Payable','Amjad funded','','0','417']]);
  expect(rows).toHaveLength(5);
  expect(rows[3][3]).toBe('Asif Driver Salary Running Account');
  expect(rows[3][7]).toBe('');
  expect(rows[4][3]).toBe('Amjad Payable');
 });
 it('handles expense lines without vehicle allocation, plus wallet recharge with correct accounts',()=>{
  const entries=normalizeSimpleJournalRows([headers,
   ['WALLET','2026-09-06','Syarah Fuel Payable','Wallet deposit','',1000,''],
   ['','','Amjad Payable','Wallet funded','','',1000],
   ['FUEL','2026-09-07','Transport & Freight','7979 diesel','',250,''],
   ['','','Syarah Fuel Payable','Used wallet','','',250]
  ]);
  expect(entries[1][3]).toBe('Syarah Fuel Payable');
  expect(entries[1][7]).toBe('');
  expect(entries[3][3]).toBe('Transport & Freight');
  expect(entries[3][7]).toBe('');
  expect(entries[4][3]).toBe('Syarah Fuel Payable');
 });
 it('maps Customer: / Supplier: only to matching party fields for existing AR/AP validations',()=>{
  const result=normalizeSimpleJournalRows([headers,
   ['AR','2026-09-08','Accounts Receivable','Customer opening','Customer: ABC Trading',500,0],
   ['','','Service Revenue','Sales','','0',500]
  ]);
  expect(result[1].slice(5,8)).toEqual(['customer','ABC Trading','']);
 });
 it('recognizes plain existing customer names on Accounts Receivable without treating them as vehicle numbers',()=>{
  const result=normalizeSimpleJournalRows([headers,
   ['JE-1050','2026-09-01','Accounts Receivable','Trip payment received','CASH-0593316767',600,0],
   ['','','Amjad Payable','Amjad funded','','',600]
  ]);
  expect(result[1].slice(5,8)).toEqual(['customer','CASH-0593316767','']);
  expect(result[2].slice(5,8)).toEqual(['','','']);
  expect(result[1].slice(8)).toEqual(['600.00','0.00']);
 });
 it('refuses unbalanced, single-sided, empty, negative, invalid, or two-sided journals before the RPC',()=>{
  expect(()=>normalizeSimpleJournalRows([headers,pair[0]])).toThrow(/at least two/);
  expect(()=>normalizeSimpleJournalRows([headers,pair[0],['','','Amjad Payable','Paid','','',550]])).toThrow(/not balanced/);
  for(const invalid of ['-200','abc','1.234','1e3'])expect(()=>normalizeSimpleJournalRows([headers,[...pair[0].slice(0,5),invalid,0],pair[1]])).toThrow();
  expect(()=>normalizeSimpleJournalRows([headers,[...pair[0].slice(0,5),600,600],pair[1]])).toThrow(/positive Debit OR Credit/);
  expect(()=>normalizeSimpleJournalRows([headers,['S','2026-02-31','General Expenses','Repair','','600',''],pair[1]])).toThrow(/valid YYYY-MM-DD/);
  expect(()=>normalizeSimpleJournalRows([headers,['X','2026-09-05','General Expenses','repair','',600,''],['X','2026-09-06','Amjad Payable','funded','','',600]])).toThrow(/conflicting dates/);
 });
 it('recognizes simple Debit/Credit and preserves legacy funded and advanced formats',()=>{
  expect(isSimpleJournalTemplate(headers)).toBe(true);
  expect(isSimpleJournalTemplate(['entry_no','entry_date','account_name','line_description','related_to','amount','funding_account'])).toBe(false);
  expect(isSimpleJournalTemplate(['entry_no','entry_date','description','account_name','line_description','party_type','party_name','vehicle_no','debit','credit'])).toBe(false);
 });
 it('download has 7 headers and no transactions; examples never appear in import sheet',()=>{
  downloadSimpleJournalTemplate();
  const [book,filename]=vi.mocked(XLSX.writeFile).mock.calls[vi.mocked(XLSX.writeFile).mock.calls.length-1];
  expect(filename).toBe('NAVILO-Journal-Simple-Debit-Credit.xlsx');
  expect(book.SheetNames).toEqual(['Journal Import','Instructions','Worked Examples - DO NOT IMPORT']);
  const rows=XLSX.utils.sheet_to_json<any[]>(book.Sheets['Journal Import'],{header:1});
  expect(rows).toEqual([headers]);
  const examples=XLSX.utils.sheet_to_json<any[]>(book.Sheets['Worked Examples - DO NOT IMPORT'],{header:1});
  expect(examples.length).toBeGreaterThan(5);
 });
});
