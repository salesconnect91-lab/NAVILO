// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportRegisterLinkedInvoice from './TransportRegisterLinkedInvoice';
const mock=vi.hoisted(()=>({rpc:vi.fn(),exists:true,fail:false,status:'draft',editor:vi.fn(),controls:vi.fn()}));
vi.mock('./TransportDialog',()=>({default:({children}:any)=><div>{children}</div>}));
vi.mock('./TransportInvoiceNumber',()=>({default:()=> <div>New customer invoice form</div>}));
vi.mock('./TransportBulkSupplierRent',()=>({default:()=> <div>New supplier invoice form</div>}));
vi.mock('./TransportRegisterDraftInvoiceEditor',()=>({default:(props:any)=>{mock.editor(props);return <div>Edit original draft</div>}}));
vi.mock('./TransportPostedInvoiceControls',()=>({default:(props:any)=>{mock.controls(props);return <div>Scoped Admin controls</div>}}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
 const q:any={select:()=>q,eq:()=>q,in:()=>q,then:(resolve:any)=>Promise.resolve({data:table.endsWith('_document_trips')||table.endsWith('_document_rents')?(mock.exists?[{document_id:'doc-1'}]:[]):table==='transport_customer_documents'?[{id:'doc-1',sales_order_id:'order-1'}]:table==='transport_supplier_documents'?[{id:'doc-1',purchase_order_id:'order-1'}]:[{id:'order-1',order_no:'ORIGINAL-1',order_date:'2026-10-25',status:mock.status,total:2760}],error:mock.fail?{message:'Invoice read denied'}:null}).then(resolve)};return q;
}}}));
beforeEach(()=>{mock.exists=true;mock.fail=false;mock.status='draft';mock.editor.mockClear();mock.controls.mockClear();mock.rpc.mockReset();mock.rpc.mockResolvedValue({data:true,error:null})});
afterEach(cleanup);
const show=(side:'customer'|'supplier'='customer')=>render(<TransportRegisterLinkedInvoice side={side} trip={{id:'trip-1',trip_no:'46'} as any} onClose={vi.fn()} onChanged={async()=>{}}/>);
it('opens the existing customer draft instead of offering duplicate creation',async()=>{
 show();await screen.findByText('ORIGINAL-1');expect(screen.queryByText('New customer invoice form')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Edit Draft'}));expect(await screen.findByText('Edit original draft')).toBeTruthy();
 expect(mock.editor.mock.calls[0][0].row).toMatchObject({document_id:'doc-1',order_id:'order-1',invoice_no:'ORIGINAL-1'});
 fireEvent.click(screen.getByRole('button',{name:'Post Invoice'}));await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_post_customer_draft',{p_document_id:'doc-1'}));
});
it('opens supplier posted controls on the original purchase invoice from the Register',async()=>{
 mock.status='posted';show('supplier');expect(await screen.findByText('Scoped Admin controls')).toBeTruthy();
 expect(mock.controls.mock.calls[0][0]).toMatchObject({side:'supplier',order:{id:'order-1',order_no:'ORIGINAL-1'}});
 expect(screen.getByRole('link',{name:'Review Invoice'}).getAttribute('href')).toBe('/purchase/order-1');expect(screen.queryByText('New supplier invoice form')).toBeNull();
});
it('uses the existing creation form only for a verified unlinked Trip',async()=>{
 mock.exists=false;show();expect(await screen.findByText('New customer invoice form')).toBeTruthy();
});
it('fails closed on an invoice read error rather than creating a duplicate',async()=>{
 mock.fail=true;show();expect((await screen.findByRole('alert')).textContent).toContain('Invoice read denied');expect(screen.queryByText('New customer invoice form')).toBeNull();
});
