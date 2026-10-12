// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportWorkQueue from './TransportWorkQueue';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:(...args:any[])=>{
  const result=mock.rpc(...args);
  return {abortSignal:()=>result};
}}}));
afterEach(()=>{cleanup();mock.rpc.mockReset();});
it('loads a bounded department queue, opens the canonical Trip, and does not request the full Register',async()=>{
  const onOpenTrip=vi.fn(),onDeskChange=vi.fn(),onCashCounter=vi.fn();
  mock.rpc.mockResolvedValue({data:{rows:[{id:'a',trip_no:'TR-0001',trip_date:'2026-10-12',
    customer:'Orbit',job_no:'JOB-1',from:'Dammam',to:'Riyadh',driver:'Driver A',
    vehicle:'5731',trip_status:'draft',ppr_status:'pending'}],has_more:false},error:null});
  render(<TransportWorkQueue desk="operations" scopeKey="company:unit" onOpenTrip={onOpenTrip}
    onDeskChange={onDeskChange} onCashCounter={onCashCounter}/>);
  await screen.findByText('TR-0001');
  expect(mock.rpc.mock.calls.every(c=>c[0]==='transport_work_queue')).toBe(true);
  expect(mock.rpc.mock.calls[0][1]).toEqual({p_desk:'operations',p_page:0,p_search:''});
  fireEvent.click(screen.getByRole('button',{name:'Open Trip'}));
  expect(onOpenTrip).toHaveBeenCalledWith('TR-0001');
  fireEvent.click(screen.getByRole('button',{name:'Full Register'}));
  expect(onDeskChange).toHaveBeenCalledWith('all');
});
it('does not label recent payment-review trips as unpaid or calculate balances from snapshots',async()=>{
  mock.rpc.mockResolvedValue({data:{rows:[],has_more:false},error:null});
  render(<TransportWorkQueue desk="payments" scopeKey="company:unit" onOpenTrip={()=>{}}
    onDeskChange={()=>{}} onCashCounter={()=>{}}/>);
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalled());
  expect(screen.getByText(/Outstanding amounts and allocation must be checked/)).toBeTruthy();
  expect(screen.getByRole('button',{name:'Receive Customer Payment'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Pay Supplier Rent'})).toBeTruthy();
});
