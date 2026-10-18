import {describe,it,expect} from 'vitest';
import {loanRunningBalances,filterLoanRunningBalances,type LoanMovement} from './loanLedgerBalance';
const rows:LoanMovement[]=[
 {id:'1',lender_id:'alice',transaction_type:'loan_received',amount:1000,transaction_date:'2026-01-01',created_at:'2026-01-01',reference:'receipt A'},
 {id:'2',lender_id:'bob',transaction_type:'loan_received',amount:2000,transaction_date:'2026-01-02',created_at:'2026-01-02',reference:'receipt B'},
 {id:'3',lender_id:'alice',transaction_type:'loan_repayment',amount:200,transaction_date:'2026-01-03',created_at:'2026-01-03',reference:'repayment A'},
 {id:'4',lender_id:'bob',transaction_type:'loan_repayment',amount:500,transaction_date:'2026-01-04',created_at:'2026-01-04',reference:'repayment B'},
];
describe('independent loan party balances',()=>{
 it('does not mix lenders for All Lenders report',()=>expect(loanRunningBalances(rows).map(x=>x.balance)).toEqual([1000,2000,800,1500]));
 it('preserves historical running balance when filtering to one lender or searching',()=>{
  const numbered=loanRunningBalances(rows);
  expect(filterLoanRunningBalances(numbered,'alice','',new Map()).map(x=>x.balance)).toEqual([1000,800]);
  expect(filterLoanRunningBalances(numbered,'','repayment',new Map()).map(x=>x.balance)).toEqual([800,1500]);
 });
 it('sorts by transaction date then creation date then id',()=>{
  const reversed=loanRunningBalances([...rows].reverse());
  expect(reversed.map(x=>x.id)).toEqual(['1','2','3','4']);
 });
 it('preserves lender credit balances and negative overpayments',()=>{
  const v=loanRunningBalances([{...rows[0],amount:100},{...rows[2],amount:200}]);
  expect(v.at(-1)?.balance).toBe(-100);
 });
});
