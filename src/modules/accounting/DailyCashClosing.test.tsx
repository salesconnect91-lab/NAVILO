// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import DailyCashClosing from './DailyCashClosing';
const mock=vi.hoisted(()=>({
 company:'company-A',bu:'bu-A',location:'branch-A',denied:false,scope:[] as Array<{table:string,filters:Record<string,any>}>,
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
  return {data:{opening:10,closing:110,movement:100,difference:0,rows:[{category:'operating',amount:100,vouchers:1}]},error:null};
 },
 from:(table:string)=>{
  const q:any={table,filters:{}};
  for(const name of ['select','order','range','in'])q[name]=()=>q;
  q.eq=(col:string,value:any)=>{q.filters[col]=value;return q;};
  mock.scope.push(q);return q;
 }
}}));
vi.mock('@/lib/fetchAllPages',()=>({
 fetchAllPages:async(cb:any)=>{cb(0,999);return [{id:'j1',entry_no:'JE-1',entry_date:'2026-10-18',status:'posted',description:'Receipt'}];},
 fetchByIdChunks:async(_ids:string[],cb:any)=>{cb(['j1'],0,999);return [
  {id:'l1',entry_id:'j1',debit:100,credit:0,account:'Cash',coa:{name:'Petty Cash',type:'asset',detail_type:'cash_on_hand'}},
  {id:'l2',entry_id:'j1',debit:0,credit:100,account:'Sales',coa:{name:'Income',type:'revenue',detail_type:null}}
 ];}
}));
vi.mock('@/components/NaviloDateInput',()=>({default:({value,onChange,...props}:any)=><input aria-label="Closing date" type="date" value={value} onChange={onChange} {...props}/>}));
vi.mock('../transport/ConfigurableReport',()=>({default:({report}:any)=><div data-testid="closing-table">{JSON.stringify(report)}</div>}));
beforeEach(()=>{mock.company='company-A';mock.bu='bu-A';mock.location='branch-A';mock.denied=false;mock.scope=[];mock.calls=[]});afterEach(cleanup);
describe('Daily Cash Closing scope and evidence integrity',()=>{
 it('queries posted vouchers and lines with explicit company/BU/branch constraints',async()=>{
  render(<DailyCashClosing/>);
  await waitFor(()=>expect(screen.getByTestId('closing-table').textContent).toContain('JE-1'));
  expect(mock.calls).toEqual(['current_operating_location_id','accounting_cash_flow_report_scoped']);
  const e=mock.scope.find(x=>x.table==='journal_entries');
  const l=mock.scope.find(x=>x.table==='journal_lines');
  for(const x of [e,l]){
   expect(x?.filters.company_id).toBe('company-A');
   expect(x?.filters.business_unit_id).toBe('bu-A');
   expect(x?.filters.operating_location_id).toBe('branch-A');
  }
  const report=JSON.parse(screen.getByTestId('closing-table').textContent||'{}');
  expect(report.rows.at(-1)[5]).toBe(100);
  expect(report.description).toContain('Closing 110.00');
 });
 it('denied branch lookup suppresses sensitive voucher evidence',async()=>{
  mock.denied=true;render(<DailyCashClosing/>);
  expect((await screen.findByRole('alert')).textContent).toContain('Accounting permission denied');
  expect(screen.queryByTestId('closing-table')).toBeNull();
  expect(mock.scope.length).toBe(0);
 });
 it('switching company hides stale closing data and fails closed',async()=>{
  const view=render(<DailyCashClosing/>);
  await waitFor(()=>expect(screen.getByTestId('closing-table').textContent).toContain('JE-1'));
  mock.company='company-B';mock.denied=true;view.rerender(<DailyCashClosing/>);
  expect(screen.queryByTestId('closing-table')).toBeNull();
  expect((await screen.findByRole('alert')).textContent).toContain('Accounting permission denied');
 });
});
