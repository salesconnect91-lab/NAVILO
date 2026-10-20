// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import TransportInvoiceCreate from './TransportInvoiceCreate';

vi.mock('./TransportBulkSupplierRent',()=>({default:()=> <div>Trip-linked supplier rent entry</div>}));
vi.mock('./TransportBulkCustomerRate',()=>({default:()=> <div>Trip-linked customer entry</div>}));
vi.mock('./TransportNormalInvoiceCreate',()=>({default:({side}:{side:string})=> <div>Non-trip normal {side} invoice entry</div>}));
afterEach(cleanup);

describe('Explicit Transport Purchase editor routing',()=>{
 it('opens Trip Rent on the dedicated service route, even if stale query says normal',()=>{
  render(<MemoryRouter initialEntries={['/purchase/trip-service/new?type=normal']}><TransportInvoiceCreate side="supplier" mode="service"/></MemoryRouter>);
  expect(screen.getByText('Trip-linked supplier rent entry')).toBeTruthy();
  expect(screen.getByText('Purchase Transport Service Invoice')).toBeTruthy();
  expect(screen.queryByText('Non-trip normal supplier invoice entry')).toBeNull();
 });
 it('opens Normal Purchase on its dedicated route, even if stale query says service',()=>{
  render(<MemoryRouter initialEntries={['/purchase/normal/new?type=service']}><TransportInvoiceCreate side="supplier" mode="normal"/></MemoryRouter>);
  expect(screen.getByText('Non-trip normal supplier invoice entry')).toBeTruthy();
  expect(screen.queryByText('Trip-linked supplier rent entry')).toBeNull();
 });
 it('preserves legacy normal and service query links',()=>{
  const a=render(<MemoryRouter initialEntries={['/purchase/new?type=normal']}><TransportInvoiceCreate side="supplier"/></MemoryRouter>);
  expect(screen.getByText('Non-trip normal supplier invoice entry')).toBeTruthy();
  a.unmount();
  render(<MemoryRouter initialEntries={['/purchase/new?type=service']}><TransportInvoiceCreate side="supplier"/></MemoryRouter>);
  expect(screen.getByText('Trip-linked supplier rent entry')).toBeTruthy();
 });
});
