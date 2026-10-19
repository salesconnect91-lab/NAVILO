// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import PurchaseInvoiceDetail from './PurchaseInvoiceDetail';

const mock=vi.hoisted(()=>({calls:[] as string[],kind:'service' as string|null,error:null as string|null}));
vi.mock('@/lib/supabase',()=>({supabase:{
 from:(table:string)=>{
  mock.calls.push(table);
  const query:any={select:()=>query,eq:()=>query,maybeSingle:async()=>({
   data:mock.error?null:{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',document_kind:mock.kind},
   error:mock.error?{message:mock.error}:null
  })};
  return query;
 }
}}));
vi.mock('@/modules/transport/TransportServiceDocument',()=>({default:({side,id}:{side:string;id:string})=>
 <div data-testid="supplier-service-document">{side}:{id}</div>}));
afterEach(()=>{cleanup();mock.calls=[];mock.kind='service';mock.error=null;});

function visit(){
 return render(<MemoryRouter initialEntries={['/purchase/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']}>
  <Routes><Route path="/purchase/:id" element={<PurchaseInvoiceDetail/>}/></Routes>
 </MemoryRouter>);
}
describe('Purchase invoice details route',()=>{
 it('opens supplier service invoices without loading inventory, godowns or consolidated invoice dependencies',async()=>{
  visit();
  expect((await screen.findByTestId('supplier-service-document')).textContent)
   .toBe('supplier:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  expect(mock.calls).toEqual(['purchase_orders']);
 });
 it('shows read failure and back link instead of silently losing invoice navigation',async()=>{
  mock.error='Purchase invoice access denied';
  visit();
  await waitFor(()=>expect(screen.getByText('Purchase invoice access denied')).toBeTruthy());
  expect(screen.getByRole('link',{name:'Back to Purchase Invoices'}).getAttribute('href')).toBe('/purchase');
  expect(mock.calls).toEqual(['purchase_orders']);
 });
});
