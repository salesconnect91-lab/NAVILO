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
 render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/sales/new" element={<TransportInvoiceCreate side={side}/>}/><Route path="/purchase/new" element={<TransportInvoiceCreate side={side}/>}/><Route path="/transport" element={<div>Trips Register</div>}/></Routes></MemoryRouter>);
}

describe('Transport trip billing stays in the Trip Register',()=>{
 it('routes legacy customer trip-service invoice URLs to the Register',()=>{
  open('/sales/new?type=service');
  expect(screen.getByText('Trips Register')).toBeTruthy();
  expect(screen.queryByTestId('trip-service-form')).toBeNull();
  expect(screen.queryByTestId('normal-sale-form')).toBeNull();
 });
 it('keeps the normal Sale invoice separate from Trip billing',()=>{
  open('/sales/new?type=normal');
  expect(screen.queryByText('Sales Transport Service Invoice')).toBeNull();
  expect(document.querySelector('[data-navilo-transport-invoice-type="normal"]')).toBeTruthy();
  expect(screen.getByTestId('normal-sale-form')).toBeTruthy();
  expect(screen.queryByTestId('trip-service-form')).toBeNull();
 });
 it('routes the untyped legacy Sales URL to the Register instead of opening a second trip workflow',()=>{
  open('/sales/new');
  expect(screen.getByText('Trips Register')).toBeTruthy();
 });
 it('routes legacy supplier-trip invoice URLs to the Register',()=>{
  open('/purchase/new?type=service','supplier');
  expect(screen.getByText('Trips Register')).toBeTruthy();
  expect(screen.queryByTestId('supplier-rent-form')).toBeNull();
  expect(screen.queryByTestId('normal-sale-form')).toBeNull();
 });
 it('keeps normal Purchase invoices independently accessible',()=>{
  open('/purchase/new?type=normal','supplier');
  expect(screen.getByTestId('normal-sale-form')).toBeTruthy();
  expect(screen.queryByTestId('supplier-rent-form')).toBeNull();
 });
 it('keeps old dedicated supplier-rent bookmarks redirected to the Register',()=>{
  render(<MemoryRouter initialEntries={['/purchase/trip-service/new?type=normal']}><Routes><Route path="/purchase/trip-service/new" element={<TransportInvoiceCreate side="supplier" mode="service"/>}/><Route path="/transport" element={<div>Trips Register</div>}/></Routes></MemoryRouter>);
  expect(screen.getByText('Trips Register')).toBeTruthy();
  expect(screen.queryByTestId('supplier-rent-form')).toBeNull();
 });
 it('locks dedicated normal purchase route to non-trip invoice despite stale service query',()=>{
  render(<MemoryRouter initialEntries={['/purchase/normal/new?type=service']}><TransportInvoiceCreate side="supplier" mode="normal"/></MemoryRouter>);
  expect(screen.getByTestId('normal-sale-form')).toBeTruthy();
  expect(screen.queryByTestId('supplier-rent-form')).toBeNull();
 });

});
