// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportCreditInvoiceReview from './TransportCreditInvoiceReview';
const mock=vi.hoisted(()=>({company:'company-a',unit:'bu-a',branch:'loc-a',fail:false,calls:[] as any[],rows:[] as any[],lastLoadExport:null as null|(()=>Promise<any>)}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:mock.company,company_name:'Company A'},activeBusinessUnit:{business_unit_id:mock.unit,business_unit_name:'Transport'},accessContext:{operating_location_id:mock.branch}})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:async(name:string,filter:any)=>{
 mock.calls.push({name,filter});
 if(mock.fail)return {data:null,error:{message:'Financial read permission denied'}};
 const list=mock.rows.filter(x=>(filter.p_lane==='all'||x.review_lane===filter.p_lane)&&(!filter.p_search||x.invoice_no.toLowerCase().includes(filter.p_search.toLowerCase())));
 return {data:{rows:list.slice(filter.p_offset,filter.p_offset+filter.p_limit),count:list.length,gross:list.reduce((s,x)=>s+x.total,0),paid:list.reduce((s,x)=>s+x.paid,0),outstanding:list.reduce((s,x)=>s+x.outstanding,0)},error:null};
}}}));
vi.mock('./ConfigurableReport',()=>({default:({report,loadExport}:any)=>{mock.lastLoadExport=loadExport;return <div data-testid="review-table">{JSON.stringify(report)}</div>}}));
beforeEach(()=>{
 mock.company='company-a';mock.unit='bu-a';mock.branch='loc-a';mock.fail=false;mock.calls=[];mock.lastLoadExport=null;
 mock.rows=[
 {sales_order_id:'1',invoice_no:'H-S-1',order_date:'2026-10-13',source_reference_candidate:null,distinct_source_references:0,already_posted_reference_matches:0,different_customer_reference_matches:0,matched_posted_total:0,source_import_cell:'NO INVOICE',source_import_distinct_values:1,source_import_row_first:14,source_import_row_last:14,trip_count:1,review_lane:'UNPAID_CORRECTION_CANDIDATE',total:400,paid:0,outstanding:400,allocations:0,allocated:0,journal_lines:4,journal_net:0},
 {sales_order_id:'2',invoice_no:'H-S-2',order_date:'2026-10-14',source_reference_candidate:'ORIG-224',distinct_source_references:1,already_posted_reference_matches:1,different_customer_reference_matches:1,matched_posted_total:450,source_import_cell:'ORIG-224',source_import_distinct_values:1,source_import_row_first:15,source_import_row_last:18,trip_count:3,review_lane:'HAS_ORIGINAL_NUMBER',total:300,paid:80,outstanding:220,allocations:1,allocated:80,journal_lines:4,journal_net:0},
 ];
});afterEach(()=>cleanup());
describe('Transport Credit invoice correction evidence report',()=>{
 it('shows read-only full-filter totals and no editing actions',async()=>{
  render(<TransportCreditInvoiceReview/>);
  await waitFor(()=>expect(screen.getByTestId('review-table').textContent).toContain('H-S-1'));
  const report=JSON.parse(screen.getByTestId('review-table').textContent||'{}');
  expect(report.rows.at(-1).slice(6,9)).toEqual([700,80,620]);
  expect(report.columns).toContain('Source reference (unverified)');
  expect(report.description).toContain('No invoice renumbering');
  expect(screen.queryByRole('button',{name:/post|reverse|rename|correct invoice/i})).toBeNull();
  expect(mock.calls.every(c=>c.name==='transport_credit_invoice_review')).toBe(true);
 });
 it('filters by lane and includes all export rows without changing payment evidence',async()=>{
  render(<TransportCreditInvoiceReview/>);
  await waitFor(()=>expect(screen.getByTestId('review-table').textContent).toContain('H-S-1'));
  fireEvent.change(screen.getByLabelText('Review lane'),{target:{value:'HAS_ORIGINAL_NUMBER'}});
  await waitFor(()=>expect(screen.getByTestId('review-table').textContent).not.toContain('H-S-1'));
  const report=JSON.parse(screen.getByTestId('review-table').textContent||'{}');
  expect(report.rows.at(-1).slice(6,9)).toEqual([300,80,220]);
  expect((await mock.lastLoadExport?.())?.rows[0][1]).toBe('H-S-2');
 });
 it('flags already-posted original references with another customer while preserving invoice totals',async()=>{
  render(<TransportCreditInvoiceReview/>);
  await waitFor(()=>expect(screen.getByTestId('review-table').textContent).toContain('H-S-2'));
  const report=JSON.parse(screen.getByTestId('review-table').textContent||'{}');
  const idx=report.columns.indexOf('Reference status');
  expect(idx).toBeGreaterThan(0);
  const risky=report.rows.find((row:any[])=>row[1]==='H-S-2');
  expect(risky[idx]).toBe('NUMBER ALREADY POSTED — DO NOT RENAME');
  expect(risky.slice(idx+1,idx+4)).toEqual([1,1,450]);
  const noSource=report.rows.find((row:any[])=>row[1]==='H-S-1');
  expect(noSource[idx]).toBe('Original reference missing');
  expect(report.rows.at(-1).slice(6,9)).toEqual([700,80,620]);
  expect((await mock.lastLoadExport?.())?.rows.some((row:any[])=>row.includes('NUMBER ALREADY POSTED — DO NOT RENAME'))).toBe(true);
 });
 it('shows imported invoice cell, spreadsheet rows, and evidence-specific next steps',async()=>{
  render(<TransportCreditInvoiceReview/>);
  await waitFor(()=>expect(screen.getByTestId('review-table').textContent).toContain('H-S-1'));
  const report=JSON.parse(screen.getByTestId('review-table').textContent||'{}');
  const cell=report.columns.indexOf('Original import cell'),loc=report.columns.indexOf('Source row(s)'),step=report.columns.indexOf('Required verification');
  expect(cell).toBeGreaterThan(0);
  const notIssued=report.rows.find((r:any[])=>r[1]==='H-S-1');
  expect(notIssued[cell]).toBe('NO INVOICE');
  expect(notIssued[loc]).toBe('14');
  expect(notIssued[step]).toContain('verify if invoice was ever issued');
  const conflict=report.rows.find((r:any[])=>r[1]==='H-S-2');
  expect(conflict[loc]).toBe('15–18');
  expect(conflict[step]).toContain('no renaming');
  expect(report.rows.at(-1).slice(6,9)).toEqual([700,80,620]);
 });
 it('denied permission withholds results and does not show misleading zero totals',async()=>{
  mock.fail=true;
  render(<TransportCreditInvoiceReview/>);
  expect((await screen.findByRole('alert')).textContent).toContain('permission denied');
  expect(screen.queryByTestId('review-table')).toBeNull();
 });
 it('clears prior workspace data when company changes',async()=>{
  const v=render(<TransportCreditInvoiceReview/>);
  await waitFor(()=>expect(screen.getByTestId('review-table').textContent).toContain('H-S-1'));
  mock.company='company-b';mock.branch='loc-b';mock.fail=true;
  v.rerender(<TransportCreditInvoiceReview/>);
  expect(screen.queryByTestId('review-table')).toBeNull();
  expect((await screen.findByRole('alert')).textContent).toContain('permission denied');
 });
});
