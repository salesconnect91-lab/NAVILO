// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import TransportSupplierCharges from './TransportSupplierCharges';
const mock=vi.hoisted(()=>({rpc:vi.fn(),posted:false,base:null as number|null,amount:1500,charges:[] as any[]}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
 const q:any={};for(const method of ['select','eq','in','order','limit'])q[method]=()=>q;
 q.single=async()=>({data:{id:'rent',company_id:'company',trip_id:'trip',state:'finalized',base_amount:mock.base,amount:mock.amount,supplier_name_snapshot:'Supplier A'},error:null});
 q.then=(resolve:any)=>Promise.resolve({data:table==='charge_master'?[{id:'waiting',charge_key:'W',charge_name:'Waiting',default_rate:400}]:table==='transport_trip_supplier_charges'?mock.charges:mock.posted?[{id:'posted'}]:[],error:null}).then(resolve);return q;
}}}));
beforeEach(()=>{mock.posted=false;mock.base=null;mock.amount=1500;mock.charges=[];mock.rpc.mockReset().mockResolvedValue({data:{},error:null});});
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
