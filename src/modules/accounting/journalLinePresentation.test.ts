import {describe,it,expect} from 'vitest';
import {moveJournalRow,compareJournalLineOrder} from './journalLinePresentation';
describe('Journal row presentation',()=>{
 it('moves complete lines without changing amounts or Excel line breaks',()=>{
  const text='07-Sep-26\tAl Rajhi Bank\tCHARITY\n24-Sep-26\tAl Rajhi Bank\tPERSONAL';
  const rows=[{tempId:'a',debit:155,credit:0,description:text},{tempId:'b',debit:0,credit:155,description:'Funding'}];
  const next=moveJournalRow(rows,'b',0);
  expect(next.map(r=>r.tempId)).toEqual(['b','a']);expect(next[1]).toBe(rows[0]);expect(next[1].description).toBe(text);expect(rows[0].tempId).toBe('a');
  expect(next.reduce((s,r)=>s+r.debit-r.credit,0)).toBe(0);
 });
 it('ignores moves beyond either edge',()=>{const rows=[{tempId:'a'}];expect(moveJournalRow(rows,'a',-1)).toBe(rows);expect(moveJournalRow(rows,'a',1)).toBe(rows)});
 it('retains explicit saved order instead of grouping debits first',()=>{
  const rows=[{id:'a',debit:155,line_position:2},{id:'b',debit:0,line_position:1}];expect(rows.sort(compareJournalLineOrder).map(r=>r.id)).toEqual(['b','a']);
 });
 it('keeps legacy debit-first order where no positions were saved',()=>{expect([{id:'b',debit:0},{id:'a',debit:155}].sort(compareJournalLineOrder)[0].id).toBe('a')});
});
