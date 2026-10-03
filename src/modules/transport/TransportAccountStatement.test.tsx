// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportAccountStatement from './TransportAccountStatement';
const mock=vi.hoisted(()=>({export:vi.fn(),fail:false,output:true}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'c',company_name:'Company'},activeBusinessUnit:{business_unit_id:'b',business_unit_name:'Transport'}})}));
vi.mock('./transportPartyExport',()=>({exportPartyReport:mock.export}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:async(name:string,args:any)=>{if(name!=='transport_account_report_page')return {data:mock.output,error:null};const table=({driver:'transport_driver_account_movements',vehicle:'transport_vehicle_account_movements',contributions:'transport_vehicle_contributions'} as Record<string,string>)[args.p_kind];return accountPage(table);},from:(table:string)=>accountPage(table)}}));
function accountPage(table:string){
 const bill={event_id:'a',side:'supplier',employee_id:'employee',party_id:'supplier',party_name:'Original Driver',trip_ids:['trip'],trip_no:'Trip-1',journal_entry_id:'j',entry_no:'J-1',event_date:'2026-09-01',created_at:'2026-09-01',event_type:'salary_accrual',description:'Accrual',debit:100,credit:0,amount:100};
 const payment={...bill,event_id:'p',event_date:'2026-09-02',created_at:'2026-09-02',event_type:'salary_payment',debit:0,credit:30,amount:-30};
 const rows:Record<string,unknown[]>={transport_driver_account_movements:[bill,payment],transport_vehicle_account_movements:[{...bill,account_id:'vehicle',account_name:'Truck-1'},{...payment,account_id:'vehicle',account_name:'Truck-1'},{...bill,event_id:'ar',side:'customer',amount:200,account_id:'vehicle',account_name:'Truck-1'}],transport_financial_register:[{id:'trip',vehicle_id:'vehicle',vehicle_no:'Truck-1'}]};
 const q:any={};for(const m of ['select','order','range'])q[m]=()=>q;q.then=(resolve:any)=>Promise.resolve({data:rows[table]??[],error:mock.fail?{message:'Permission denied'}:null}).then(resolve);return q;
}
beforeEach(()=>{mock.export.mockReset();mock.fail=false;mock.output=true});afterEach(cleanup);
describe('Dated account statements',()=>{
 it('retains payroll employee identity and historical opening for partial payment',async()=>{
 render(<TransportAccountStatement kind="driver"/>);await screen.findByRole('option',{name:'Original Driver'});
 fireEvent.change(screen.getByLabelText('Payroll employee'),{target:{value:'employee'}});fireEvent.change(screen.getByLabelText('From'),{target:{value:'2026-09-02'}});
 await waitFor(()=>expect((screen.getByRole('button',{name:'Excel'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Excel'}));await waitFor(()=>expect(mock.export).toHaveBeenCalled());
 const table=mock.export.mock.calls[0][0];expect(table.rows[0][7]).toBe(100);expect(table.rows[1][7]).toBe(70);expect(table.rows[2][7]).toBe(70);
 });
 it('separates vehicle payable from receivable and excludes shared-document double counting',async()=>{
 render(<TransportAccountStatement kind="vehicle"/>);await screen.findByRole('option',{name:'Truck-1'});fireEvent.change(screen.getByLabelText('Vehicle'),{target:{value:'vehicle'}});
 await waitFor(()=>expect((screen.getByRole('button',{name:'Excel'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Excel'}));await waitFor(()=>expect(mock.export).toHaveBeenCalled());expect(mock.export.mock.calls[0][0].rows.at(-1)[7]).toBe(70);
 fireEvent.change(screen.getByLabelText('Balance side'),{target:{value:'customer'}});await waitFor(()=>expect((screen.getByRole('button',{name:'Excel'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Excel'}));await waitFor(()=>expect(mock.export).toHaveBeenCalledTimes(2));expect(mock.export.mock.calls[1][0].rows.at(-1)[7]).toBe(200);
 });
 it('disables output without Transport export permission',async()=>{mock.output=false;render(<TransportAccountStatement kind="driver"/>);await screen.findByRole('option',{name:'Original Driver'});fireEvent.change(screen.getByLabelText('Payroll employee'),{target:{value:'employee'}});expect((screen.getByRole('button',{name:'Excel'}) as HTMLButtonElement).disabled).toBe(true)});
 it('blocks output on permission failure',async()=>{mock.fail=true;render(<TransportAccountStatement kind="driver"/>);await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Excel'})).toBeNull()});
});
