// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import Suppliers from './Suppliers';
import Employees from './Employees';
const mock=vi.hoisted(()=>({businessType:'transport',driver:vi.fn()}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'c',enabled_modules:['transport'],membership_role:'company_owner'},activeBusinessUnit:{business_unit_id:'b',business_unit_type:mock.businessType,enabled_modules:['transport']},isPlatformOwner:true})}));
vi.mock('./TransportMaster',()=>({default:(props:any)=>{mock.driver(props);return <div>Scoped Driver Details</div>}}));
vi.mock('@/components/MasterSummaryStrip',()=>({default:()=>null}));
vi.mock('@/components/DataTable',()=>({default:({rows,columns}:any)=><div>{rows.map((r:any)=><div key={r.id}>{columns.map((c:any)=><span key={c.key}>{c.render?c.render(r):r[c.key]}</span>)}</div>)}</div>}));
const client={from:(table:string)=>({select:()=>({order:async()=>({data:table==='suppliers'?[{id:'s',name:'Supplier One',is_active:true}]:[{id:'e',name:'Employee One',is_active:true}],error:null})})})};
vi.mock('./useTransportMasterClient',()=>({default:()=>client}));
vi.mock('@/lib/supabase',()=>({supabase:{}}));
afterEach(cleanup);beforeEach(()=>{mock.businessType='transport';mock.driver.mockReset()});
describe('Driver management lives under its owner master',()=>{
 it('opens Supplier drivers with only the selected Supplier context',async()=>{
  render(<MemoryRouter><Suppliers/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Drivers'}));
  expect(screen.getByText('Scoped Driver Details')).toBeTruthy();expect(mock.driver).toHaveBeenLastCalledWith(expect.objectContaining({kind:'drivers',supplierOwner:{id:'s',name:'Supplier One'}}));
  fireEvent.click(screen.getByRole('button',{name:'Back to Suppliers'}));expect(screen.getByText('Supplier One')).toBeTruthy();
 });
 it('opens driving details for an existing Employee',async()=>{
  render(<MemoryRouter><Employees/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Driver Details'}));
  expect(mock.driver).toHaveBeenLastCalledWith(expect.objectContaining({kind:'drivers',employeeOwner:{id:'e',name:'Employee One'}}));
  fireEvent.click(screen.getByRole('button',{name:'Back to Employees'}));expect(screen.getByText('Employee One')).toBeTruthy();
 });
 it('keeps driver management out of Steel/general supplier and employee screens',async()=>{
  mock.businessType='steel';const view=render(<MemoryRouter><Suppliers/></MemoryRouter>);await screen.findByText('Supplier One');expect(screen.queryByRole('button',{name:'Drivers'})).toBeNull();view.unmount();
  render(<MemoryRouter><Employees/></MemoryRouter>);await screen.findByText('Employee One');expect(screen.queryByRole('button',{name:'Driver Details'})).toBeNull();expect(mock.driver).not.toHaveBeenCalled();
 });
});
