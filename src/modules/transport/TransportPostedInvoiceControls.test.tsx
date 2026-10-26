// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import TransportPostedInvoiceControls from './TransportPostedInvoiceControls';
const mock=vi.hoisted(()=>({allowed:true,rpc:vi.fn(),editor:vi.fn()}));
vi.mock('./TransportDialog',()=>({default:({children}:any)=><div>{children}</div>}));
vi.mock('./TransportRegisterDraftInvoiceEditor',()=>({default:(props:any)=>{mock.editor(props);return <div>Shared posted invoice editor</div>}}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:'doc-1'},error:null})};return q}}}));
beforeEach(()=>{mock.allowed=true;mock.rpc.mockReset();mock.editor.mockClear();mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_posted_invoice_admin_access'?mock.allowed:{deleted:true},error:null}));});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
const show=()=>render(<MemoryRouter><TransportPostedInvoiceControls side="supplier" order={{id:'order-1',order_no:'SUP-ORIGINAL',order_date:'2026-10-25'}} onSaved={vi.fn()}/></MemoryRouter>);
it('uses the same invoice editor in posted mode and retains invoice identity',async()=>{
 show();fireEvent.click(await screen.findByRole('button',{name:'Edit Posted Invoice'}));
 expect(await screen.findByText('Shared posted invoice editor')).toBeTruthy();
 expect(mock.editor.mock.calls[0][0]).toMatchObject({mode:'posted',row:{side:'supplier',document_id:'doc-1',order_id:'order-1',invoice_no:'SUP-ORIGINAL'}});
});
it('does not show posted edit or deletion to an owner/non-admin',async()=>{
 mock.allowed=false;show();await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_posted_invoice_admin_access'));
 expect(screen.queryByRole('button',{name:'Edit Posted Invoice'})).toBeNull();expect(screen.queryByRole('button',{name:'Delete Posted Invoice'})).toBeNull();
});
it('requires a reason and final confirmation before the permanent-delete RPC',async()=>{
 const confirm=vi.fn(()=>false);vi.stubGlobal('confirm',confirm);show();
 fireEvent.click(await screen.findByRole('button',{name:'Delete Posted Invoice'}));
 const remove=screen.getByRole('button',{name:'Permanently Delete'});expect((screen.getByRole('textbox',{name:'Posted invoice permanent deletion reason'}) as HTMLInputElement).value).toBe('Invoice removed');expect(mock.rpc).not.toHaveBeenCalledWith('transport_admin_delete_posted_invoice',expect.anything());
 fireEvent.change(screen.getByRole('textbox',{name:'Posted invoice permanent deletion reason'}),{target:{value:'Duplicate synthetic invoice correction'}});
 fireEvent.click(remove);expect(confirm).toHaveBeenCalled();expect(mock.rpc).not.toHaveBeenCalledWith('transport_admin_delete_posted_invoice',expect.anything());
 confirm.mockReturnValue(true);fireEvent.click(remove);
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_admin_delete_posted_invoice',{p_side:'supplier',p_order_id:'order-1',p_reason:'Duplicate synthetic invoice correction'}));
});
