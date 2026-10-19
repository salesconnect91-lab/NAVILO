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
  expect(screen.queryByText('Sales Transport Service Invoice')).toBeNull();
  expect(document.querySelector('[data-navilo-transport-invoice-type="normal"]')).toBeTruthy();
  expect(screen.getByTestId('normal-sale-form')).toBeTruthy();
  expect(screen.queryByTestId('trip-service-form')).toBeNull();
 });
 it('keeps the legacy /sales/new address pointing to the Trip Service invoice',()=>{
  open('/sales/new');
  expect(screen.getByTestId('trip-service-form')).toBeTruthy();
 });
 it('opens the same trip-wise supplier-rent popup workflow as Sales, not the normal non-trip purchase form',()=>{
  open('/purchase/new?type=service','supplier');
  expect(screen.getByText('Purchase Transport Service Invoice')).toBeTruthy();
  expect(screen.getByTestId('supplier-rent-form')).toBeTruthy();
  expect(screen.queryByTestId('normal-sale-form')).toBeNull();
  expect(document.querySelector('[data-navilo-transport-invoice-type="service"]')).toBeTruthy();
 });
 it('keeps normal Purchase invoices independently accessible',()=>{
  open('/purchase/new?type=normal','supplier');
  expect(screen.getByTestId('normal-sale-form')).toBeTruthy();
  expect(screen.queryByTestId('supplier-rent-form')).toBeNull();
 });
});
