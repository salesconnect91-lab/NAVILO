// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
const state=vi.hoisted(()=>({
 rpc:vi.fn(),
 unit:'orbit',
}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({
 activeCompany:{company_id:'company',membership_role:'admin'},
 activeBusinessUnit:{business_unit_id:state.unit,business_unit_type:state.unit==='steel'?'steel':'transport',membership_role:'admin'},
 isPlatformOwner:true
})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:state.rpc}}));
import TransportCustomerBillingModes from './TransportCustomerBillingModes';

afterEach(()=>cleanup());
beforeEach(()=>{state.unit='orbit';state.rpc.mockReset()});

describe('Transport customer billing modes',()=>{
 it('renders a transport-wide label and saves customer mode by scoped RPC',async()=>{
  state.rpc.mockImplementation(async(name:string)=>{
   if(name==='transport_get_customer_billing_modes')return {data:{enabled:true,rows:[
    {id:'customer-a',name:'Customer A',mode:null,cash_invoices:0,credit_invoices:0},
    {id:'customer-b',name:'Customer B',mode:'Credit',cash_invoices:0,credit_invoices:2}
   ]},error:null};
   return {data:{mode:'Cash',status:'saved'},error:null};
  });
  render(<TransportCustomerBillingModes/>);
  expect(await screen.findByText('Customer Billing Rules · Transport')).toBeTruthy();
  expect(screen.queryByText('Customer Cash/Credit Lock · Orbit')).toBeNull();
  fireEvent.change(screen.getByLabelText('Billing mode for Customer A'),{target:{value:'Cash'}});
  await waitFor(()=>expect(state.rpc).toHaveBeenCalledWith('transport_set_customer_billing_mode',{p_customer_id:'customer-a',p_mode:'Cash'}));
  await waitFor(()=>expect((screen.getByLabelText('Billing mode for Customer A') as HTMLSelectElement).value).toBe('Cash'));
 });
 it('loads independent mode settings when the active transport business changes',async()=>{
  state.rpc.mockImplementation(async(name:string)=>{
   if(name==='transport_get_customer_billing_modes')return {data:{enabled:true,rows:[
    {id:'customer-a',name:'Customer A',mode:state.unit==='orbit'?'Credit':'Cash',cash_invoices:0,credit_invoices:0}
   ]},error:null};
   return {data:{},error:null};
  });
  const ui=render(<TransportCustomerBillingModes/>);
  await waitFor(()=>expect((screen.getByLabelText('Billing mode for Customer A') as HTMLSelectElement).value).toBe('Credit'));
  state.unit='gondal';
  ui.rerender(<TransportCustomerBillingModes/>);
  await waitFor(()=>expect((screen.getByLabelText('Billing mode for Customer A') as HTMLSelectElement).value).toBe('Cash'));
  expect(state.rpc.mock.calls.filter(([name])=>name==='transport_get_customer_billing_modes')).toHaveLength(2);
 });
 it('filters unconfigured customers without duplicating saved and allowed mode columns',async()=>{
  state.rpc.mockResolvedValue({data:{enabled:true,rows:[
   {id:'c1',name:'Configured Customer',mode:'Credit',cash_invoices:0,credit_invoices:1},
   {id:'c2',name:'New Customer',mode:null,cash_invoices:0,credit_invoices:0}
  ]},error:null});
  render(<TransportCustomerBillingModes/>);
  await screen.findByText('Configured 1 / 2');
  expect(screen.getAllByRole('columnheader').map(x=>x.textContent)).toEqual(['Customer','Existing invoices (Cash / Credit)','Billing mode']);
  fireEvent.change(screen.getByLabelText('Filter customer billing modes'),{target:{value:'unset'}});
  expect(screen.getByText('New Customer')).toBeTruthy();
  expect(screen.queryByText('Configured Customer')).toBeNull();
 });
 it('never queries customer billing modes in a non-Transport business',()=>{
  state.unit='steel';
  render(<TransportCustomerBillingModes/>);
  expect(screen.queryByText('Customer Billing Rules · Transport')).toBeNull();
  expect(state.rpc).not.toHaveBeenCalled();
 });
});
