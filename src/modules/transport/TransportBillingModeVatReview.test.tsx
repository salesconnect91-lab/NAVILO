// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportBillingModeVatReview from './TransportBillingModeVatReview';
const mock=vi.hoisted(()=>({company:'c1',unit:'b1',branch:'l1',denied:false,calls:[] as any[],lastExport:null as null|(()=>Promise<any>)}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:mock.company,company_name:'Company A'},activeBusinessUnit:{business_unit_id:mock.unit,business_unit_name:'Transport'},accessContext:{operating_location_id:mock.branch}})}));
vi.mock('./ConfigurableReport',()=>({default:({report,loadExport}:any)=>{mock.lastExport=loadExport;return <div data-testid="vat-review-report">{JSON.stringify(report)}</div>}}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:async(name:string,p:any)=>{
 mock.calls.push({name,p});if(mock.denied)return {data:null,error:{message:'Financial read permission denied'}};
 const customer=[{document_id:'s1',invoice_no:'CS-1',invoice_date:'2026-10-15',party_name:'Alfa',posted_mode:'Cash',current_mode:'Credit',trip_mode:'credit',linked_net:125,linked_vat:0,invoice_total:125,paid:0,outstanding:125,trip_count:1,tax_percent:0,mode_diff:true}];
 const supplier=[{document_id:'p1',invoice_no:'PS-1',invoice_date:'2026-10-14',party_name:'Beta',posted_mode:'Cash',current_mode:'Credit',trip_mode:'',linked_net:200,linked_vat:0,invoice_total:200,paid:25,outstanding:175,trip_count:1,tax_percent:0,mode_diff:true}];
 const all=(p.p_side==='customer'?customer:supplier).filter(x=>p.p_kind==='all'||x.mode_diff).filter(x=>!p.p_search||x.invoice_no.includes(p.p_search)||x.party_name.includes(p.p_search));
 return {data:{rows:all.slice(p.p_offset,p.p_offset+p.p_limit),count:all.length,linked_net:all.reduce((s,x)=>s+x.linked_net,0),linked_vat:all.reduce((s,x)=>s+x.linked_vat,0),invoice_total:all.reduce((s,x)=>s+x.invoice_total,0)},error:null};
}}}));
beforeEach(()=>{mock.company='c1';mock.unit='b1';mock.branch='l1';mock.denied=false;mock.calls=[];mock.lastExport=null;});afterEach(cleanup);
describe('Billing Mode VAT read-only evidence review',()=>{
 it('displays customer posted cash versus credit Trip difference without VAT mutation',async()=>{
  render(<TransportBillingModeVatReview/>);
  await waitFor(()=>expect(screen.getByTestId('vat-review-report').textContent).toContain('CS-1'));
  const data=JSON.parse(screen.getByTestId('vat-review-report').textContent||'{}');
  expect(data.columns).toContain('Posted Mode');
  expect(data.description).toContain('NO VAT additions');
  expect(data.rows.at(-1).slice(8,11)).toEqual([125,0,125]);
  expect(mock.calls.every(c=>c.name==='transport_billing_mode_vat_review')).toBe(true);
  expect(screen.queryByRole('button',{name:/save|repost|correct vat/i})).toBeNull();
 });
 it('switches to suppliers with independent balances and exports full filter',async()=>{
  render(<TransportBillingModeVatReview/>);
  await waitFor(()=>expect(screen.getByTestId('vat-review-report').textContent).toContain('CS-1'));
  fireEvent.change(screen.getByLabelText('Side'),{target:{value:'supplier'}});
  await waitFor(()=>expect(screen.getByTestId('vat-review-report').textContent).toContain('PS-1'));
  const report=JSON.parse(screen.getByTestId('vat-review-report').textContent||'{}');
  expect(report.rows[0].slice(3,6)).toEqual(['Cash','Credit','']);
  expect(report.rows.at(-1).slice(8,11)).toEqual([200,0,200]);
  expect((await mock.lastExport?.())?.rows[0][1]).toBe('PS-1');
 });
 it('denied access hides previous totals and does not show fabricated zeros',async()=>{
  mock.denied=true;render(<TransportBillingModeVatReview/>);
  expect((await screen.findByRole('alert')).textContent).toContain('permission denied');
  expect(screen.queryByTestId('vat-review-report')).toBeNull();
 });
 it('clears stale data if workspace company changes',async()=>{
  const v=render(<TransportBillingModeVatReview/>);
  await waitFor(()=>expect(screen.getByTestId('vat-review-report').textContent).toContain('CS-1'));
  mock.company='c2';mock.branch='l2';mock.denied=true;v.rerender(<TransportBillingModeVatReview/>);
  expect(screen.queryByTestId('vat-review-report')).toBeNull();
  expect((await screen.findByRole('alert')).textContent).toContain('permission denied');
 });
});
