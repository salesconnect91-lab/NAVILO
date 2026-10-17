// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import VehicleAccounting from './TransportVehicleAccountingReport';
const mock=vi.hoisted(()=>({company:'c1',unit:'b1',count:2,calls:[] as any[],failed:false,revenueDebit:0}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:mock.company,company_name:'Business'},activeBusinessUnit:{business_unit_id:mock.unit,business_unit_name:'Transport'}})}));
vi.mock('@/components/NaviloDateInput',()=>({default:({value,onChange}:any)=><input type="date" value={value} onChange={onChange}/>}));
vi.mock('./ConfigurableReport',()=>({default:({report}:any)=><div data-testid="report">{JSON.stringify(report)}</div>}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>{const q:any={select:()=>q,eq:()=>q,order:()=>q,range:()=>Promise.resolve({data:[{id:'v1',vehicle_no:'7979'}],error:null})};return q;},rpc:async(n:string,args:any)=>{mock.calls.push({n,args});return mock.failed?{data:null,error:{message:'Accounting permission denied'}}:{data:{count:mock.count,revenue:300-mock.revenueDebit,cost:115,rows:[{event_date:'2026-10-17',entry_no:'SALE',category:'Sale Invoice',revenue:300,cost:0},{event_date:'2026-10-17',entry_no:'VEXP',category:'Vehicle expense',revenue:0,cost:115},...(mock.revenueDebit?[{event_date:'2026-10-17',entry_no:'MANUAL',category:'Manual journal',revenue:-mock.revenueDebit,cost:0}]:[])]},error:null};}}}));
beforeEach(()=>{mock.company='c1';mock.unit='b1';mock.count=2;mock.calls=[];mock.failed=false;mock.revenueDebit=0;});afterEach(cleanup);
describe('Vehicle accounting reports',()=>{
 it('includes sale income and expense cost and exports complete totals',async()=>{render(<VehicleAccounting/>);await screen.findByRole('option',{name:'7979'});fireEvent.change(screen.getByLabelText('Vehicle'),{target:{value:'v1'}});const report=await screen.findByTestId('report');expect(report.textContent).toContain('SALE');expect(report.textContent).toContain('VEXP');expect(report.textContent).toContain('185');fireEvent.change(screen.getByLabelText('Statement'),{target:{value:'profit'}});await waitFor(()=>expect(screen.getByTestId('report').textContent).toContain('Net Profit'));expect(mock.calls.every(c=>c.n==='transport_vehicle_ledger'&&c.args.p_vehicle==='v1')).toBe(true);});
 it('shows revenue-account manual debits separately while preserving vehicle net profit',async()=>{
  mock.count=3;mock.revenueDebit=75;
  render(<VehicleAccounting/>);
  await screen.findByRole('option',{name:'7979'});
  fireEvent.change(screen.getByLabelText('Vehicle'),{target:{value:'v1'}});
  await waitFor(()=>expect(screen.getByTestId('report').textContent).toContain('MANUAL'));
  const ledger=JSON.parse(screen.getByTestId('report').textContent??'{}');
  expect(ledger.rows[2].slice(4,8)).toEqual([0,75,-75,110]);
  expect(ledger.rows[3].slice(4,8)).toEqual([300,190,110,110]);
  fireEvent.change(screen.getByLabelText('Statement'),{target:{value:'profit'}});
  await waitFor(()=>expect(screen.getByTestId('report').textContent).toContain('Revenue-account debits'));
  const pl=JSON.parse(screen.getByTestId('report').textContent??'{}');
  expect(pl.rows).toEqual([
   ['Income',300],
   ['Expense-account costs',115],
   ['Revenue-account debits (manual journals)',75],
   ['Net Profit',110],
  ]);
 });
 it('withholds totals on incomplete accounting response',async()=>{mock.count=3;render(<VehicleAccounting/>);await screen.findByRole('option',{name:'7979'});fireEvent.change(screen.getByLabelText('Vehicle'),{target:{value:'v1'}});expect((await screen.findByRole('alert')).textContent).toContain('Incomplete');expect(screen.queryByTestId('report')).toBeNull();});
 it('clears previous-company rows and selection on workspace change',async()=>{const view=render(<VehicleAccounting/>);await screen.findByRole('option',{name:'7979'});fireEvent.change(screen.getByLabelText('Vehicle'),{target:{value:'v1'}});await screen.findByTestId('report');mock.company='c2';mock.unit='b2';view.rerender(<VehicleAccounting/>);await waitFor(()=>expect((screen.getByLabelText('Vehicle') as HTMLSelectElement).value).toBe(''));expect(screen.queryByTestId('report')).toBeNull();});
 it('does not turn denied access into zero profit',async()=>{mock.failed=true;render(<VehicleAccounting/>);await screen.findByRole('option',{name:'7979'});fireEvent.change(screen.getByLabelText('Vehicle'),{target:{value:'v1'}});expect((await screen.findByRole('alert')).textContent).toContain('permission');expect(screen.queryByTestId('report')).toBeNull();});
});
