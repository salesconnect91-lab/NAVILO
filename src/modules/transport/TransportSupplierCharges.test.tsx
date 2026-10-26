// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import TransportSupplierCharges from './TransportSupplierCharges';
import TransportTripCharges from './TransportTripCharges';
const mock=vi.hoisted(()=>({rpc:vi.fn(),posted:false,linkedDraft:false,base:null as number|null,amount:1500,charges:[] as any[]}));
const customerTripRead=()=>({id:'trip',company_id:'company',business_unit_id:'unit',trip_no:'19255',internal_trip_no:'OIC-000240',trip_date:'2026-10-11',customer_id:'customer',customer_name_snapshot:'Customer A',from_location:'DAMMAM',to_location:'RIYADH',customer_rate:mock.amount,customer_base_rate:mock.base,customer_rate_state:'finalized'});
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
 const q:any={};for(const method of ['select','eq','in','order','limit'])q[method]=()=>q;
 q.single=async()=>({data:table==='transport_trips'?{id:'trip',company_id:'company',business_unit_id:'unit',trip_no:'TRP-1',trip_date:'2026-10-11',customer_id:'customer',customer_name_snapshot:'Customer A',from_location:'DAMMAM',to_location:'RIYADH',customer_rate:mock.amount,customer_base_rate:mock.base,customer_rate_state:'finalized'}:{id:'rent',company_id:'company',trip_id:'trip',state:'finalized',base_amount:mock.base,amount:mock.amount,supplier_name_snapshot:'Supplier A'},error:null});
 q.then=(resolve:any)=>Promise.resolve({data:table==='charge_master'?[{id:'waiting',charge_key:'W',charge_name:'Waiting',default_rate:400}]:table==='transport_trip_supplier_charges'?mock.charges:table==='transport_trip_customer_charges'?mock.charges.map(x=>({...x,code_snapshot:x.charge_key_snapshot})):table==='transport_supplier_document_rents'&&(mock.posted||mock.linkedDraft)?[{id:'link',document_id:'document'}]:table==='transport_supplier_documents'&&(mock.posted||mock.linkedDraft)?[{id:'document',purchase_order_id:'purchase'}]:table==='purchase_orders'&&mock.posted?[{id:'purchase',status:'posted'}]:table==='purchase_orders'&&mock.linkedDraft?[{id:'purchase',status:'draft'}]:[],error:null}).then(resolve);return q;
}}}));
beforeEach(()=>{mock.posted=false;mock.linkedDraft=false;mock.base=null;mock.amount=1500;mock.charges=[];mock.rpc.mockReset().mockResolvedValue({data:{},error:null});});
afterEach(cleanup);
const show=(props:Partial<Parameters<typeof TransportSupplierCharges>[0]>={})=>render(<TransportSupplierCharges rentId="rent" tripNo="TRP-1" editRate rateAllowed onClose={vi.fn()} onChanged={async()=>{}} {...props}/>);
async function addWaiting(){
 await waitFor(()=>expect((screen.getByLabelText(/Supplier rate excluding VAT/) as HTMLInputElement).value).toBe('1500'));
 fireEvent.change(screen.getByLabelText('Supplier charge'),{target:{value:'waiting'}});
 fireEvent.click(screen.getByRole('button',{name:'+ Add More Charge'}));
 fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Supplier agreed rent revised'}});
}
it('adds 400 to a legacy 1500 base without replacing the base or posting',async()=>{
 const close=vi.fn();show({onClose:close});await addWaiting();
 expect(screen.getByRole('button',{name:'Save Rate & Charges · 1900.00'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Save Rate & Charges · 1900.00'}));
 await waitFor(()=>expect(close).toHaveBeenCalled());
 expect(mock.rpc).toHaveBeenCalledWith('transport_finalize_supplier_rent',{p_rent_id:'rent',p_amount:1500,p_reason:'Supplier agreed rent revised'});
 expect(mock.rpc).toHaveBeenCalledWith('transport_replace_trip_supplier_charges',{p_rent_id:'rent',p_lines:[{charge_type_id:'waiting',amount:400}],p_reason:'Supplier agreed rent revised'});
 expect(mock.rpc.mock.calls.some(([name])=>name.includes('post_')||name==='transport_adjust_rate')).toBe(false);
});
it('changes base and removes charges with the total recalculated',async()=>{
 mock.base=null;mock.amount=1900;mock.charges=[{id:'line',charge_master_id:'waiting',charge_key_snapshot:'W',name_snapshot:'Waiting',amount:400}];show();
 await screen.findByLabelText('Waiting amount');fireEvent.change(screen.getByLabelText(/Supplier rate excluding VAT/),{target:{value:'1600'}});
 expect(screen.getByRole('button',{name:'Save Rate & Charges · 2000.00'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'×'}));
 expect(screen.getByRole('button',{name:'Save Rate & Charges · 1600.00'})).toBeTruthy();
});
it('locks posted rent and charges',async()=>{
 mock.posted=true;show();await screen.findByText(/Supplier invoice posted/);
 expect((screen.getByLabelText(/Supplier rate excluding VAT/) as HTMLInputElement).disabled).toBe(true);
 expect(screen.queryByRole('button',{name:/Save Rate/})).toBeNull();expect(mock.rpc).not.toHaveBeenCalled();
});
it('locks a supplier rent linked to a draft invoice and labels it as a draft',async()=>{
 show({preloaded:{rent:{id:'rent',trip_id:'trip',state:'finalized',base_amount:1500,amount:1500,supplier_name_snapshot:'Supplier A',posted:true,draft_linked:true},types:[],lines:[]}});await screen.findByText(/Supplier draft invoice exists/);
 expect(screen.queryByText(/Supplier invoice posted/)).toBeNull();
 expect((screen.getByLabelText(/Supplier rate excluding VAT/) as HTMLInputElement).disabled).toBe(true);
 expect(screen.queryByRole('button',{name:/Save Rate/})).toBeNull();expect(mock.rpc).not.toHaveBeenCalled();
});
it('keeps the popup open and explains a partial save so charges can be retried',async()=>{
 mock.rpc.mockImplementation(async(name:string)=>({data:{},error:name==='transport_finalize_supplier_rent'?{message:'Rent confirmation failed'}:null}));
 const close=vi.fn(),changed=vi.fn(async()=>{});show({onClose:close,onChanged:changed});await addWaiting();
 fireEvent.click(screen.getByRole('button',{name:'Save Rate & Charges · 1900.00'}));
 await screen.findByText(/Charges saved; base rent was not confirmed/);expect(close).not.toHaveBeenCalled();expect(changed).toHaveBeenCalled();
 mock.rpc.mockResolvedValue({data:{},error:null});fireEvent.click(screen.getByRole('button',{name:'Save Rate & Charges · 1900.00'}));
 await waitFor(()=>expect(close).toHaveBeenCalled());expect(mock.rpc.mock.calls.filter(([name])=>name==='transport_replace_trip_supplier_charges')).toHaveLength(1);
});
it('disables combined save without rent permission',async()=>{
 show({rateAllowed:false});await screen.findByLabelText('Reason');fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Correction'}});
 expect((screen.getByRole('button',{name:/Save Rate & Charges/}) as HTMLButtonElement).disabled).toBe(true);
});

it('shows and saves rate plus charges before any supplier rent record exists',async()=>{
 const close=vi.fn();mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_add_supplier_rent'?'new-rent':{},error:null}));
 show({rentId:undefined,newRent:{tripId:'trip',supplierId:'supplier',companyId:'company',businessUnitId:'unit',amount:1500,supplierName:'Supplier A'},tripContext:{customer:'Customer A',from:'DAMMAM',to:'RIYADH',vehicle:'1235'},onClose:close});
 await addWaiting();expect(screen.getByText('DAMMAM')).toBeTruthy();expect(screen.getByText('RIYADH')).toBeTruthy();
 expect(screen.getByText('Trip · TRP-1')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Save Rate & Charges · 1900.00'}));
 await waitFor(()=>expect(close).toHaveBeenCalled());
 expect(mock.rpc).toHaveBeenCalledWith('transport_add_supplier_rent',{p_trip_id:'trip',p_supplier_id:'supplier',p_amount:1500,p_reason:'Supplier agreed rent revised'});
 expect(mock.rpc).toHaveBeenCalledWith('transport_replace_trip_supplier_charges',expect.objectContaining({p_rent_id:'new-rent',p_lines:[{charge_type_id:'waiting',amount:400}]}));
 expect(mock.rpc).toHaveBeenCalledWith('transport_finalize_supplier_rent',expect.objectContaining({p_rent_id:'new-rent',p_amount:1500}));
 expect(mock.rpc.mock.calls.some(([name])=>name.includes('post_'))).toBe(false);
});
it('reuses a newly created supplier rent after a charge save failure',async()=>{
 mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_add_supplier_rent'?'new-rent':{},error:name==='transport_replace_trip_supplier_charges'?{message:'Mapping missing'}:null}));
 const close=vi.fn();show({rentId:undefined,newRent:{tripId:'trip',supplierId:'supplier',companyId:'company',businessUnitId:'unit',amount:1500,supplierName:'Supplier A'},tripContext:{from:'DAMMAM',to:'RIYADH'},onClose:close});await addWaiting();
 fireEvent.click(screen.getByRole('button',{name:'Save Rate & Charges · 1900.00'}));
 await screen.findByText(/Supplier rent created; Save did not finish/);
 mock.rpc.mockResolvedValue({data:{},error:null});fireEvent.click(screen.getByRole('button',{name:'Save Rate & Charges · 1900.00'}));
 await waitFor(()=>expect(close).toHaveBeenCalled());expect(mock.rpc.mock.calls.filter(([name])=>name==='transport_add_supplier_rent')).toHaveLength(1);
});

it('keeps the customer base fixed when adding a charge to a legacy rate',async()=>{
 mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_edit_trip_read'?customerTripRead():name==='transport_customer_side_posted'?false:{},error:null}));
 const close=vi.fn();render(<TransportTripCharges tripId="trip" onClose={close} onChanged={async()=>{}}/>);
 await screen.findByText('DAMMAM');expect(screen.getByText('Trip · 19255')).toBeTruthy();
 expect(screen.queryByText(/OIC-000240/)).toBeNull();
 fireEvent.change(screen.getByLabelText('Customer charge'),{target:{value:'waiting'}});fireEvent.click(screen.getByRole('button',{name:'+ Add More Charge'}));
 expect(screen.getByRole('button',{name:'Save Charges · 1900.00'})).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Charge correction reason'),{target:{value:'Waiting charge confirmed'}});fireEvent.click(screen.getByRole('button',{name:'Save Charges · 1900.00'}));
 await waitFor(()=>expect(close).toHaveBeenCalled());
 expect(mock.rpc).toHaveBeenCalledWith('transport_replace_trip_customer_charges',{p_trip_id:'trip',p_lines:[{charge_type_id:'waiting',amount:400}],p_reason:'Waiting charge confirmed'});
});
it('keeps the customer base fixed when removing a saved legacy charge',async()=>{
 mock.amount=1900;mock.charges=[{id:'line',charge_master_id:'waiting',charge_key_snapshot:'W',name_snapshot:'Waiting',amount:400}];
 mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_edit_trip_read'?customerTripRead():name==='transport_customer_side_posted'?false:{},error:null}));
 render(<TransportTripCharges tripId="trip" onClose={vi.fn()} onChanged={async()=>{}}/>);await screen.findByLabelText('Waiting amount');
 fireEvent.click(screen.getByRole('button',{name:'×'}));expect(screen.getByRole('button',{name:'Save Charges · 1500.00'})).toBeTruthy();
});
