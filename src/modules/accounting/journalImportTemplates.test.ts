import {describe,it,expect} from 'vitest';
import {TEMPLATE_HEADERS,TEMPLATE_ROWS} from './journalImportTemplates';

describe('Journal bulk template / Fast Journal field parity',()=>{
 it('supports account, related party, vehicle and debit/credit columns, plus journal identity and date',()=>{
  expect(TEMPLATE_HEADERS).toEqual([
    'entry_no','entry_date','description','account_head','account_name',
    'line_description','party_type','party_name','vehicle_no','debit','credit'
  ]);
 });
 it('never inserts fake account names, vehicle plates or posted journal amounts into a new import',()=>{
  expect(TEMPLATE_ROWS).toEqual([]);
  expect(TEMPLATE_HEADERS).not.toContain('account_code');
 });
});
