// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import VehicleAccounting from './TransportVehicleAccountingReport';
const mock=vi.hoisted(()=>({company:'c1',unit:'b1',count:2,calls:[] as any[],failed:false,networkFailed:false}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:mock.company,company_name:'Business'},activeBusinessUnit:{business_unit_id:mock.unit,business_unit_name:'Transport'}})}));
vi.mock('@/components/NaviloDateInput',()=>({default:({value,onChange}:any)=><input type="date" value={value} onChange={onChange}/>}));
vi.mock('./ConfigurableReport',()=>({default:({report}:any)=><div data-testid="report">{JSON.stringify(report)}</div>}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>{const q:any={select:()=>q,eq:()=>q,order:()=>q,range:()=>Promise.resolve({data:[{id:'v1',vehicle_no:'7979'}],error:null})};return q;},rpc:async(n:string,args:any)=>{mock.calls.push({n,args});if(mock.networkFailed)throw new TypeError('Failed to fetch');if(n==='transport_vehicle_source_billing')return {data:{count:2,net:120,vat:18,gross:138,rows:[{event_date:'2026-10-15',original_invoice_no:'CLIENT-001',trip_no:'T-1',net:100,vat:15,gross:115},{event_date:'2026-10-16',original_invoice_no:'CLIENT-002',trip_no:'T-2',net:20,vat:3,gross:23}]},error:null};return mock.failed?{data:null,error:{message:'Accounting permission denied'}}:{data:{count:mock.count,revenue:300,cost:115,rows:[{event_date:'2026-10-17',entry_no:'SALE',category:'Sale Invoice',expense_accounts:'',revenue:300,cost:0},{event_date:'2026-10-17',entry_no:'VEXP',category:'Vehicle expense',expense_accounts:'Fuel',revenue:0,cost:115}]},error:null};}}}));
beforeEach(()=>{mock.company='c1';mock.unit='b1';mock.count=2;mock.calls=[];mock.failed=false;mock.networkFailed=false;});afterEach(cleanup);
describe('Vehicle accounting reports',()=>{
 it('opens the vehicle ledger with debit and credit columns only',async()=>{
  render(<VehicleAccounting/>);
  await screen.findByRole('option',{name:'7979'});
  fireEvent.change(screen.getByLabelText('Vehicle'),{target:{value:'v1'}});
  const report=JSON.parse((await screen.findByTestId('report')).textContent??'{}');
  expect(report.title).toContain('Ledger');
  expect(report.columns).toEqual(['Date','Document','Trip No','Particulars','Debit','Credit']);
  expect(report.rows).toEqual([
   ['17-Oct-26','SALE','','Sale Invoice',0,300],
   ['17-Oct-26','VEXP','','Vehicle expense · Fuel',115,0],
   ['TOTAL · selected period','','','',115,300],
  ]);
  expect(mock.calls.every(c=>c.n==='transport_vehicle_ledger')).toBe(true);
 });

 it('displays verified source billing separately without adding it to vehicle GL profit',async()=>{
  render(<VehicleAccounting/>);
  await screen.findByRole('option',{name:'7979'});
  fireEvent.change(screen.getByLabelText('Vehicle'),{target:{value:'v1'}});
  fireEvent.change(screen.getByLabelText('Statement'),{target:{value:'source'}});
  await waitFor(()=>expect(screen.getByTestId('report').textContent).toContain('CLIENT-001'));
  const table=JSON.parse(screen.getByTestId('report').textContent??'{}');
  expect(table.columns).toEqual(['Invoice Date','Source Invoice No','Trip No','Net Income','VAT','Gross']);
  expect(table.rows.at(-1)).toEqual(['TOTAL · full filter','','',120,18,138]);
  expect(table.description).toContain('must NOT be added again');
  expect(mock.calls.some(c=>c.n==='transport_vehicle_source_billing'&&c.args.p_vehicle==='v1')).toBe(true);
 });
 it('withholds totals on incomplete accounting response',async()=>{mock.count=3;render(<VehicleAccounting/>);await screen.findByRole('option',{name:'7979'});fireEvent.change(screen.getByLabelText('Vehicle'),{target:{value:'v1'}});expect((await screen.findByRole('alert')).textContent).toContain('Incomplete');expect(screen.queryByTestId('report')).toBeNull();});
 it('clears previous-company rows and selection on workspace change',async()=>{const view=render(<VehicleAccounting/>);await screen.findByRole('option',{name:'7979'});fireEvent.change(screen.getByLabelText('Vehicle'),{target:{value:'v1'}});await screen.findByTestId('report');mock.company='c2';mock.unit='b2';view.rerender(<VehicleAccounting/>);await waitFor(()=>expect((screen.getByLabelText('Vehicle') as HTMLSelectElement).value).toBe(''));expect(screen.queryByTestId('report')).toBeNull();});
 it('shows a clear server error instead of an empty ledger on network failure',async()=>{mock.networkFailed=true;render(<VehicleAccounting/>);await screen.findByRole('option',{name:'7979'});fireEvent.change(screen.getByLabelText('Vehicle'),{target:{value:'v1'}});expect((await screen.findByRole('alert')).textContent).toContain('could not reach the accounting server');expect(screen.queryByTestId('report')).toBeNull();});
 it('does not turn denied access into zero profit',async()=>{mock.failed=true;render(<VehicleAccounting/>);await screen.findByRole('option',{name:'7979'});fireEvent.change(screen.getByLabelText('Vehicle'),{target:{value:'v1'}});expect((await screen.findByRole('alert')).textContent).toContain('permission');expect(screen.queryByTestId('report')).toBeNull();});
});
