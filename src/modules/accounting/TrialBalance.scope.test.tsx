// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import TrialBalance from './TrialBalance';

const mock=vi.hoisted(()=>({
 company:'company-A',businessUnit:'BU-A',
 failure:false,malformed:false,accountScopes:[] as string[],
 journalCalls:[] as any[],
 pending: null as null|((v:any)=>void),
}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({
 activeCompany:mock.company?{company_id:mock.company,company_name:'Company A'}:null,
 activeBusinessUnit:mock.businessUnit?{business_unit_id:mock.businessUnit,business_unit_name:'BU A'}:null,
})}));
vi.mock('@/lib/fetchAllPages',()=>({fetchAllPages:async(cb:any)=>{
 const q:any={scope:'',select:()=>q,eq:(col:string,val:any)=>{if(col==='company_id')mock.accountScopes.push(val);return q},order:()=>q,range:()=>q};
 cb(0,999);
 return [{id:'coa-1',code:'100',name:'Cash',type:'asset',is_group:false,allow_manual_entries:true,is_active:true}];
}}));
vi.mock('@/lib/supabase',()=>({supabase:{
 from:()=>{const q:any={select:()=>q,eq:(col:string,val:any)=>{if(col==='company_id')mock.accountScopes.push(val);return q},order:()=>q,range:()=>q};return q},
 rpc:async(name:string,args:any)=>{
  mock.journalCalls.push({name,args});
  if(mock.pending) return await new Promise(resolve=>{mock.pending=resolve});
  if(mock.failure)return {error:{message:'Accounting permission denied'},data:null};
  if(mock.malformed)return {error:null,data:{not:'an array'}};
  return {error:null,data:[{account_id:'coa-1',entry_date:'2026-10-01',debit:300,credit:0}]};
 },
}}));
vi.mock('@/lib/documentPrintSettings',()=>({
 loadDocumentPrintSettings:async()=>null,documentContactText:()=>'',documentTaxText:()=>'',
}));
vi.mock('@/lib/accountingReportPdf',()=>({downloadAccountingReportPdf:vi.fn()}));
vi.mock('../transport/ConfigurableReport',()=>({default:({report}:any)=><pre data-testid="trial-export">{JSON.stringify(report)}</pre>}));
vi.mock('@/components/NaviloDateInput',()=>({default:({value,onChange,...props}:any)=><input type="date" value={value} onChange={onChange} {...props}/>}));
vi.mock('./AccountingReportScopeSelect',()=>({default:({value,onChange}:any)=><select aria-label="Report scope" value={value} onChange={e=>onChange(e.target.value)}><option value="branch">Branch</option><option value="company">Company</option></select>}));
beforeEach(()=>{mock.company='company-A';mock.businessUnit='BU-A';mock.failure=false;mock.malformed=false;mock.accountScopes=[];mock.journalCalls=[];mock.pending=null});
afterEach(cleanup);
describe('Trial Balance tenant guard and fail-closed evidence',()=>{
 it('explicitly scopes chart of accounts and loads posted balance data',async()=>{
  render(<MemoryRouter><TrialBalance/></MemoryRouter>);
  await waitFor(()=>expect(mock.journalCalls.length).toBeGreaterThan(0));
  await waitFor(()=>expect(mock.accountScopes).toContain('company-A'));
  expect(mock.journalCalls[0].name).toBe('accounting_report_balances_scoped');
  expect(mock.journalCalls[0].args.p_scope).toBe('branch');
 });
 it('permission denial hides stale report totals after changing company',async()=>{
  const v=render(<MemoryRouter><TrialBalance/></MemoryRouter>);
  await waitFor(()=>expect(screen.getByTestId('trial-export').textContent).toContain('300'));
  mock.company='company-B';mock.failure=true;v.rerender(<MemoryRouter><TrialBalance/></MemoryRouter>);
  await waitFor(()=>expect(screen.getByText('Accounting permission denied')).toBeTruthy());
  expect(mock.accountScopes).toContain('company-B');
  expect(screen.queryByText(/300\.00/)).toBeNull();
 });
 it('malformed RPC output never shows a fabricated balanced trial balance',async()=>{
  mock.malformed=true;
  render(<TrialBalance/>);
  await waitFor(()=>expect(screen.getByText('Incomplete Trial Balance evidence; totals withheld.')).toBeTruthy());
  expect(screen.queryByText(/300\.00/)).toBeNull();
 });
 it('missing company prevents query',async()=>{
  mock.company='';
  render(<TrialBalance/>);
  await waitFor(()=>expect(screen.getByText('Active company and business unit required.')).toBeTruthy());
  expect(mock.journalCalls).toHaveLength(0);
 });
});
