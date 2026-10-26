// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportRegisterDraftInvoiceEditor from './TransportRegisterDraftInvoiceEditor';
const mock=vi.hoisted(()=>({rpc:vi.fn(),saved:vi.fn(async()=>{}),fail:false}));
vi.mock('./TransportDialog',()=>({default:({children}:any)=><div>{children}</div>}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
 const q:any={select:()=>q,in:()=>q,eq:()=>q,then:(resolve:any)=>Promise.resolve({data:table==='transport_trips'?[{id:'trip-1',customer_base_rate:2400,customer_rate:2430},{id:'trip-2',customer_base_rate:1000,customer_rate:1000}]:table==='charge_master'?[{id:'charge-1',charge_name:'Waiting',default_rate:30,applies_to:'sales'}]:[{trip_id:'trip-1',charge_master_id:'charge-1',amount:30}],error:null}).then(resolve)};return q;
}}}));
beforeEach(()=>{mock.fail=false;mock.saved.mockClear();mock.rpc.mockReset();mock.rpc.mockImplementation(async(name:string,args:any)=>{
 if(name==='transport_register_posted_invoice_edit_context')return {data:{account_id:'revenue',party_id:'customer',party_name:'Customer',invoice_no:'ORIGINAL-1',invoice_date:'2026-10-25',line_ids:['trip-1'],trip_ids:['trip-1']},error:null};
 if(name==='transport_bulk_rate_page'){const current=args.p_filters.initialTrip;return {data:{rows:current?[{id:'trip-1',trip_no:'46',customer_id:'customer',customer_rate_state:'finalized',customer_rate_locked:true,customer_rate:2430}]:[{id:'trip-2',trip_no:'48',customer_id:'customer',customer_rate_state:'finalized',customer_rate:1000}]},error:null};}
 if(name==='transport_admin_edit_posted_invoice')return mock.fail?{data:null,error:{message:'Selected Trip is linked to another invoice'}}:{data:{success:true,invoice_no:'ORIGINAL-1',journal_entry_id:'same-journal'},error:null};
 return {data:null,error:{message:'Unexpected RPC'}};
});});
afterEach(cleanup);
const show=()=>render(<TransportRegisterDraftInvoiceEditor mode="posted" row={{side:'customer',document_id:'doc-1',order_id:'order-1',invoice_no:'ORIGINAL-1',invoice_date:'2026-10-25',party_name:'Customer',trip_count:1}} onClose={vi.fn()} onSaved={mock.saved}/>);
it('saves composition, rate and charge changes atomically on the original posted invoice',async()=>{
 show();const second=await screen.findByRole('checkbox',{name:'Include Trip 48'});
 await waitFor(()=>expect((screen.getByRole('spinbutton',{name:'Base rate Trip 46'}) as HTMLInputElement).value).toBe('2400'));
 expect((screen.getByRole('textbox',{name:'Draft invoice number'}) as HTMLInputElement).disabled).toBe(true);
 fireEvent.click(second);fireEvent.change(screen.getByRole('spinbutton',{name:'Base rate Trip 46'}),{target:{value:'2500'}});
 fireEvent.change(screen.getByRole('spinbutton',{name:'Charge 1 amount Trip 46'}),{target:{value:'40'}});
 fireEvent.change(screen.getByRole('textbox',{name:'Posted invoice edit reason'}),{target:{value:'Correct agreed customer rate and composition'}});
 fireEvent.click(screen.getByRole('button',{name:'Save Posted Changes'}));
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_admin_edit_posted_invoice',{p_side:'customer',p_order_id:'order-1',p_line_ids:['trip-1','trip-2'],p_invoice_date:'2026-10-25',p_reason:'Correct agreed customer rate and composition',p_edits:{'trip-1':{base_amount:2500,charges:[{charge_master_id:'charge-1',amount:40}]}}}));
 expect(mock.saved).toHaveBeenCalled();expect(mock.rpc).not.toHaveBeenCalledWith('transport_edit_register_draft_invoice',expect.anything());
});
it('searches loaded Trips locally and retains unsaved edits after a rejected save',async()=>{
 mock.fail=true;show();await screen.findByRole('checkbox',{name:'Include Trip 48'});
 const count=()=>mock.rpc.mock.calls.filter(([name])=>name==='transport_bulk_rate_page').length;
 const calls=count();fireEvent.change(screen.getByRole('textbox',{name:'Search editable draft trips'}),{target:{value:'46'}});expect(count()).toBe(calls);
 fireEvent.change(screen.getByRole('spinbutton',{name:'Base rate Trip 46'}),{target:{value:'2500'}});
 fireEvent.change(screen.getByRole('textbox',{name:'Posted invoice edit reason'}),{target:{value:'Rejected correction must preserve local form'}});
 fireEvent.click(screen.getByRole('button',{name:'Save Posted Changes'}));
 expect((await screen.findByRole('alert')).textContent).toContain('Selected Trip is linked to another invoice');
 expect((screen.getByRole('spinbutton',{name:'Base rate Trip 46'}) as HTMLInputElement).value).toBe('2500');expect(mock.saved).not.toHaveBeenCalled();
});
