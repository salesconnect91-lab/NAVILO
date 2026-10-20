// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import Purchase from './Purchase';
const mock=vi.hoisted(()=>({type:'transport'}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeBusinessUnit:{business_unit_type:mock.type}})}));
vi.mock('./PurchaseOrderList',()=>({default:()=> <div>Purchase index</div>}));
vi.mock('./MainPurchaseInvoiceV2',()=>({default:()=> <div>Inventory Purchase Invoice</div>}));
vi.mock('@/modules/transport/TransportInvoiceCreate',()=>({default:({side,mode}:{side:string;mode?:string})=><div>Transport {side} {mode??'legacy'} Invoice</div>}));
vi.mock('./GeneralExpenseBillCreate',()=>({default:()=> <div>Expense Invoice Create</div>}));
vi.mock('./GeneralExpenseBillImport',()=>({default:()=> <div>Expense Invoice Import</div>}));
vi.mock('./PurchaseInvoiceDetail',()=>({default:()=> <div>Purchase Detail</div>}));
vi.mock('./ConsolidatedPurchaseInvoices',()=>({default:()=> <div>Consolidated Invoice</div>}));
vi.mock('./OrderBook',()=>({default:()=> <div>Order Book</div>}));
vi.mock('@/modules/orders/OrderBook',()=>({default:()=> <div>Order Book</div>}));
vi.mock('@/modules/commercial/PreInvoiceWorkspace',()=>({default:()=> <div>Purchase Workflow</div>}));
vi.mock('@/components/ConsolidatedInvoiceGuard',()=>({default:({children}:{children:React.ReactNode})=><>{children}</>}));
afterEach(cleanup);
function open(path:string){
 return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/purchase/*" element={<Purchase/>}/></Routes></MemoryRouter>);
}
describe('Purchase section nested navigation',()=>{
 it('opens Purchase List on /purchase',()=>{open('/purchase');expect(screen.getByText('Purchase index')).toBeTruthy()});
 it('uses distinct direct routes for service rent and non-trip supplier invoices',()=>{
  mock.type='transport';
  const service=open('/purchase/trip-service/new');
  expect(screen.getByText('Transport supplier service Invoice')).toBeTruthy();
  service.unmount();
  open('/purchase/normal/new');
  expect(screen.getByText('Transport supplier normal Invoice')).toBeTruthy();
 });
 it('keeps legacy query-based purchase bookmarks functional',()=>{
  mock.type='transport';
  open('/purchase/new?type=service');
  expect(screen.getByText('Transport supplier legacy Invoice')).toBeTruthy();
 });
 it('keeps Inventory Purchase Invoice for non-transport companies',()=>{
  mock.type='steel';open('/purchase/new');expect(screen.getByText('Inventory Purchase Invoice')).toBeTruthy();mock.type='transport';
 });
 it('opens Expense create and import as separate screens',()=>{
  const first=open('/purchase/expense/new');
  expect(screen.getByText('Expense Invoice Create')).toBeTruthy();
  first.unmount();open('/purchase/expense/import');
  expect(screen.getByText('Expense Invoice Import')).toBeTruthy();
 });
 it('opens real Purchase document route',()=>{
  open('/purchase/11111111-1111-1111-1111-111111111111');
  expect(screen.getByText('Purchase Detail')).toBeTruthy();
 });
});
