// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import DailyCashClosing from './DailyCashClosing';
const mock=vi.hoisted(()=>({
 company:'company-A',bu:'bu-A',location:'branch-A',denied:false,
 scope:[] as Array<{table:string;filters:Record<string,unknown>}>,
 calls:[] as string[]
}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({
 activeCompany:mock.company?{company_id:mock.company,company_name:'Company A'}:null,
 activeBusinessUnit:mock.bu?{business_unit_id:mock.bu,business_unit_name:'Transport'}:null,
})}));
vi.mock('@/lib/supabase',()=>({supabase:{
 rpc:async(name:string)=>{
  mock.calls.push(name);
  if(mock.denied)return {data:null,error:{message:'Accounting permission denied'}};
  if(name==='current_operating_location_id')return {data:mock.location,error:null};
  if(name==='accounting_cash_flow_report_scoped')
   return {data:{opening:10,closing:110,movement:100,difference:0},error:null};
  if(name==='accounting_report_balances_scoped')
   return {data:[{account_id:'cash',entry_date:'2026-10-18',debit:10,credit:0},
     {account_id:'cash',entry_date:'2026-10-19',debit:100,credit:0}],error:null};
  return {data:null,error:{message:'Unexpected RPC '+name}};
 },
 from:(table:string)=>{
  const q:any={table,filters:{}};
  for(const name of ['select','order','range','in'])q[name]=()=>q;
  q.eq=(col:string,value:unknown)=>{q.filters[col]=value;return q;};
  mock.scope.push(q);return q;
 }
}}));
vi.mock('@/lib/accountingLocalDate',()=>({accountingLocalDate:()=> '2026-10-19'}));
vi.mock('@/lib/fetchAllPages',()=>({
 fetchAllPages:async(cb:any)=>{
  const query=cb(0,999);
  if(query.table==='chart_of_accounts')return [
   {id:'cash',code:'1000',name:'Petty Cash',type:'asset',detail_type:'cash_on_hand'},
   {id:'sales',code:'4000',name:'Sales Income',type:'revenue',detail_type:null},
  ];
  return [{id:'j1',entry_no:'JE-1',entry_date:'2026-10-19',status:'posted',
   created_at:'2026-10-19T10:00:00Z',description:'Receipt',party_name:'OLAYAN'}];
 },
 fetchByIdChunks:async(_ids:string[],cb:any)=>{
  cb(['j1'],0,999);return [
   {id:'l1',entry_id:'j1',account_id:'cash',debit:100,credit:0,account:'Cash',
    coa:{id:'cash',name:'Petty Cash',type:'asset',detail_type:'cash_on_hand'}},
   {id:'l2',entry_id:'j1',account_id:'sales',debit:0,credit:100,account:'Sales',
    coa:{id:'sales',name:'Income',type:'revenue',detail_type:null}}
  ];
 }
}));
vi.mock('@/components/NaviloDateInput',()=>({default:({value,onChange,...props}:any)=>
 <input aria-label="Closing date" type="date" value={value} onChange={onChange} {...props}/>}));
vi.mock('../transport/ConfigurableReport',()=>({default:({report}:any)=><div data-testid="closing-table">{JSON.stringify(report)}</div>}));
beforeEach(()=>{mock.company='company-A';mock.bu='bu-A';mock.location='branch-A';mock.denied=false;mock.scope=[];mock.calls=[]});
afterEach(cleanup);
const renderClosing=()=>render(<MemoryRouter><DailyCashClosing/></MemoryRouter>);
describe('Daily Cash Closing scope and evidence integrity',()=>{
 it('uses posted company/BU/branch journal evidence plus branch-scoped ledger reconciliation',async()=>{
  renderClosing();
  await waitFor(()=>expect(screen.getByTestId('closing-table').textContent).toContain('JE-1'));
  expect(mock.calls).toEqual(['current_operating_location_id',
   'accounting_cash_flow_report_scoped','accounting_report_balances_scoped']);
  for(const table of ['journal_entries','journal_lines']){
   const q=mock.scope.find(x=>x.table===table);
   expect(q?.filters.company_id).toBe('company-A');
   expect(q?.filters.business_unit_id).toBe('bu-A');
   expect(q?.filters.operating_location_id).toBe('branch-A');
  }
  const coa=mock.scope.find(x=>x.table==='chart_of_accounts');
  expect(coa?.filters.company_id).toBe('company-A');
  const report=JSON.parse(screen.getByTestId('closing-table').textContent||'{}');
  expect(report.rows.some((r:any[])=>r[0]==='OPENING BALANCE')).toBe(true);
  expect(report.rows.some((r:any[])=>r[0]==='ACCOUNT-WISE CLOSING')).toBe(true);
  expect(report.description).toContain('Closing SAR 110.00');
  expect(screen.getByText(/Posted reconciliation PASS/)).toBeTruthy();
 });
 it('denied branch lookup suppresses sensitive voucher evidence',async()=>{
  mock.denied=true;renderClosing();
  expect((await screen.findByRole('alert')).textContent).toContain('Accounting permission denied');
  expect(screen.queryByTestId('closing-table')).toBeNull();
  expect(mock.scope.length).toBe(0);
 });
 it('switching company hides old report before an error is returned',async()=>{
  const view=renderClosing();
  await waitFor(()=>expect(screen.getByTestId('closing-table').textContent).toContain('JE-1'));
  mock.company='company-B';mock.denied=true;view.rerender(<MemoryRouter><DailyCashClosing/></MemoryRouter>);
  expect(screen.queryByTestId('closing-table')).toBeNull();
  expect((await screen.findByRole('alert')).textContent).toContain('Accounting permission denied');
 });
});
