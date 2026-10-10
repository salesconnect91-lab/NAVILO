// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';

const state=vi.hoisted(()=>({type:'transport'}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({
 isPlatformOwner:true,
 activeCompany:{company_id:'company',membership_role:'admin'},
 activeBusinessUnit:{business_unit_id:'unit',business_unit_type:state.type,membership_role:'admin'}
})}));
vi.mock('./useTransportMasterClient',()=>{
 const query:any={};query.select=()=>query;query.order=()=>Promise.resolve({data:[],error:null});
 const client={from:()=>query};
 return {default:()=>client};
});
vi.mock('@/components/MasterSummaryStrip',()=>({default:()=>null}));
vi.mock('@/components/DataTable',()=>({default:()=> <div data-testid="customer-table">Customer master list</div>}));
vi.mock('@/components/ui',()=>({Modal:()=>null,ConfirmModal:()=>null,ErrorBanner:()=>null}));
vi.mock('@/modules/transport/TransportCustomerBillingModes',()=>({default:()=> <div data-testid="transport-billing-rules">Transport billing rules</div>}));
import Customers from './Customers';

beforeEach(()=>{state.type='transport';});
afterEach(()=>cleanup());
describe('Transport-only billing setup in Customer Master',()=>{
 it('opens Cash/Credit rules from the Import Center deep link and keeps master list separate',()=>{
  render(<MemoryRouter initialEntries={['/master-data/customers?tab=billing']}><Customers /></MemoryRouter>);
  expect(screen.getByTestId('transport-billing-rules')).toBeTruthy();
  expect(screen.queryByTestId('customer-table')).toBeNull();
  fireEvent.click(screen.getByRole('tab',{name:'Customers'}));
  expect(screen.getByTestId('customer-table')).toBeTruthy();
  expect(screen.queryByTestId('transport-billing-rules')).toBeNull();
 });
 it('does not display Transport Cash/Credit setup in Steel business units',()=>{
  state.type='steel';
  render(<MemoryRouter initialEntries={['/master-data/customers?tab=billing']}><Customers /></MemoryRouter>);
  expect(screen.queryByRole('tab',{name:'Cash/Credit Billing Rules'})).toBeNull();
  expect(screen.queryByTestId('transport-billing-rules')).toBeNull();
  expect(screen.getByTestId('customer-table')).toBeTruthy();
 });
});
