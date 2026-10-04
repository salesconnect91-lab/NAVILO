// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import ReturnNotes from './ReturnNotes';
const mock=vi.hoisted(()=>({rpc:vi.fn(),queries:[] as string[]}));
vi.mock('@/components/SearchableSelect',()=>({default:(p:any)=><select {...p}/>}));
vi.mock('@/lib/exportUtils',()=>({triggerPrint:vi.fn()}));
vi.mock('@/components/PrintLayout',()=>({default:(p:any)=><div data-testid="note-print">{JSON.stringify(p.items)}</div>}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
 mock.queries.push(table);const note={id:'n1',note_no:'CN-1',note_type:'sales_credit',note_date:'2026-10-04',party_name:'Customer',reason:'Rate decrease',subtotal:100,tax_total:18,total:118,sales_order_id:'s1',purchase_order_id:null};
 const data:any={sales_orders:[{id:'s1',order_no:'INV-1',order_date:'2026-10-01',document_kind:'service',total:118,customer:{name:'Customer'}}],return_notes:[note],return_note_lines:[],sales_order_lines:[],company_settings:{company_name:'Company'},transport_service_note_lines:[{net_amount:100,vat_amount:18}]};
 const q:any={};for(const name of ['select','eq','order','limit','in','maybeSingle'])q[name]=()=>q;q.then=(resolve:any)=>Promise.resolve({data:data[table]??[],error:null}).then(resolve);return q;
}}}));
afterEach(()=>{cleanup();mock.rpc.mockReset();mock.queries=[]});
it('routes service invoice corrections to Transport without requesting stock return quantities',async()=>{
 render(<ReturnNotes/>);await screen.findByText('INV-1 — Customer — 118.00');
 fireEvent.change(screen.getByLabelText('Original posted invoice'),{target:{value:'s1'}});
 await screen.findByText(/Service invoices have no stock return quantities/);expect(screen.queryByRole('button',{name:'Post Return Note'})).toBeNull();expect(mock.rpc).not.toHaveBeenCalled();
});
it('prints service credit-note net and VAT lines from canonical service evidence',async()=>{
 render(<ReturnNotes/>);await screen.findByText('CN-1');fireEvent.click(screen.getByRole('button',{name:'Print Note'}));
 const result=await screen.findByTestId('note-print');expect(result.textContent).toContain('Transport service');expect(result.textContent).toContain('"taxAmount":18');expect(result.textContent).toContain('"lineTotal":100');expect(mock.queries).toContain('transport_service_note_lines');
});
