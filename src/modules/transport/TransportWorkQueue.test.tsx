// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportWorkQueue from './TransportWorkQueue';
import {clearWorkQueueCache} from './transportWorkQueueCache';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:(...args:any[])=>{
  const result=mock.rpc(...args);
  return {abortSignal:()=>result};
}}}));
afterEach(()=>{cleanup();mock.rpc.mockReset();clearWorkQueueCache();});
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

it('shows a cached desk immediately while refreshing its data in the background',async()=>{
  const props={desk:'operations' as const,scopeKey:'user-unique/company/branch',
    onOpenTrip:()=>{},onDeskChange:()=>{},onCashCounter:()=>{}};
  mock.rpc.mockResolvedValueOnce({data:{rows:[{id:'a',trip_no:'TR-CACHED',trip_date:'2026-10-12',customer:'Orbit'}],has_more:false},error:null});
  const first=render(<TransportWorkQueue {...props}/>);
  await screen.findByText('TR-CACHED');
  first.unmount();
  // Simulate a slow server after returning to the desk. Existing data must stay
  // visible, and the backend request must still happen for freshness.
  mock.rpc.mockImplementationOnce(()=>new Promise(()=>{}));
  render(<TransportWorkQueue {...props}/>);
  expect(screen.getByText('TR-CACHED')).toBeTruthy();
  expect(screen.queryByText(/Loading Trip Operations/)).toBeNull();
  expect(mock.rpc).toHaveBeenCalledTimes(2);
});

it('keeps existing rows visible during a manual refresh rather than blanking the desk',async()=>{
  const props={desk:'operations' as const,scopeKey:'user-refresh/company/branch',
    onOpenTrip:()=>{},onDeskChange:()=>{},onCashCounter:()=>{}};
  mock.rpc.mockResolvedValueOnce({data:{rows:[{id:'a',trip_no:'TR-REFRESH',trip_date:'2026-10-12',customer:'Orbit'}],has_more:false},error:null});
  render(<TransportWorkQueue {...props}/>);
  await screen.findByText('TR-REFRESH');
  mock.rpc.mockImplementationOnce(()=>new Promise(()=>{}));
  fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
  expect(screen.getByText('TR-REFRESH')).toBeTruthy();
  expect(screen.getByText(/Updating…/)).toBeTruthy();
  expect(screen.queryByText(/Loading Trip Operations/)).toBeNull();
});
