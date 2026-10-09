// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import TransportMaster from './TransportMaster';
const mock=vi.hoisted(()=>({rpc:vi.fn(),insert:vi.fn(),update:vi.fn(),vehicles:[] as any[],drivers:[] as any[],employees:[] as any[]}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'c',enabled_modules:['transport'],membership_role:'company_owner'},activeBusinessUnit:{business_unit_id:'b',business_unit_type:'transport',enabled_modules:['transport'],membership_role:'company_owner'},isPlatformOwner:false})}));
vi.mock('@/components/DataTable',()=>({default:({rows,columns}:any)=><div>{rows.map((r:any)=><div key={r.id}>{columns.map((c:any)=><span key={c.key}>{c.render(r)}</span>)}</div>)}</div>}));
vi.mock('@/components/MasterSummaryStrip',()=>({default:()=>null}));
vi.mock('@/components/MasterActionButton',()=>({default:()=>null}));
vi.mock('./useTransportMasterClient',()=>({default:()=>client}));
const client:any={rpc:mock.rpc,from:(table:string)=>{const q:any={select:()=>q,order:()=>q,eq:()=>q,is:()=>q,range:()=>Promise.resolve({data:table==='suppliers'?[{id:'s',name:'Owner',is_active:true}]:table==='transport_truck_types'?[{id:'tt',name:'Flatbed',is_active:true}]:table==='transport_vehicles'?mock.vehicles:table==='transport_drivers'?mock.drivers:table==='employees'?mock.employees:[],error:null}),single:()=>Promise.resolve({data:{id:'v'},error:null}),insert:(p:any)=>{mock.insert(table,p);return q},update:(p:any)=>{mock.update(table,p);return q}};return q}};
beforeEach(()=>{mock.vehicles=[];mock.drivers=[];mock.employees=[{id:"e",name:"Employee Driver",is_active:true}];mock.rpc.mockReset();mock.rpc.mockResolvedValue({data:'v',error:null});mock.insert.mockReset();mock.update.mockReset()});afterEach(cleanup);
function view(kind:'vehicles'|'drivers'){render(<MemoryRouter><TransportMaster kind={kind}/></MemoryRouter>)}
describe('Structured Transport master forms',()=>{
 it('creates a Vehicle with Truck Type, Supplier and explicit dated history atomically',async()=>{view('vehicles');await waitFor(()=>expect(screen.getByRole('button',{name:'Add Vehicle'})).toBeTruthy());fireEvent.click(screen.getByRole('button',{name:'Add Vehicle'}));await screen.findByRole('option',{name:'Flatbed'});fireEvent.change(screen.getByLabelText('Vehicle No / Plate No *'),{target:{value:'ABC-1'}});fireEvent.change(screen.getByLabelText('Truck Type'),{target:{value:'tt'}});fireEvent.change(screen.getByLabelText('Ownership Type'),{target:{value:'supplier'}});fireEvent.change(screen.getByLabelText('Supplier *'),{target:{value:'s'}});fireEvent.change(screen.getByLabelText('Ownership Effective From *'),{target:{value:'2026-10-01'}});fireEvent.click(screen.getByRole('button',{name:'Save'}));await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_create_vehicle_master',{p_vehicle_no:'ABC-1',p_truck_type_id:'tt',p_owner_type:'supplier',p_supplier_id:'s',p_effective_from:'2026-10-01'}));expect(mock.insert).not.toHaveBeenCalled()});
 it('manages a Supplier Driver under its Supplier without creating an Employee or a salary account',async()=>{
  render(<MemoryRouter><TransportMaster kind="drivers" supplierOwner={{id:"s",name:"Owner"}}/></MemoryRouter>);
  fireEvent.click(screen.getByRole('button',{name:'Add Driver'}));
  await screen.findByRole('option',{name:'Owner'});
  expect(screen.queryByLabelText('Employee *')).toBeNull();
  expect(screen.queryByLabelText('Driver Type')).toBeNull();
  fireEvent.change(screen.getByLabelText('Driver Name *'),{target:{value:'Driver One'}});
  fireEvent.change(screen.getByLabelText('Driving Licence No'),{target:{value:'LIC-1'}});
  fireEvent.click(screen.getByRole('button',{name:'Save'}));
  await waitFor(()=>expect(mock.insert).toHaveBeenCalledWith('transport_drivers',expect.objectContaining({driver_name:'Driver One',driver_type:'supplier',supplier_id:'s',employee_id:null,driving_licence_no:'LIC-1'})));
  expect(mock.insert).toHaveBeenCalledTimes(1);expect(mock.rpc).not.toHaveBeenCalled();
 });
 it('shows only company drivers in the Drivers master',async()=>{
  mock.drivers=[{id:"dc",driver_name:"Company Driver",driver_type:"company",employee_id:"e",supplier_id:null,is_active:true},{id:"ds",driver_name:"Supplier Driver",driver_type:"supplier",employee_id:null,supplier_id:"s",is_active:true}];
  view('drivers');
  await screen.findByText('Employee Driver');
  expect(screen.queryByText('Supplier Driver')).toBeNull();
  expect(screen.getByRole('link',{name:'Manage Supplier Drivers'}).getAttribute('href')).toBe('/master-data/suppliers');
 });
 it('shows only drivers of the selected Supplier',async()=>{
  mock.drivers=[{id:"ds",driver_name:"Own Driver",driver_type:"supplier",employee_id:null,supplier_id:"s",is_active:true},{id:"other",driver_name:"Other Driver",driver_type:"supplier",employee_id:null,supplier_id:"s2",is_active:true},{id:"dc",driver_name:"Company Driver",driver_type:"company",employee_id:"e",supplier_id:null,is_active:true}];
  render(<MemoryRouter><TransportMaster kind="drivers" supplierOwner={{id:"s",name:"Owner"}}/></MemoryRouter>);
  await screen.findByText('Own Driver');expect(screen.queryByText('Other Driver')).toBeNull();expect(screen.queryByText('Company Driver')).toBeNull();
 });
 it('adds driving details to an existing Employee without creating another Employee',async()=>{
  render(<MemoryRouter><TransportMaster kind="drivers" employeeOwner={{id:"e",name:"Employee Driver"}}/></MemoryRouter>);
  fireEvent.click(screen.getByRole('button',{name:'Add Driver'}));await screen.findByRole('option',{name:'Employee Driver'});
  expect((screen.getByLabelText('Employee *') as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByLabelText('Driver Name *') as HTMLInputElement).readOnly).toBe(true);
  expect(screen.queryByLabelText('Supplier *')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Save'}));
  await waitFor(()=>expect(mock.insert).toHaveBeenCalledWith('transport_drivers',expect.objectContaining({driver_name:'Employee Driver',driver_type:'company',employee_id:'e',supplier_id:null})));
  expect(mock.insert).toHaveBeenCalledTimes(1);expect(mock.rpc).not.toHaveBeenCalled();
 });
 it('uses the existing linked Driver record instead of allowing another for the same Employee',async()=>{
  mock.drivers=[{id:"dc",driver_name:"Old Name",driver_type:"company",employee_id:"e",supplier_id:null,is_active:true}];
  render(<MemoryRouter><TransportMaster kind="drivers" employeeOwner={{id:"e",name:"Employee Driver"}}/></MemoryRouter>);
  await screen.findByText('Employee Driver');expect(screen.queryByRole('button',{name:'Add Driver'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/Edit/}));await screen.findByRole('option',{name:'Employee Driver'});fireEvent.click(screen.getByRole('button',{name:'Save'}));
  await waitFor(()=>expect(mock.update).toHaveBeenCalledWith('transport_drivers',expect.objectContaining({employee_id:'e',driver_type:'company',supplier_id:null})));
  expect(mock.insert).not.toHaveBeenCalled();
 });
 it('keeps current owner out of direct Vehicle edits',async()=>{mock.vehicles=[{id:'v',vehicle_no:'ABC',truck_type_id:'tt',ownership_type:'supplier',supplier_id:'s',owner_name:'Owner',is_active:true}];view('vehicles');await screen.findByRole('button',{name:/Edit/});fireEvent.click(screen.getByRole('button',{name:/Edit/}));expect(screen.queryByLabelText('Ownership Type')).toBeNull();expect(screen.getByRole('link',{name:'Change through Vehicle Ownership History'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Save'}));await waitFor(()=>expect(mock.update).toHaveBeenCalledWith('transport_vehicles',{vehicle_no:'ABC',truck_type_id:'tt'}));});
});
