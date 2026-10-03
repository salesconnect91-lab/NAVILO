// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportAudit from './TransportAudit';
const mock=vi.hoisted(()=>({rpc:vi.fn(),company:'c'}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:mock.company},activeBusinessUnit:{business_unit_id:'b'}})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc}}));
const report={trip_no:'TRP-1',count:501,deleted:false,labels:{customer:'Test Customer'},snapshot:{customer_id:'customer'},rows:[{id:1,event_type:'update',old_data:{customer_rate:100},new_data:{customer_rate:150},actor_name:'operator@example.test',event_at:'2026-10-03T23:30:00Z',event_reason:'Agreed rate',source:'Trip entry'}]};
beforeEach(()=>{mock.company='c';mock.rpc.mockReset().mockResolvedValue({data:report,error:null});});
afterEach(cleanup);
describe('exact Trip audit',()=>{
 it('makes no initial request, normalizes exact input, and shows recorded evidence',async()=>{
  render(<TransportAudit/>);expect(mock.rpc).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Audit Trip No'),{target:{value:' trp-1 '}});fireEvent.click(screen.getByRole('button',{name:'Generate audit report'}));
  await screen.findByText('Trip updated');
  expect(mock.rpc).toHaveBeenCalledWith('transport_trip_audit_report',{p_trip_no:'TRP-1',p_limit:500,p_offset:0});
  expect(screen.getByText('100')).toBeTruthy();expect(screen.getByText('150')).toBeTruthy();
  expect(screen.getByText(/operator@example.test/)).toBeTruthy();expect(screen.getByText('Test Customer')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Next'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenLastCalledWith('transport_trip_audit_report',{p_trip_no:'TRP-1',p_limit:500,p_offset:500}));
 });
 it('regenerates the same Trip and clears old evidence after a workspace change',async()=>{
  const {rerender}=render(<TransportAudit/>);
  fireEvent.change(screen.getByLabelText('Audit Trip No'),{target:{value:'TRP-1'}});fireEvent.click(screen.getByRole('button',{name:'Generate audit report'}));
  await screen.findByText('Trip updated');fireEvent.click(screen.getByRole('button',{name:'Generate audit report'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(2));await screen.findByText('Trip updated');
  mock.company='another';rerender(<TransportAudit/>);await waitFor(()=>expect(screen.queryByText('Trip updated')).toBeNull());
  expect((screen.getByLabelText('Audit Trip No') as HTMLInputElement).value).toBe('');
 });
 it('shows retained deleted history and handles API rejection without mixed evidence',async()=>{
  mock.rpc.mockResolvedValueOnce({data:{...report,deleted:true},error:null});render(<TransportAudit/>);
  fireEvent.change(screen.getByLabelText('Audit Trip No'),{target:{value:'TRP-1'}});fireEvent.click(screen.getByRole('button',{name:'Generate audit report'}));
  await screen.findByText('Trip deleted · history retained');
  mock.rpc.mockResolvedValueOnce({data:null,error:{message:'Transport view permission required'}});
  fireEvent.change(screen.getByLabelText('Audit Trip No'),{target:{value:'TRP-2'}});fireEvent.click(screen.getByRole('button',{name:'Generate audit report'}));
  await screen.findByRole('alert');expect(screen.queryByText('Trip updated')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Transport view permission required');
 });
});
