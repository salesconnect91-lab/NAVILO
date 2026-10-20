import {describe,it,expect,vi} from 'vitest';
import * as XLSX from 'xlsx';
vi.mock('xlsx',async(importOriginal)=>({...await importOriginal<typeof import('xlsx')>(),writeFile:vi.fn()}));
import {TEMPLATE_HEADERS,TEMPLATE_ROWS,downloadExcelTemplate} from './journalImportTemplates';

describe('Journal bulk template / Fast Journal field parity',()=>{
 it('uses one account column and optional related party/vehicle fields, with journal identity and date',()=>{
  expect(TEMPLATE_HEADERS).toEqual([
    'entry_no','entry_date','description','account_name',
    'line_description','party_type','party_name','vehicle_no','debit','credit'
  ]);
 });
 it('downloads a valid blank Excel journal workbook and separate instructions',()=>{
  downloadExcelTemplate();
  expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
  const [book,filename]=vi.mocked(XLSX.writeFile).mock.calls[0];
  expect(filename).toBe('journal-import-template.xlsx');
  expect(book.SheetNames).toEqual(['Journal Import','Instructions']);
  const rows=XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['Journal Import'],{header:1});
  expect(rows).toEqual([TEMPLATE_HEADERS]);
 });
 it('never inserts fake account names, vehicle plates or posted journal amounts into a new import',()=>{
  expect(TEMPLATE_ROWS).toEqual([]);
  expect(TEMPLATE_HEADERS).not.toContain('account_code');
  expect(TEMPLATE_HEADERS).not.toContain('account_head');
 });
});
