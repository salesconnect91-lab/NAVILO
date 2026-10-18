// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {accountingLocalDate} from '@/lib/accountingLocalDate';
import CashFlowStatement from './CashFlowStatement';
const mock=vi.hoisted(()=>({
 company:'company-A',bu:'bu-A',denied:false,reject:false,calls:[] as Array<{name:string,args:any}>,
}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({
 activeCompany:mock.company?{company_id:mock.company,company_name:'Company A'}:null,
 activeBusinessUnit:mock.bu?{business_unit_id:mock.bu,business_unit_name:'Transport'}:null,
})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:(name:string,args:any)=>{
 mock.calls.push({name,args});
 if(mock.reject)return Promise.reject(new Error('Network timeout'));
 if(mock.denied)return Promise.resolve({data:null,error:{message:'Accounting access denied'}});
 return Promise.resolve({data:{opening:120,closing:175,movement:55,difference:0,rows:[{category:'operating',vouchers:1,amount:55}]},error:null});
}}}));
vi.mock('@/components/NaviloDateInput',()=>({default:({value,onChange,...props}:any)=><input type="date" value={value} onChange={onChange} {...props}/>}));
vi.mock('./AccountingReportScopeSelect',()=>({default:({value,onChange}:any)=><select aria-label="Report scope" value={value} onChange={e=>onChange(e.target.value)}><option value="branch">Branch</option><option value="company">Company</option></select>}));
vi.mock('./DailyCashClosing',()=>({default:()=> <div>Daily Closing Placeholder</div>}));
vi.mock('../transport/ConfigurableReport',()=>({default:({report}:any)=><div data-testid="cash-flow-table">{JSON.stringify(report)}</div>}));
beforeEach(()=>{mock.company='company-A';mock.bu='bu-A';mock.denied=false;mock.reject=false;mock.calls=[];});afterEach(cleanup);
describe('Cash Flow Statement fail-closed scope',()=>{
 it('uses local calendar date not UTC day rollover',()=>{
  expect(accountingLocalDate(new Date(2026,9,18,0,15))).toBe('2026-10-18');
 });
 it('loads current scoped ledger evidence and refreshes',async()=>{
  render(<CashFlowStatement/>);
  await waitFor(()=>expect(screen.getByTestId('cash-flow-table').textContent).toContain('175'));
  const table=JSON.parse(screen.getByTestId('cash-flow-table').textContent||'{}');
  expect(table.rows.at(-1)).toEqual(['Closing cash and bank','',175]);
  expect(mock.calls[0].args.p_scope).toBe('branch');
  fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
  await waitFor(()=>expect(mock.calls.length).toBe(2));
 });
 it('a denied report withholds stale totals when company changes',async()=>{
  const view=render(<CashFlowStatement/>);
  await waitFor(()=>expect(screen.getByTestId('cash-flow-table').textContent).toContain('175'));
  mock.company='company-B';mock.denied=true;
  view.rerender(<CashFlowStatement/>);
  expect(screen.queryByTestId('cash-flow-table')).toBeNull();
  expect((await screen.findByRole('alert')).textContent).toContain('Accounting access denied');
 });
 it('rejected network call displays an error, not a hanging spinner',async()=>{
  mock.reject=true;render(<CashFlowStatement/>);
  expect((await screen.findByRole('alert')).textContent).toContain('Network timeout');
  expect(screen.queryByTestId('cash-flow-table')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
 });
 it('does not query cash flow without an active company',async()=>{
  mock.company='';render(<CashFlowStatement/>);
  expect((await screen.findByRole('alert')).textContent).toContain('Select an active company');
  expect(mock.calls.length).toBe(0);
 });
});
