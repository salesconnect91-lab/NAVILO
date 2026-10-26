// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import TransportRegisterCommercialPopup from './TransportRegisterCommercialPopup';
const mock=vi.hoisted(()=>({rpc:vi.fn(),signals:[] as AbortSignal[]}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'c'},activeBusinessUnit:{business_unit_id:'b'}})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:(...args:any[])=>{const p=mock.rpc(...args);p.abortSignal=(s:AbortSignal)=>{mock.signals.push(s);return p};return p}}}));
vi.mock('./TransportTripCharges',()=>({default:({tripId,editRate}:any)=><div>{editRate?'Customer combined rate':'Customer charges'} {tripId}</div>}));
vi.mock('./TransportSupplierCharges',()=>({default:({rentId}:any)=><div>Supplier charges {rentId}</div>}));
vi.mock('./TransportBulkSupplierRent',()=>({default:({initialTripId}:any)=><div>Supplier rate {initialTripId}</div>}));
vi.mock('./TransportInitialRate',()=>({default:()=> <div>Posted correction</div>}));
vi.mock('./TransportRegisterLinkedInvoice',()=>({default:({trip,side}:any)=><div>{side} invoice {trip.id}</div>}));
beforeEach(()=>{mock.rpc.mockReset();mock.signals=[]});afterEach(cleanup);
const trip=(id:string)=>({id,trip_no:id,customer_name:'Customer',owner_name:'Supplier'} as any);
const context=(id:string,side='customer')=>({side,trip:{id},charge_types:[],charge_lines:[],permissions:{},supplier_page:{rows:[{id:'rent-'+id,rent:{id:'rent-'+id}}]}});
it('opens the exact requested rate, charge or invoice view with one context request',async()=>{
 mock.rpc.mockImplementation(async(_name:string,args:any)=>({data:context(args.p_trip_id,args.p_side),error:null}));
 const {rerender}=render(<TransportRegisterCommercialPopup trip={trip('A')} kind="company_rate" onClose={vi.fn()} onChanged={async()=>{}}/>);
 expect(await screen.findByText('Customer combined rate A')).toBeTruthy();
 rerender(<TransportRegisterCommercialPopup trip={trip('A')} kind="supplier_charges" onClose={vi.fn()} onChanged={async()=>{}}/>);
 expect(await screen.findByText('Supplier charges rent-A')).toBeTruthy();
 rerender(<TransportRegisterCommercialPopup trip={trip('A')} kind="supplier_invoice_no" onClose={vi.fn()} onChanged={async()=>{}}/>);
 // Production uses a keyed target; a remount must keep the requested kind.
 cleanup();render(<TransportRegisterCommercialPopup trip={trip('B')} kind="supplier_invoice_no" onClose={vi.fn()} onChanged={async()=>{}}/>);
 expect(await screen.findByText('supplier invoice B')).toBeTruthy();
 expect(mock.rpc.mock.calls.every(([name])=>name==='transport_register_popup_context')).toBe(true);
});
it('ignores a late response from the previously selected Trip',async()=>{
 let finishA:(r:any)=>void=()=>{},finishB:(r:any)=>void=()=>{};
 mock.rpc.mockImplementation((_name:string,args:any)=>new Promise(resolve=>{if(args.p_trip_id==='A')finishA=resolve;else finishB=resolve}));
 const {rerender}=render(<TransportRegisterCommercialPopup trip={trip('A')} kind="supplier_charges" onClose={vi.fn()} onChanged={async()=>{}}/>);
 rerender(<TransportRegisterCommercialPopup trip={trip('B')} kind="supplier_charges" onClose={vi.fn()} onChanged={async()=>{}}/>);
 finishB({data:context('B','supplier'),error:null});expect(await screen.findByText('Supplier charges rent-B')).toBeTruthy();
 finishA({data:context('A','supplier'),error:null});await waitFor(()=>expect(screen.queryByText('Supplier charges rent-A')).toBeNull());
 expect(mock.signals[0].aborted).toBe(true);
});
it('fails closed if a response has the wrong Trip ID',async()=>{
 mock.rpc.mockResolvedValue({data:context('wrong'),error:null});
 render(<TransportRegisterCommercialPopup trip={trip('A')} kind="company_rate" onClose={vi.fn()} onChanged={async()=>{}}/>);
 expect((await screen.findByRole('alert')).textContent).toContain('could not be verified');
 expect(screen.queryByText('Customer combined rate wrong')).toBeNull();
});

it('renders the requested popup immediately from Register context without a second fetch',async()=>{
 mock.rpc.mockReset();
 render(<TransportRegisterCommercialPopup trip={trip('A')} kind="company_rate" preloadedContext={context('A')} onClose={vi.fn()} onChanged={async()=>{}}/>);
 expect(screen.getByText('Customer combined rate A')).toBeTruthy();
 expect(mock.rpc).not.toHaveBeenCalled();
});
