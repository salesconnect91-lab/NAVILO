// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportWorkspace from './TransportWorkspace';
import * as XLSX from 'xlsx';
const mock=vi.hoisted(()=>({rpc:vi.fn(),tables:{} as Record<string,any[]>,allow:true}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'c',enabled_modules:['transport']},activeBusinessUnit:{business_unit_id:'b',business_unit_type:'transport',enabled_modules:['transport']}})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,
 insert:(values:any)=>{const row={...values,id:'added'};(mock.tables[table]??=[]).push(row);return {select:()=>({single:async()=>({data:row,error:null})})};},range:()=>Promise.resolve({data:mock.tables[table]??[],error:null}),then:(resolve:any)=>Promise.resolve({data:mock.tables[table]??[],error:null}).then(resolve)};return q;}}}));
vi.mock('./TransportFinancialPanel',()=>({default:()=>null}));vi.mock('./TransportInitialRate',()=>({default:()=>null}));
vi.mock('./TransportCostUpload',()=>({default:()=>null}));vi.mock('./TransportAudit',()=>({default:()=>null}));
vi.mock('./TransportPartyReports',()=>({default:()=>null}));vi.mock('./TransportAccountStatement',()=>({default:()=>null}));
beforeEach(()=>{
 mock.allow=true;mock.rpc.mockReset();mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_create_trips'?[{id:'trip',trip_no:'OIC-1'}]:mock.allow,error:null}));
 mock.tables={customers:[{id:'c1',name:'Customer',is_active:true}],suppliers:[{id:'s',name:'Supplier',is_active:true}],employees:[{id:'e',name:'Employee',is_active:true}],
 transport_truck_types:[{id:'tt',name:'Flatbed',is_active:true},{id:'tt2',name:'Tanker',is_active:true}],
 transport_locations:[{id:'f',name:'From',is_active:true},{id:'t',name:'To',is_active:true}],
 transport_drivers:[{id:'d',driver_name:'Driver',mobile:'12345',is_active:true},{id:'inactive',driver_name:'Inactive Driver',is_active:false}],
 transport_vehicles:[{id:'v',vehicle_no:'FLAT-1',truck_type_id:'tt',is_active:true},{id:'v2',vehicle_no:'TANK-1',truck_type_id:'tt2',is_active:true}],
 transport_vehicle_ownership:[{id:'old',vehicle_id:'v',owner_type:'third_party',supplier_id:'s',owner_name_snapshot:'Supplier',effective_from:'2020-01-01',effective_to:'2026-06-30'},
 {id:'current',vehicle_id:'v',owner_type:'company',supplier_id:null,owner_name_snapshot:'Company',effective_from:'2026-07-01',effective_to:null}]};
});afterEach(cleanup);
async function view(){render(<TransportWorkspace/>);fireEvent.click(screen.getByRole('button',{name:'New Trip'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Add Truck Type'})).toBeTruthy());await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_finance_allowed',{p_action:'driver'}));}
function choose(placeholder:string,name:string){fireEvent.focus(screen.getByPlaceholderText(placeholder));fireEvent.mouseDown(screen.getByRole('button',{name}));}
async function fill(){await view();choose('Search Customer','Customer');choose('Search From','From');choose('Search To','To');fireEvent.change(screen.getByLabelText('Sale Type'),{target:{value:'credit'}});}
describe('New Trip master integration',()=>{
 it('restricts Plate choices to active compatible Truck Type and clears incompatible selection',async()=>{
  await view();choose('Search Truck Type','Flatbed');fireEvent.focus(screen.getByPlaceholderText('Search Plate'));
  expect(screen.queryByRole('button',{name:'TANK-1'})).toBeNull();fireEvent.mouseDown(screen.getByRole('button',{name:'FLAT-1 - Company'}));
  choose('Search Truck Type','Tanker');expect((screen.getByPlaceholderText('Search Plate') as HTMLInputElement).value).toBe('');expect((screen.getByLabelText('Trip Owner / Supplier') as HTMLInputElement).value).toBe('');
 });
 it('displays historical Supplier then Company by Trip Date, read-only',async()=>{
  await view();choose('Search Truck Type','Flatbed');choose('Search Plate','FLAT-1 - Company');
  fireEvent.change(screen.getByLabelText('Trip Date'),{target:{value:'2026-06-01'}});expect((screen.getByLabelText('Trip Owner / Supplier') as HTMLInputElement).value).toBe('Supplier');
  expect((screen.getByLabelText('Trip Owner / Supplier') as HTMLInputElement).readOnly).toBe(true);
  fireEvent.change(screen.getByLabelText('Trip Date'),{target:{value:'2026-07-01'}});expect((screen.getByLabelText('Trip Owner / Supplier') as HTMLInputElement).value).toBe('Company');
 });
 it('auto-displays Driver Mobile and excludes inactive Drivers',async()=>{
  await view();fireEvent.focus(screen.getByPlaceholderText('Search Driver'));expect(screen.queryByRole('button',{name:'Inactive Driver'})).toBeNull();
  fireEvent.mouseDown(screen.getByRole('button',{name:'Driver'}));expect((screen.getByLabelText('Driver Mobile') as HTMLInputElement).value).toBe('12345');expect((screen.getByLabelText('Driver Mobile') as HTMLInputElement).readOnly).toBe(true);
 });
 it('disables PPR details while Pending and requires employee/date while Received',async()=>{
  await fill();expect((screen.getByLabelText('PPR Receiving Employee') as HTMLSelectElement).disabled).toBe(true);expect((screen.getByLabelText('PPR Date') as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('PPR Status'),{target:{value:'received'}});fireEvent.click(screen.getByRole('button',{name:'Create Trip'}));
  expect(screen.getByText('PPR Received requires Employee and Date.')).toBeTruthy();expect(mock.rpc.mock.calls.filter(c=>c[0]==='transport_create_trips')).toHaveLength(0);
 });
 it('requires Cash/Credit and keeps calculated margin read-only',async()=>{
  await view();fireEvent.click(screen.getByRole('button',{name:'Create Trip'}));expect(screen.getByText('Customer, Trip Date and Sale Type Cash or Credit are required.')).toBeTruthy();
  expect((screen.getByLabelText('Estimated Operational Margin') as HTMLInputElement).readOnly).toBe(true);
 });
 it('saves Pending PPR through canonical entry RPC with scope and no caller owner snapshot',async()=>{
  await fill();fireEvent.click(screen.getByRole('button',{name:'Create Trip'}));await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_create_trips',expect.objectContaining({p_company_id:'c',p_business_unit_id:'b',p_rows:[expect.objectContaining({from_location_id:'f',to_location_id:'t',sale_type:'credit',ppr_status:'pending',ppr_received_by_employee_id:null})]})));
  const payload=mock.rpc.mock.calls.find(c=>c[0]==='transport_create_trips')![1].p_rows[0];expect(payload).not.toHaveProperty('owner_name_snapshot');expect(payload).not.toHaveProperty('trip_no');
 });
 it('blocks double-submit and retries the same request after a lost response',async()=>{
  await fill();let finish:any;mock.rpc.mockImplementation((name:string)=>name==='transport_create_trips'?new Promise(r=>{finish=r}):Promise.resolve({data:true,error:null}));
  const button=screen.getByRole('button',{name:'Create Trip'});fireEvent.click(button);fireEvent.click(button);expect(mock.rpc.mock.calls.filter(c=>c[0]==='transport_create_trips')).toHaveLength(1);
  const first=mock.rpc.mock.calls.find(c=>c[0]==='transport_create_trips')![1].p_request_id;finish({data:null,error:{message:'Lost response'}});await screen.findByText('Lost response');
  mock.rpc.mockResolvedValue({data:[{id:'trip'}],error:null});fireEvent.click(screen.getByRole('button',{name:'Create Trip'}));await waitFor(()=>expect(mock.rpc.mock.calls.filter(c=>c[0]==='transport_create_trips')).toHaveLength(2));
  expect(mock.rpc.mock.calls.filter(c=>c[0]==='transport_create_trips')[1][1].p_request_id).toBe(first);
 });
 it.each([
  ['Add Truck Type','truckType','Search Truck Type','transport_truck_types'],
  ['Add Customer','customer','Search Customer','customers'],
  ['Add Driver Name','driver','Search Driver','transport_drivers'],
  ['Add From','locationFrom','Search From','transport_locations'],
  ['Add To','locationTo','Search To','transport_locations'],
 ] as const)('refreshes and auto-selects %s',async(button,kind,placeholder,table)=>{
  await view();mock.rpc.mockImplementation(async(name:string)=>{
   if(name==='create_customer_with_ar'){const row={id:'added',name:'Added',is_active:true};mock.tables[table].push(row);return {data:row,error:null};}
   return {data:true,error:null};
  });
  fireEvent.click(screen.getByRole('button',{name:button}));fireEvent.change(screen.getByLabelText(kind==='driver'?'Driver Name':'Name'),{target:{value:'Added'}});
  fireEvent.submit(screen.getByRole('dialog'));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  expect((screen.getByPlaceholderText(placeholder) as HTMLInputElement).value).toBe('Added');
 });
 it('selects created Supplier without changing the selected Vehicle owner',async()=>{
  await view();choose('Search Truck Type','Flatbed');choose('Search Plate','FLAT-1 - Company');
  mock.rpc.mockImplementation(async(name:string)=>{if(name==='create_supplier_with_ap'){const row={id:'added',name:'New Supplier',is_active:true};mock.tables.suppliers.push(row);return {data:row,error:null};}return {data:true,error:null};});
  fireEvent.click(screen.getByRole('button',{name:'Add Owner / Supplier'}));fireEvent.change(screen.getByLabelText('Name'),{target:{value:'New Supplier'}});fireEvent.submit(screen.getByRole('dialog'));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(screen.getByText(/Supplier selected: New Supplier/)).toBeTruthy();expect((screen.getByLabelText('Trip Owner / Supplier') as HTMLInputElement).value).toBe('Company');
 });
 it('refreshes and selects atomic new Vehicle and dated ownership',async()=>{
  await view();choose('Search Truck Type','Flatbed');mock.rpc.mockImplementation(async(name:string)=>{
   if(name==='transport_create_vehicle_master'){mock.tables.transport_vehicles.push({id:'added',vehicle_no:'NEW-V',truck_type_id:'tt',is_active:true});mock.tables.transport_vehicle_ownership.push({id:'new-own',vehicle_id:'added',owner_type:'company',owner_name_snapshot:'Company',effective_from:'2020-01-01',effective_to:null});return {data:'added',error:null};}
   return {data:true,error:null};});
  fireEvent.click(screen.getByRole('button',{name:'Add Plate #'}));fireEvent.change(screen.getByLabelText('Plate / Vehicle No'),{target:{value:'NEW-V'}});fireEvent.change(screen.getByLabelText('Ownership Effective From'),{target:{value:'2020-01-01'}});fireEvent.submit(screen.getByRole('dialog'));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect((screen.getByPlaceholderText('Search Plate') as HTMLInputElement).value).toBe('NEW-V - Company');
 });
 async function upload(sale='Credit',owner='Supplier'){
  await view();fireEvent.click(screen.getByRole('button',{name:'Bulk Upload'}));
  const headers=['DATE','TRUCK TYPE','COMPANY NAME','DRIVER NAME','OWNER','PLATE #','FROM','TO','PAPER RECEIVED BY','DATE','Customer Rate','Supplier Rent','Driver Pay','Sale Type (Cash / Credit)'];
  const row=['2026-06-01','Flatbed','Customer','Driver',owner,'FLAT-1','From','To','PPR PENDING','','1000','300','50',sale];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([headers,row]),'Trips');
  const bytes=XLSX.write(wb,{bookType:'xlsx',type:'array'});const file=new File([bytes],'trip.xlsx');Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes});
  fireEvent.change(screen.getByLabelText(/Select BuKu Excel/),{target:{files:[file]}});await screen.findByText('trip.xlsx');
 }
 it('rejects bulk invalid Cash/Credit and free-text Owner mismatch',async()=>{
  await upload('Other','Fake Owner');expect(screen.getByRole('button',{name:/Import Valid Rows/}).hasAttribute('disabled')).toBe(true);
  expect(screen.getByTitle(/Sale Type/).getAttribute('title')).toContain('Sale Type');expect(screen.getByTitle(/Sale Type/).getAttribute('title')).toContain('dated ownership');
 });
 it('imports bulk through the same atomic entry RPC with separate rent/pay and no owner text',async()=>{
  vi.spyOn(window,'confirm').mockReturnValue(true);vi.spyOn(window,'alert').mockImplementation(()=>{});await upload();
  fireEvent.click(screen.getByRole('button',{name:/Import Valid Rows/}));await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_create_trips',expect.objectContaining({p_rows:[expect.objectContaining({vehicle_id:'v',supplier_rent:300,driver_pay:50,sale_type:'credit'})]})));
  expect(mock.rpc.mock.calls.find(c=>c[0]==='transport_create_trips')![1].p_rows[0]).not.toHaveProperty('owner_name_snapshot');
 });

});
