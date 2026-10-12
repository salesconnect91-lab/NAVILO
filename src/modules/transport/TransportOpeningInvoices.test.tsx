// @vitest-environment jsdom
import {describe,it,expect,vi,afterEach} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportOpeningInvoices from './TransportOpeningInvoices';
const mock=vi.hoisted(()=>({type:'transport',rpc:vi.fn()}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'company'},activeBusinessUnit:{business_unit_id:'unit',business_unit_type:mock.type},accessContext:{current_operating_location:{id:'branch'}}})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc}}));
vi.mock('./TransportPartyReports',()=>({default:({initialPartyId,initialSide}:{initialPartyId:string;initialSide:string})=><p>Payment review {initialSide} {initialPartyId}</p>}));
afterEach(()=>{cleanup();vi.clearAllMocks();mock.type='transport'});
const doc={order_id:'opening',party_id:'party',party_name:'Supplier',order_no:'SUP-100',order_date:'2026-10-12',trip_no:'101 / 102',original_gross:115,historical_settled:65,current_paid_gross:65,current_outstanding_gross:50,current_credit_gross:0};
describe('Imported invoices in invoice lists',()=>{
 it('uses complete search totals, pages by 100 and opens the selected party payment review',async()=>{
  mock.rpc.mockImplementation(async(_name:string,args:{p_kind:string;p_offset:number})=>({error:null,data:args.p_kind==='summary'?{count:15563,outstanding:490238.59,credit:4650}:Array.from({length:101},(_,i)=>({...doc,order_id:`opening-${args.p_offset+i}`}))}));
  render(<TransportOpeningInvoices side="supplier"/>);
  await screen.findByText('Payable: 490,238.59');expect(screen.getAllByText('Pay / review')).toHaveLength(100);
  expect(screen.queryByRole('link',{name:'SUP-100'})).toBeNull();expect(screen.getByText(/original issue dates were not supplied/i)).toBeTruthy();
  fireEvent.click(screen.getByText('Next 100'));await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_opening_invoice_query',expect.objectContaining({p_offset:100,p_limit:101})));
  await screen.findByText('101–200 / 15563');fireEvent.click(screen.getAllByText('Pay / review')[0]);
  await screen.findByText('Payment review supplier party');
 });
 it('keeps AMK non-transport invoice pages unchanged and surfaces a failed API',async()=>{
  mock.type='steel';const view=render(<TransportOpeningInvoices side="customer"/>);expect(mock.rpc).not.toHaveBeenCalled();expect(view.container.textContent).toBe('');view.unmount();
  mock.type='transport';mock.rpc.mockResolvedValue({data:null,error:{message:'Invoice service unavailable'}});render(<TransportOpeningInvoices side="customer"/>);
  expect((await screen.findByRole('alert')).textContent).toContain('Invoice service unavailable');expect(screen.queryByText(/Receivable:/)).toBeNull();
 });
});
