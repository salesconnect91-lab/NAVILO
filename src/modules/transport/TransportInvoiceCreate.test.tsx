// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import TransportInvoiceCreate from './TransportInvoiceCreate';

vi.mock('./TransportBulkCustomerRate',()=>({default:()=> <div data-testid="trip-service-form">Original grouped Trip Service Invoice form</div>}));
vi.mock('./TransportBulkSupplierRent',()=>({default:()=> <div data-testid="supplier-rent-form">Grouped Trip supplier rents</div>}));
vi.mock('./TransportNormalInvoiceCreate',()=>({default:()=> <div data-testid="normal-sale-form">Description-only Normal Sale</div>}));
afterEach(cleanup);

function open(path:string,side:'customer'|'supplier'='customer'){
 render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/sales/new" element={<TransportInvoiceCreate side={side}/>}/><Route path="/purchase/new" element={<TransportInvoiceCreate side={side}/>}/></Routes></MemoryRouter>);
}

describe('Separate Transport invoice formats',()=>{
 it('preserves the original grouped Trip Service Invoice at its dedicated route',()=>{
  open('/sales/new?type=service');
  expect(screen.getByText('Sales Transport Service Invoice')).toBeTruthy();
  expect(screen.getByTestId('trip-service-form')).toBeTruthy();
  expect(screen.queryByTestId('normal-sale-form')).toBeNull();
 });
 it('keeps the normal Sale invoice separate from Trip billing',()=>{
  open('/sales/new?type=normal');
  expect(screen.getByText('Sale Invoice')).toBeTruthy();
  expect(screen.getByTestId('normal-sale-form')).toBeTruthy();
  expect(screen.queryByTestId('trip-service-form')).toBeNull();
 });
 it('keeps the legacy /sales/new address pointing to the Trip Service invoice',()=>{
  open('/sales/new');
  expect(screen.getByTestId('trip-service-form')).toBeTruthy();
 });
 it('does not replace supplier Trip rent workflow with normal purchase',()=>{
  open('/purchase/new?type=service','supplier');
  expect(screen.getByTestId('supplier-rent-form')).toBeTruthy();
 });
});
