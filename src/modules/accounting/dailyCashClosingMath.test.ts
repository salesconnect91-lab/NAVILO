import {describe,expect,it} from 'vitest';
import {buildDailyClosing,type ClosingAccount,type ClosingEntry,type ClosingLine,type ClosingBalance} from './dailyCashClosingMath';

const accounts:ClosingAccount[]=[
 {id:'cash',code:'1001',name:'Cash in Hand',type:'asset',detail_type:'Cash on Hand'},
 {id:'snb',code:'1002',name:'SNB Bank',type:'asset',detail_type:'Bank Account'},
 {id:'petty',code:'1003',name:'Usman Petty Cash',type:'asset',detail_type:'Cash on Hand'},
 {id:'exp',name:'Office Expenses',type:'expense',detail_type:null},
 {id:'ar',name:'Receivables',type:'asset',detail_type:'Accounts Receivable'},
];
const day='2026-10-19';
const entries:ClosingEntry[]=[
 {id:'j1',entry_no:'JE-01',entry_date:day,description:'Received from customer',party_name:'OLAYAN',created_at:'2026-10-19T08:00:00Z'},
 {id:'j2',entry_no:'JE-02',entry_date:day,description:'Transfer cash into SNB',created_at:'2026-10-19T09:00:00Z'},
 {id:'j3',entry_no:'JE-03',entry_date:day,description:'Office expense',created_at:'2026-10-19T10:00:00Z'},
];
const line=(id:string,entry_id:string,account_id:string,debit:number,credit:number):ClosingLine=>({
 id,entry_id,account_id,debit,credit,account:account_id,coa:accounts.find(a=>a.id===account_id) as any,
});
const lines:ClosingLine[]=[
 line('l1','j1','cash',50,0),line('l2','j1','ar',0,50),
 line('l3','j2','cash',0,70),line('l4','j2','snb',70,0),
 line('l5','j3','exp',20,0),line('l6','j3','petty',0,20),
];
const balances:ClosingBalance[]=[
 {account_id:'cash',entry_date:'2026-10-18',debit:100,credit:0},
 {account_id:'snb',entry_date:'2026-10-18',debit:200,credit:0},
 {account_id:'petty',entry_date:'2026-10-18',debit:0,credit:10},
 {account_id:'cash',entry_date:day,debit:50,credit:70},
 {account_id:'snb',entry_date:day,debit:70,credit:0},
 {account_id:'petty',entry_date:day,debit:0,credit:20},
];
const summary={opening:290,closing:320,movement:30,difference:0};

describe('Daily Cash & Bank Closing reconciled report',()=>{
 it('shows full bank transfer legs, external receipts and expenses without double counting',()=>{
  const report=buildDailyClosing(day,accounts,balances,entries,lines,summary);
  expect(report.opening).toBe(290);expect(report.closing).toBe(320);
  expect(report.externalReceipts).toBe(50);expect(report.externalPayments).toBe(20);
  expect(report.grossReceipts).toBe(120);expect(report.grossPayments).toBe(90);
  expect(report.transferAmount).toBe(70);
  expect(report.movements.filter(m=>m.isTransfer)).toHaveLength(2);
  expect(report.movements.map(m=>m.overallRunning)).toEqual([340,340,340,320]);
  expect(report.accounts.find(a=>a.id==='cash')?.closing).toBe(80);
  expect(report.accounts.find(a=>a.id==='snb')?.closing).toBe(270);
  expect(report.accounts.find(a=>a.id==='petty')?.closing).toBe(-30);
  expect(report.reportRows.some(row=>row[0]==='INTERNAL TRANSFERS')).toBe(true);
  expect(report.reportRows.some(row=>row[0]==='ACCOUNT-WISE CLOSING')).toBe(true);
  expect(report.reportRows.filter(row=>String(row[1]).includes('JE-02'))).toHaveLength(2);
 });
 it('rejects mismatched posted cash flow and keeps misleading closing figures out of exports',()=>{
  expect(()=>buildDailyClosing(day,accounts,balances,entries,lines,{...summary,closing:321})).toThrow(/reconcile/);
  expect(()=>buildDailyClosing(day,accounts,balances,entries,lines,{...summary,difference:1})).toThrow(/reconcile/);
  expect(()=>buildDailyClosing(day,accounts,balances,entries,lines.filter(l=>l.id!=='l5'),summary)).toThrow(/unbalanced posted voucher/);
 });
 it('rejects a posted voucher whose lines were not completely fetched',()=>{
  expect(()=>buildDailyClosing(day,accounts,balances,entries,[...lines.filter(l=>l.entry_id!=='j3')],summary)).toThrow(/Incomplete posted voucher lines/);
 });
 it('keeps an inactive-but-funded cash ledger in reconciliation instead of dropping balances',()=>{
  const extended=[...accounts,{id:'closed-bank',name:'Closed SNB Account',type:'asset',detail_type:'Bank Account'}];
  const updated=[...balances,{account_id:'closed-bank',entry_date:'2026-10-18',debit:100,credit:0}];
  const report=buildDailyClosing(day,extended,updated,entries,lines,{opening:390,closing:420,movement:30,difference:0});
  expect(report.accounts.find(x=>x.id==='closed-bank')?.closing).toBe(100);
 });
});
