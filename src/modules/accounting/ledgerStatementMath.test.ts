import {describe,expect,it} from 'vitest';
import {movement,statementClosing,withOpeningBalances} from './ledgerStatementMath';
describe('accounting ledger brought-forward balances',()=>{
 it('includes opening and accumulates net movement for selected account',()=>{
  const rows=[{account_id:'AR',debit:500,credit:0},{account_id:'AR',debit:0,credit:125}];
  expect(withOpeningBalances(rows,{'account:AR':1000},r=>'account:'+r.account_id).map(r=>r.displayBalance)).toEqual([1500,1375]);
  expect(statementClosing(1000,rows)).toBe(1375);
 });
 it('does not mix multiple accounts or customers on one statement',()=>{
  const rows=[{id:'1',party_id:'a',debit:10,credit:0},{id:'2',party_id:'b',debit:0,credit:80},{id:'3',party_id:'a',debit:0,credit:15}];
  const result=withOpeningBalances(rows,{'party:customer:a':125,'party:customer:b':250},r=>'party:customer:'+r.party_id);
  expect(result.map(x=>x.displayBalance)).toEqual([135,170,120]);
 });
 it('handles credits, reversals, negative liability balances and empty opening',()=>{
  expect(movement({debit:0,credit:'600'})).toBe(-600);
  expect(statementClosing(-100,[{debit:200,credit:0},{debit:0,credit:150}])).toBe(-50);
  expect(withOpeningBalances([{account_id:'cash',debit:0,credit:0}],{},x=>x.account_id)[0].displayBalance).toBe(0);
 });
});
