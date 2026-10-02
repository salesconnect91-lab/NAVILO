// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportQuickAdd from './TransportQuickAdd';
const mock=vi.hoisted(()=>({rpc:vi.fn(),insert:vi.fn()}));
vi.mock('@/modules/master-data/useTransportMasterClient',()=>({default:()=>({rpc:mock.rpc,from:()=>({insert:(p:any)=>{mock.insert(p);return {select:()=>({single:async()=>({data:{id:'new'},error:null})})}}})})}));
afterEach(()=>{cleanup();vi.clearAllMocks()});
function view(kind:any){const onCreated=vi.fn(async()=>{}),onClose=vi.fn();render(<TransportQuickAdd kind={kind} truckTypeId="tt" supplierId="" truckTypes={[{id:'tt',name:'Flatbed'}]} suppliers={[{id:'s',name:'Supplier'}]} onCreated={onCreated} onClose={onClose}/>);return {onCreated,onClose};}
describe('Quick master modals',()=>{
 it('exposes structured Driver fields and conditional Supplier',()=>{view('driver');fireEvent.change(screen.getByLabelText('Driver Type'),{target:{value:'supplier'}});expect(screen.getByLabelText('Supplier').hasAttribute('required')).toBe(true);for(const name of ['Driver Code','ID / CNIC / Iqama','Driving Licence No','Licence Expiry'])expect(screen.getByLabelText(name)).toBeTruthy();});
 it('permits Company-owned Vehicle without Supplier and requires actual Effective From',async()=>{
  mock.rpc.mockResolvedValue({data:'new',error:null});const events=view('vehicle');expect(screen.queryByLabelText('Supplier')).toBeNull();
  fireEvent.change(screen.getByLabelText('Plate / Vehicle No'),{target:{value:'ABC'}});fireEvent.change(screen.getByLabelText('Ownership Effective From'),{target:{value:'2026-01-01'}});
  fireEvent.submit(screen.getByRole('dialog'));await waitFor(()=>expect(events.onCreated).toHaveBeenCalledWith(expect.objectContaining({id:'new'})));expect(events.onClose).toHaveBeenCalled();
 });
 it('creates Supplier-owned Vehicle through canonical history RPC',async()=>{
  mock.rpc.mockResolvedValue({data:'new',error:null});view('vehicle');fireEvent.change(screen.getByLabelText('Ownership Type'),{target:{value:'supplier'}});
  fireEvent.change(screen.getByLabelText('Supplier'),{target:{value:'s'}});fireEvent.change(screen.getByLabelText('Plate / Vehicle No'),{target:{value:'ABC'}});
  fireEvent.change(screen.getByLabelText('Ownership Effective From'),{target:{value:'2026-01-01'}});fireEvent.submit(screen.getByRole('dialog'));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_create_vehicle_master',expect.objectContaining({p_supplier_id:'s',p_owner_type:'supplier'})));expect(mock.insert).not.toHaveBeenCalled();
 });
 it('shows denial in modal and leaves it open',async()=>{mock.rpc.mockResolvedValue({data:null,error:{message:'Permission denied'}});const events=view('customer');fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Customer'}});fireEvent.submit(screen.getByRole('dialog'));expect(await screen.findByRole('alert')).toHaveProperty('textContent','Permission denied');expect(events.onClose).not.toHaveBeenCalled();});
 it('blocks double-submit while canonical RPC is pending',async()=>{let finish:any;mock.rpc.mockReturnValue(new Promise(r=>{finish=r}));view('supplier');fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Supplier'}});fireEvent.submit(screen.getByRole('dialog'));fireEvent.submit(screen.getByRole('dialog'));expect(mock.rpc).toHaveBeenCalledTimes(1);finish({data:{id:'new'},error:null});await waitFor(()=>expect(screen.getByRole('button',{name:'Save & Select'}).hasAttribute('disabled')).toBe(false));});
});
