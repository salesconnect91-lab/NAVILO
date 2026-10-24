// @vitest-environment jsdom
import {StrictMode} from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportWorkspace from './TransportWorkspace';
import {clearRegisterSessionCache} from './transportRegisterCache';
import UniversalDataTools from '@/components/UniversalDataTools';
import GlobalLanguageRuntime from '@/components/GlobalLanguageRuntime';
import LanguageRuntime from '@/components/LanguageRuntime';
import JurisdictionRuntime from '@/components/JurisdictionRuntime';
import {MemoryRouter} from 'react-router-dom';
import * as XLSX from 'xlsx';
import {webcrypto} from 'node:crypto';
vi.mock('./transportTripImport',async original=>({...await original<any>(),saveImport:async()=>{},storedImport:async()=>null}));
const mock=vi.hoisted(()=>({rpc:vi.fn(),tables:{} as Record<string,any[]>,allow:true,
 abortSignals:{} as Record<string,AbortSignal>,
 layoutUserId:null as string|null,remoteLayout:null as any,
 savedLayout:null as any,layoutReads:0,layoutWriteError:false,layoutReadError:false,
 layoutQueries:[] as Array<Record<string,string>>,companyId:'c',businessUnitId:'b'}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({user:mock.layoutUserId?{id:mock.layoutUserId}:null,activeCompany:{company_id:mock.companyId,membership_role:'company_owner',enabled_modules:['transport','sales','purchase']},activeBusinessUnit:{business_unit_id:mock.businessUnitId,membership_role:'company_owner',business_unit_type:'transport',enabled_modules:['transport','sales','purchase']}})}));
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}})},rpc:(...args:any[])=>{const request=mock.rpc(...args);request.abortSignal=(signal:AbortSignal)=>{mock.abortSignals[args[0]]=signal;return request;};return request;},from:(table:string)=>{
 if(table==='transport_register_layout_preferences'){
  const filters:Record<string,string>={};
  const q:any={
   select:()=>q,
   eq:(name:string,value:string)=>{filters[name]=value;return q;},
   maybeSingle:async()=>{mock.layoutReads++;mock.layoutQueries.push({...filters});return {data:mock.remoteLayout?{layout:mock.remoteLayout}:null,error:mock.layoutReadError?{message:'Cloud offline'}:null};},
   upsert:async(value:any,options:any)=>{mock.savedLayout={...value,options};if(!mock.layoutWriteError)mock.remoteLayout=value.layout;return {data:null,error:mock.layoutWriteError?{message:'Save rejected'}:null};}
  };
  return q;
 }
 const q:any={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,update:()=>q,
 insert:(values:any)=>{const row={...values,id:'added',is_active:true};(mock.tables[table]??=[]).push(row);return {select:()=>({single:async()=>({data:row,error:null})})};},range:()=>Promise.resolve({data:mock.tables[table]??[],error:null}),then:(resolve:any)=>Promise.resolve({data:mock.tables[table]??[],error:null}).then(resolve)};return q;}}}));
vi.mock('./TransportFinancialPanel',()=>({default:()=>null}));vi.mock('./TransportInitialRate',()=>({default:()=>null}));
vi.mock('./TransportCostUpload',()=>({default:()=>null}));vi.mock('./TransportAudit',()=>({default:()=>null}));
vi.mock('./TransportPartyReports',()=>({default:()=>null}));vi.mock('./TransportAccountStatement',()=>({default:()=>null}));
beforeEach(()=>{
 clearRegisterSessionCache();
 localStorage.clear();
 Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
 mock.allow=true;mock.companyId='c';mock.businessUnitId='b';mock.layoutUserId=null;mock.remoteLayout=null;mock.savedLayout=null;mock.layoutReads=0;mock.layoutWriteError=false;mock.layoutReadError=false;mock.layoutQueries=[];
 mock.abortSignals={};
 mock.rpc.mockReset();mock.rpc.mockImplementation(async(name:string,args:any)=>({data:name==='transport_register_query'?{rows:[],count:0,statuses:[],permissions:{customer:true,supplier:true},totals:{}}:name==='transport_prepare_trip_import'?{id:'job',completed:0}:name==='transport_trip_customer_modes'?[{id:'c1',mode:'Credit'}]:name==='transport_import_trip_batch'?args.p_rows.map(()=>({id:'trip',trip_no:'OIC-1'})):name==='transport_create_trips'?[{id:'trip',trip_no:'OIC-1'}]:mock.allow,error:null}));
 mock.tables={customers:[{id:'c1',name:'Customer',is_active:true}],suppliers:[{id:'s',name:'Supplier',is_active:true}],employees:[{id:'e',name:'Employee',is_active:true}],
 transport_truck_types:[{id:'tt',name:'Flatbed',is_active:true},{id:'tt2',name:'Tanker',is_active:true}],
 transport_locations:[{id:'f',name:'From',is_active:true},{id:'t',name:'To',is_active:true}],
 transport_drivers:[{id:'d',driver_name:'Driver',mobile:'12345',driver_type:'company',employee_id:'e',supplier_id:null,is_active:true},{id:'inactive',driver_name:'Inactive Driver',is_active:false}],
 transport_vehicles:[{id:'v',vehicle_no:'FLAT-1',truck_type_id:'tt',is_active:true},{id:'v2',vehicle_no:'TANK-1',truck_type_id:'tt2',is_active:true}],
 transport_vehicle_ownership:[{id:'old',vehicle_id:'v',owner_type:'third_party',supplier_id:'s',owner_name_snapshot:'Supplier',effective_from:'2020-01-01',effective_to:'2026-06-30'},
 {id:'current',vehicle_id:'v',owner_type:'company',supplier_id:null,owner_name_snapshot:'Company',effective_from:'2026-07-01',effective_to:null}]};
});afterEach(()=>{cleanup();clearRegisterSessionCache();vi.unstubAllEnvs();sessionStorage.clear();});
async function view(){render(<MemoryRouter initialEntries={["/transport?view=new"]}><TransportWorkspace/></MemoryRouter>);await waitFor(()=>expect(screen.getByRole('button',{name:'Add Truck Type'})).toBeTruthy());await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_finance_allowed',{p_action:'driver'}));}
function choose(placeholder:string,name:string){fireEvent.focus(screen.getByPlaceholderText(placeholder));fireEvent.mouseDown(screen.getByRole('button',{name}));}
async function fill(){await view();choose('Search Customer','Customer');choose('Search From','From');choose('Search To','To');await waitFor(()=>expect(screen.getByLabelText('Customer billing mode').textContent).toContain('Credit Only'));}
describe('New Trip master integration',()=>{
 it('restricts Plate choices to active compatible Truck Type and clears incompatible selection',async()=>{
  await view();choose('Search Truck Type','Flatbed');fireEvent.focus(screen.getByPlaceholderText('Search Plate'));
  expect(screen.queryByRole('button',{name:'TANK-1'})).toBeNull();fireEvent.mouseDown(screen.getByRole('button',{name:'FLAT-1 · Flatbed - Company'}));
  choose('Search Truck Type','Tanker');expect((screen.getByPlaceholderText('Search Plate') as HTMLInputElement).value).toBe('');expect((screen.getByLabelText('Trip Owner / Supplier') as HTMLInputElement).value).toBe('');
 });
 it('displays historical Supplier then Company by Trip Date, read-only',async()=>{
  await view();choose('Search Truck Type','Flatbed');choose('Search Plate','FLAT-1 · Flatbed - Company');
  fireEvent.change(screen.getByLabelText('Trip Date'),{target:{value:'2026-06-01'}});expect((screen.getByLabelText('Trip Owner / Supplier') as HTMLInputElement).value).toBe('Supplier');
  expect((screen.getByLabelText('Trip Owner / Supplier') as HTMLInputElement).readOnly).toBe(true);
  fireEvent.change(screen.getByLabelText('Trip Date'),{target:{value:'2026-07-01'}});expect((screen.getByLabelText('Trip Owner / Supplier') as HTMLInputElement).value).toBe('Company');
 });
 it('keeps driver selection but removes Driver Pay entry',async()=>{await fill();choose('Search Driver','Driver');expect(screen.queryByLabelText('Driver Pay')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Create Trip'}));await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_create_trips',expect.objectContaining({p_rows:[expect.objectContaining({driver_id:'d',driver_pay:null})]})))});
 it('auto-displays Driver Mobile and excludes inactive Drivers',async()=>{
  await view();fireEvent.focus(screen.getByPlaceholderText('Search Driver'));expect(screen.queryByRole('button',{name:'Inactive Driver'})).toBeNull();
  fireEvent.mouseDown(screen.getByRole('button',{name:'Driver'}));expect((screen.getByLabelText('Driver Mobile') as HTMLInputElement).value).toBe('12345');expect((screen.getByLabelText('Driver Mobile') as HTMLInputElement).readOnly).toBe(true);
 });
 it('disables PPR details while Pending and requires employee/date while Received',async()=>{
  await fill();expect((screen.getByLabelText('PPR Receiving Employee') as HTMLSelectElement).disabled).toBe(true);expect((screen.getByLabelText('PPR Date') as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('PPR Status'),{target:{value:'received'}});fireEvent.click(screen.getByRole('button',{name:'Create Trip'}));
  expect(screen.getByText('PPR Received requires Employee and Date.')).toBeTruthy();expect(mock.rpc.mock.calls.filter(c=>c[0]==='transport_create_trips')).toHaveLength(0);
 });
 it('shows automatic customer billing mode and requires a configured customer before creating a Trip',async()=>{
  await view();
  expect(screen.queryByLabelText('Sale Type')).toBeNull();
  expect(screen.getByLabelText('Customer billing mode').textContent).toContain('Not Configured');
  fireEvent.click(screen.getByRole('button',{name:'Create Trip'}));
  expect(screen.getByText('Customer and Trip Date are required.')).toBeTruthy();
  choose('Search Customer','Customer');
  await waitFor(()=>expect(screen.getByLabelText('Customer billing mode').textContent).toContain('Credit Only'));
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
  ['Add From','locationFrom','Search From','transport_locations'],
  ['Add To','locationTo','Search To','transport_locations'],
 ] as const)('refreshes and auto-selects %s',async(button,kind,placeholder,table)=>{
  await view();mock.rpc.mockImplementation(async(name:string)=>{
   if(name==='create_party_with_opening_balance_v2'){const row={id:'added',name:'Added',is_active:true};mock.tables[table].push(row);return {data:{party_id:row.id},error:null};}
   return {data:true,error:null};
  });
  fireEvent.click(screen.getByRole('button',{name:button}));fireEvent.change(screen.getByLabelText(kind==='customer'?'English Name':'Name'),{target:{value:'Added'}});
  fireEvent.submit(document.querySelectorAll('form')[document.querySelectorAll('form').length-1]);await waitFor(()=>expect(document.querySelector('form')).toBeNull());
  expect((screen.getByPlaceholderText(placeholder) as HTMLInputElement).value).toBe('Added');
 });
 it('selects created Supplier without changing the selected Vehicle owner',async()=>{
  await view();choose('Search Truck Type','Flatbed');choose('Search Plate','FLAT-1 · Flatbed - Company');
  mock.rpc.mockImplementation(async(name:string)=>{if(name==='create_party_with_opening_balance_v2'){const row={id:'added',name:'New Supplier',is_active:true};mock.tables.suppliers.push(row);return {data:{party_id:row.id},error:null};}return {data:true,error:null};});
  fireEvent.click(screen.getByRole('button',{name:'Add Owner / Supplier'}));fireEvent.change(screen.getByLabelText('English Name'),{target:{value:'New Supplier'}});fireEvent.submit(document.querySelectorAll('form')[document.querySelectorAll('form').length-1]);
  await waitFor(()=>expect(document.querySelector('form')).toBeNull());expect(screen.getByText(/Supplier selected: New Supplier/)).toBeTruthy();expect((screen.getByLabelText('Trip Owner / Supplier') as HTMLInputElement).value).toBe('Company');
 });
 it('refreshes and selects atomic new Vehicle and dated ownership',async()=>{
  await view();choose('Search Truck Type','Flatbed');mock.rpc.mockImplementation(async(name:string)=>{
   if(name==='transport_create_vehicle_master'){mock.tables.transport_vehicles.push({id:'added',vehicle_no:'NEW-V',truck_type_id:'tt',is_active:true});mock.tables.transport_vehicle_ownership.push({id:'new-own',vehicle_id:'added',owner_type:'company',owner_name_snapshot:'Company',effective_from:'2020-01-01',effective_to:null});return {data:'added',error:null};}
   return {data:true,error:null};});
  fireEvent.click(screen.getByRole('button',{name:'Add Plate #'}));fireEvent.change(screen.getByLabelText('Vehicle No / Plate No *'),{target:{value:'NEW-V'}});fireEvent.change(screen.getByLabelText('Ownership Effective From *'),{target:{value:'2020-01-01'}});fireEvent.submit(document.querySelectorAll('form')[document.querySelectorAll('form').length-1]);
  await waitFor(()=>expect(document.querySelector('form')).toBeNull());expect((screen.getByPlaceholderText('Search Plate') as HTMLInputElement).value).toBe('NEW-V · Flatbed - Company');
 });
 async function upload(sale='Credit',owner='Supplier',pay=''){
  render(<MemoryRouter initialEntries={["/settings/imports?transportUpload=bulk"]}><TransportWorkspace importOnlyMode="bulk"/></MemoryRouter>);
  await waitFor(()=>expect(screen.getByLabelText(/Select Transport Excel/)).toBeTruthy());
  const headers=['DATE','TRUCK TYPE','COMPANY NAME','DRIVER NAME','OWNER','PLATE #','FROM','TO','PAPER RECEIVED BY','DATE','Customer Rate','Supplier Rent','Driver Pay','Sale Type (Cash / Credit)'];
  const row=['2026-06-01','Flatbed','Customer','Driver',owner,'FLAT-1','From','To','PPR PENDING','','1000','300',pay,sale];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([headers,row]),'Trips');
  const bytes=XLSX.write(wb,{bookType:'xlsx',type:'array'});const file=new File([bytes],'trip.xlsx');Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes});
  fireEvent.change(screen.getByLabelText(/Select Transport Excel/),{target:{files:[file]}});await screen.findByText('trip.xlsx');
 }
 it('rejects supplier-driver earnings in daily bulk before import',async()=>{mock.tables.transport_drivers[0]={...mock.tables.transport_drivers[0],driver_type:'supplier',employee_id:null,supplier_id:'s'};await upload('Credit','Supplier','50');expect(screen.getByRole('button',{name:/Import Valid Rows/}).hasAttribute('disabled')).toBe(true);expect(screen.getByTitle(/Driver Pay entry is disabled/)).toBeTruthy();expect(mock.rpc.mock.calls.some(c=>c[0]==='transport_import_trip_batch')).toBe(false)});
 it('ignores legacy Excel Cash/Credit selection but rejects incorrect owner',async()=>{
  await upload('Other','Fake Owner');
  expect(screen.getByRole('button',{name:/Import Valid Rows/}).hasAttribute('disabled')).toBe(true);
  expect(screen.getByTitle(/dated ownership/).getAttribute('title')).toContain('dated ownership');
  expect(screen.getByText('Credit Only')).toBeTruthy();
 });
 it('imports bulk through the same atomic entry RPC with separate rent/pay and no owner text',async()=>{
  vi.spyOn(window,'confirm').mockReturnValue(true);vi.spyOn(window,'alert').mockImplementation(()=>{});await upload();
  fireEvent.click(screen.getByRole('button',{name:/Import Valid Rows/}));await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_import_trip_batch',expect.objectContaining({p_rows:[expect.objectContaining({vehicle_id:'v',supplier_rent:300,driver_pay:null,sale_type:'credit'})]})));
  expect(mock.rpc.mock.calls.find(c=>c[0]==='transport_import_trip_batch')![1].p_rows[0]).not.toHaveProperty('owner_name_snapshot');
 });

});


describe('Transport register server pagination',()=>{
 it('navigates directly to Last and keeps whole filtered totals',async()=>{
  mock.rpc.mockImplementation(async(name:string,args:any)=>({data:name==='transport_register_query'?{rows:[{id:'trip-'+args.p_offset,trip_no:'TRP-'+args.p_offset,trip_date:'2026-10-01',customer_rate:10,status:'draft'}],count:50000,statuses:[],permissions:{customer:true,supplier:true},totals:{company_rate:800000},completed:0,paper_pending:50000}:true,error:null}));
  render(<MemoryRouter><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('TRP-0');expect(screen.getByText(/800,000.00/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Last'}));await screen.findByText('TRP-49900');
  expect(mock.rpc).toHaveBeenCalledWith('transport_register_query',expect.objectContaining({p_limit:100,p_offset:49900}));
  expect(screen.getByText(/800,000.00/)).toBeTruthy();expect(mock.rpc.mock.calls.some(c=>c[0]==='transport_financial_register_page')).toBe(false);
 });
 it('resets to first page and sends searches to the server',async()=>{
  mock.rpc.mockImplementation(async(name:string,args:any)=>({data:name==='transport_register_query'?{rows:args.p_filters?.search?[{id:'found',trip_no:'OFF-PAGE-TRIP',trip_date:'2026-10-01',customer_rate:50,status:'draft'}]:[],count:args.p_filters?.search?1:50000,statuses:[],permissions:{customer:true,supplier:true},totals:{company_rate:args.p_filters?.search?50:800000},completed:0,paper_pending:1}:true,error:null}));
  render(<MemoryRouter><TransportWorkspace/></MemoryRouter>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Last'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Last'}));await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_register_query',expect.objectContaining({p_offset:49900})));
  fireEvent.click(screen.getByRole('button',{name:'Trip search mode'}));
  fireEvent.click(screen.getByRole('option',{name:'Starts with'}));
  fireEvent.change(screen.getByLabelText('Search all Trip data'),{target:{value:'OFF-PAGE'}});
  expect(screen.queryByText('OFF-PAGE-TRIP')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Search Trips'}));await screen.findByText('OFF-PAGE-TRIP');
  const calls=mock.rpc.mock.calls.filter(c=>c[0]==='transport_register_query');expect(calls[calls.length-1][1]).toMatchObject({p_offset:0,p_filters:{search:'OFF-PAGE',searchMode:'starts_with'}});
  expect(screen.getByText('1 shown / 1 filtered trips')).toBeTruthy();
 });
});

describe('Transport register interactions',()=>{
 it('opens the grouped supplier rent and invoice workflow from the Register',async()=>{
  render(<MemoryRouter initialEntries={['/transport?view=trips']}><TransportWorkspace/></MemoryRouter>);
  const open=await screen.findByRole('button',{name:'Supplier Rent / Invoice'});
  fireEvent.click(open);
  expect(await screen.findByRole('heading',{name:'Bulk Supplier Rent'})).toBeTruthy();
 });

 it('deletes only after selecting a Draft Trip and confirming a reason',async()=>{
  let deleted=false;
  mock.rpc.mockImplementation(async(name:string)=>{
   if(name==='transport_delete_draft_trip'){deleted=true;return {data:{deleted:true,trip_no:'DEL-TRIP'},error:null};}
   return {data:name==='transport_register_query'?{rows:deleted?[]:[{id:'delete-trip',trip_no:'DEL-TRIP',status:'draft'}],count:deleted?0:1,statuses:[],permissions:{customer:true,supplier:true},totals:{}}:true,error:null};
  });
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('DEL-TRIP');
  const remove=screen.getByRole('button',{name:'Delete selected Trip'}) as HTMLButtonElement;
  expect(remove.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Select trip DEL-TRIP'));expect(remove.disabled).toBe(false);fireEvent.click(remove);
  expect(screen.getByRole('dialog',{name:'Delete Unposted Trip'})).toBeTruthy();
  expect((screen.getByRole('button',{name:'Delete Unposted Trip'}) as HTMLButtonElement).disabled).toBe(true);
  expect(mock.rpc.mock.calls.filter(c=>c[0]==='transport_delete_draft_trip')).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Trip deletion reason'),{target:{value:'Duplicate entry'}});
  fireEvent.click(screen.getByRole('button',{name:'Delete Unposted Trip'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_delete_draft_trip',{p_trip_id:'delete-trip',p_reason:'Duplicate entry'}));
  await screen.findByText('No trips yet.');expect(screen.queryByRole('dialog',{name:'Delete Unposted Trip'})).toBeNull();
 });
 it('allows finalized-only Incomplete Trip deletion with a reason',async()=>{
   let deleted=false;
   mock.rpc.mockImplementation(async(name:string)=>{
     if(name==='transport_delete_draft_trip'){deleted=true;return {data:{deleted:true,trip_no:'OIC-000001'},error:null};}
     return {data:name==='transport_register_query'?{rows:deleted?[]:[{id:'finalized-only-trip',trip_no:'OIC-000001',status:'incomplete',customer_rate:1500}],count:deleted?0:1,statuses:[],permissions:{customer:true,supplier:true},totals:{}}:true,error:null};
   });
   render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
   await screen.findByText('OIC-000001');
   fireEvent.click(screen.getByLabelText('Select trip OIC-000001'));
   const remove=screen.getByRole('button',{name:'Delete selected Trip'}) as HTMLButtonElement;
   expect(remove.disabled).toBe(false);fireEvent.click(remove);
   expect(screen.getByText(/finalized-only rate/)).toBeTruthy();
   expect((screen.getByRole('button',{name:'Delete Unposted Trip'}) as HTMLButtonElement).disabled).toBe(true);
   fireEvent.change(screen.getByLabelText('Trip deletion reason'),{target:{value:'Finalized wrong rate, remove mistaken trip'}});
   fireEvent.click(screen.getByRole('button',{name:'Delete Unposted Trip'}));
   await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_delete_draft_trip',{p_trip_id:'finalized-only-trip',p_reason:'Finalized wrong rate, remove mistaken trip'}));
   await screen.findByText('No trips yet.');
  });
 it('keeps the Trip and confirmation open when the server blocks financial deletion',async()=>{
  mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_register_query'?{rows:[{id:'blocked-trip',trip_no:'BLOCKED-TRIP',status:'draft'}],count:1,statuses:[],permissions:{customer:true,supplier:true},totals:{}}:true,error:name==='transport_delete_draft_trip'?{message:'Trip has financial entries or documents.'}:null}));
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('BLOCKED-TRIP');fireEvent.click(screen.getByLabelText('Select trip BLOCKED-TRIP'));fireEvent.click(screen.getByRole('button',{name:'Delete selected Trip'}));
  fireEvent.change(screen.getByLabelText('Trip deletion reason'),{target:{value:'Mistake'}});fireEvent.click(screen.getByRole('button',{name:'Delete Unposted Trip'}));
  await screen.findByText('Trip has financial entries or documents.');expect(screen.getByRole('dialog',{name:'Delete Unposted Trip'})).toBeTruthy();expect(screen.getByText('BLOCKED-TRIP')).toBeTruthy();
 });
 it('blocks selection of a non Draft Trip for deletion and honors denied delete permission',async()=>{
  mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_register_query'?{rows:[{id:'locked-trip',trip_no:'LOCKED-TRIP',status:'locked'}],count:1,statuses:[],permissions:{customer:true,supplier:true},totals:{}}:true,error:null}));
  const view=render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('LOCKED-TRIP');fireEvent.click(screen.getByLabelText('Select trip LOCKED-TRIP'));
  expect((screen.getByRole('button',{name:'Delete selected Trip'}) as HTMLButtonElement).disabled).toBe(true);
  view.unmount();
  mock.rpc.mockImplementation(async(name:string,args:any)=>({data:name==='transport_register_query'?{rows:[],count:0,statuses:[],permissions:{customer:true,supplier:true},totals:{}}:args?.p_action==='trip_delete'?false:true,error:null}));
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);await screen.findByText('No trips yet.');
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('has_transport_action_permission',{p_company_id:'c',p_action:'trip_delete'}));expect(screen.queryByRole('button',{name:'Delete selected Trip'})).toBeNull();
 });
 it('keeps original Theme 1 and removes the theme switcher even for saved Theme 4',async()=>{
  const key='navilo:transport:trip-theme:user:c:b';localStorage.setItem(key,'theme4');
  try{
   render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
   await screen.findByText('No trips yet.');
   expect(document.querySelector('[data-navilo-transport-register]')?.getAttribute('data-navilo-theme')).toBe('theme1');
   expect(screen.queryByRole('button',{name:/Theme [1-4]/})).toBeNull();
   const strip=document.querySelector('.navilo-transport-topbar');
   expect(screen.queryByRole('button',{name:'Pay Rent to Suppliers'})).toBeNull();
   expect(screen.queryByRole('button',{name:'Receive Customer Payment'})).toBeNull();
   expect(strip?.contains(screen.getByRole('button',{name:'Search Trips'}))).toBe(true);
   expect(strip?.contains(screen.getAllByRole('button',{name:'Add Trip'})[0])).toBe(true);
   expect(document.querySelector('.navilo-transport-register-actions')?.contains(screen.getAllByRole('button',{name:'Add Trip'})[0])).toBe(true);
   expect(document.querySelector('.navilo-transport-register-toolbar')?.contains(screen.getAllByRole('button',{name:'Add Trip'})[0])).toBe(false);
   expect(strip?.contains(screen.getByRole('button',{name:'Filter Trip dates'}))).toBe(true);
   expect(document.querySelector('.navilo-transport-toolbar-wrap')).toBeNull();
  }finally{localStorage.removeItem(key);}
 });
 it('shows customer and supplier invoice numbers in their own financial groups',async()=>{
  mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_register_query'?{rows:[{id:'invoice-trip',trip_no:'INV-TRIP',trip_date:'2026-10-01',status:'locked',invoice_no:'TR-S000010',supplier_invoice_no:'TR-P000010'}],count:1,statuses:[],permissions:{customer:true,supplier:true},totals:{}}:true,error:null}));
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('INV-TRIP');
  expect(screen.getByTitle('Sort Customer Invoice ascending')).toBeTruthy();
  expect(screen.getByTitle('Sort Supplier Invoice ascending')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Open Invoice Number INV-TRIP'}).hasAttribute('data-register-editable')).toBe(true);
  expect(screen.getByRole('button',{name:'Open Invoice Number INV-TRIP'}).textContent).toContain('TR-S000010');
  expect(screen.getByText('TR-P000010')).toBeTruthy();
 });
 it('fits the register to remaining viewport height and recalculates after resize',async()=>{
  const height=window.innerHeight;
  const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
   return {top:this.hasAttribute('data-navilo-transport-register')?92:0,bottom:0,left:0,right:0,x:0,y:0,width:0,height:0,toJSON:()=>({})} as DOMRect;
  });
  try{
   Object.defineProperty(window,'innerHeight',{value:768,configurable:true});
   render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
   const section=document.querySelector<HTMLElement>('[data-navilo-transport-register]')!;
   expect(section.style.height).toBe('668px');
   Object.defineProperty(window,'innerHeight',{value:900,configurable:true});fireEvent(window,new Event('resize'));
   expect(section.style.height).toBe('800px');
  }finally{rect.mockRestore();Object.defineProperty(window,'innerHeight',{value:height,configurable:true});}
 });
 it('includes new and hidden headers when loading an older saved column order',async()=>{
  const key='navilo:transport:trip-grid:user:c:b';
  localStorage.setItem(key,JSON.stringify({order:['trip_no','company_rate'],hidden:['customer_credit']}));
  try{
   render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
   await screen.findByTitle('Sort Supplier Credit / Advance ascending');fireEvent.click(screen.getByRole('button',{name:'Columns'}));
   const supplier=screen.getAllByText('Supplier Credit / Advance').map(e=>e.closest('div[draggable]')).find(Boolean)!;
   const customer=screen.getAllByText('Customer Credit / Advance').map(e=>e.closest('div[draggable]')).find(Boolean)!;
   expect(supplier.querySelector('input')).toBeTruthy();
   expect((customer.querySelector('input') as HTMLInputElement).checked).toBe(false);
   fireEvent.click(customer.querySelector('input')!);
   expect(await screen.findByTitle('Sort Customer Credit / Advance ascending')).toBeTruthy();
  }finally{localStorage.removeItem(key);}
 });
 it('toggles header ASC/DESC through the server query while retaining the 100 row page limit',async()=>{
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  const header=await screen.findByTitle('Sort Trip No ascending');fireEvent.click(header);
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_register_query',expect.objectContaining({p_limit:100,p_offset:0,p_sort:'trip_no',p_direction:'asc'})));
  expect(header.closest('th')?.getAttribute('aria-sort')).toBe('ascending');fireEvent.click(header);
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_register_query',expect.objectContaining({p_limit:100,p_offset:0,p_sort:'trip_no',p_direction:'desc'})));
  expect(header.closest('th')?.getAttribute('aria-sort')).toBe('descending');
 });
 it('scrolls horizontally on the header but leaves ordinary body wheel uncancelled',async()=>{
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  const header=await screen.findByTitle('Sort Trip No ascending');const table=header.closest('table')!,grid=table.parentElement!;
  const horizontal=new WheelEvent('wheel',{deltaY:80,bubbles:true,cancelable:true});fireEvent(header,horizontal);
  expect(horizontal.defaultPrevented).toBe(true);expect(grid.scrollLeft).toBe(80);
  const vertical=new WheelEvent('wheel',{deltaY:60,bubbles:true,cancelable:true});fireEvent(table.querySelector('tbody')!,vertical);
  expect(vertical.defaultPrevented).toBe(false);expect(grid.scrollLeft).toBe(80);
 });
});


describe('Trip edit transition',()=>{
 it('allows finalized but unposted Truck Type correction with an audit reason',async()=>{
  const trip={id:'rate-finalized',trip_no:'FINALIZED-1',status:'incomplete',trip_date:'2026-10-01',customer_id:'c1',
   truck_type_id:'tt',vehicle_id:'v',driver_id:'d',from_location:'From',to_location:'To',
   customer_rate_state:'finalized',customer_rate:300,sale_type:'credit',ppr_status:'pending'};
  mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_register_query'
   ?{rows:[trip],count:1,statuses:[],permissions:{customer:true,supplier:true},totals:{}}
   :name==='transport_edit_trip_read'?trip:name==='transport_trip_customer_modes'?[{id:'c1',mode:'Credit'}]:true,error:null}));
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'FINALIZED-1'}));
  await screen.findByRole('button',{name:'Save Changes'});
  await waitFor(()=>expect(screen.getByLabelText('Customer billing mode').textContent).toContain('Credit Only'));
  await waitFor(()=>expect((screen.getByRole('button',{name:'Save Changes'}) as HTMLButtonElement).disabled).toBe(false));
  choose('Search Truck Type','Tanker');
  // The audit reason is selected in the Register's correction dialog.
  try{
   fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));
   expect(await screen.findByRole('dialog',{name:'Trip edit correction reason'})).toBeTruthy();
   fireEvent.change(screen.getByLabelText('Correction reason selection'),{target:{value:'Truck Type / vehicle correction'}});
   fireEvent.click(screen.getByRole('button',{name:'Continue Save'}));
   await waitFor(()=>{
    if(!mock.rpc.mock.calls.some(call=>call[0]==='transport_save_operational_trip_edit')){
      throw new Error('Trip edit was not submitted: '+(document.querySelector('.bg-red-50')?.textContent??'no error displayed'));
    }
   });
   await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_save_operational_trip_edit',expect.objectContaining({
     p_trip_id:'rate-finalized',p_reason:'Truck Type / vehicle correction'
   })));
   expect(mock.rpc.mock.calls.some(c=>c[0]==='transport_replace_trip_assignment')).toBe(false);
  }finally{vi.restoreAllMocks();}
 });
 it('uses one transaction RPC for a Driver replacement',async()=>{
  mock.tables.transport_drivers.push({id:'d2',driver_name:'Second Driver',driver_type:'company',employee_id:'e',is_active:true});
  const trip={id:'atomic-trip',trip_no:'ATOMIC-1',status:'draft',trip_date:'2026-10-01',customer_id:'c1',
   truck_type_id:'tt',vehicle_id:'v',driver_id:'d',from_location:'From',to_location:'To',
   customer_rate_state:'pending',sale_type:'credit',ppr_status:'pending'};
  mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_register_query'
   ?{rows:[trip],count:1,statuses:[],permissions:{customer:true,supplier:true},totals:{}}
   :name==='transport_edit_trip_read'?trip:name==='transport_trip_customer_modes'?[{id:'c1',mode:'Credit'}]:true,error:null}));
  // Selecting a preset reason replaces the previous native browser prompt.
  try{
   render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
   fireEvent.click(await screen.findByRole('button',{name:'ATOMIC-1'}));
   await screen.findByRole('button',{name:'Save Changes'});
   await waitFor(()=>expect(screen.getByLabelText('Customer billing mode').textContent).toContain('Credit Only'));
   await waitFor(()=>expect((screen.getByRole('button',{name:'Save Changes'}) as HTMLButtonElement).disabled).toBe(false));
   choose('Search Driver','Second Driver');
   fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));
   expect(await screen.findByRole('dialog',{name:'Trip edit correction reason'})).toBeTruthy();
   fireEvent.change(screen.getByLabelText('Correction reason selection'),{target:{value:'Driver / assignment replacement'}});
   fireEvent.click(screen.getByRole('button',{name:'Continue Save'}));
   await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_save_operational_trip_edit',expect.objectContaining({
     p_trip_id:'atomic-trip',p_driver_id:'d2',p_vehicle_id:'v',p_reason:'Driver / assignment replacement',
     p_changes:expect.objectContaining({truck_type_id:'tt'})
   })));
   expect(mock.rpc.mock.calls.some(c=>c[0]==='transport_replace_trip_assignment')).toBe(false);
  }finally{vi.restoreAllMocks();}
 });

 it('opens an existing Trip from the register with global toolbar active',async()=>{
  await import('@/accountNameDisplayRuntime');
  await import('@/documentLanguageIsolationRuntime');
  const trip={id:'trip-edit',trip_no:'EDIT-1',trip_date:'2026-10-01',customer_id:'c1',truck_type_id:'tt',vehicle_id:'v',driver_id:'d',from_location:'From',to_location:'To',sale_type:'credit',ppr_status:'pending',customer_rate:100,supplier_rent_total:70,driver_pay:10};
  mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_register_query'?{rows:[trip],count:1,statuses:[],permissions:{customer:true,supplier:true},totals:{}}:name==='transport_edit_trip_read'?trip:true,error:null}));
  render(<MemoryRouter initialEntries={['/transport']}><main id="navilo-main-content"><StrictMode><GlobalLanguageRuntime/><LanguageRuntime/><JurisdictionRuntime/><UniversalDataTools/><TransportWorkspace/></StrictMode></main></MemoryRouter>);
  const edit=await screen.findByRole('button',{name:'EDIT-1'});
  fireEvent.click(edit);
  await screen.findByRole('button',{name:'Save Changes'});
  expect((screen.getByPlaceholderText('Search Customer') as HTMLInputElement).value).toBe('Customer');
  expect((screen.getByLabelText('Trip Date') as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByLabelText('Customer Base Rate') as HTMLInputElement).readOnly).toBe(false);
  expect((screen.getByLabelText('Driver Pay') as HTMLInputElement).value).toBe('10');
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  await screen.findByRole('button',{name:'EDIT-1'});
 });
});

describe('Transport report isolation',()=>{
 it('does not request the trip register behind a party report',async()=>{
  render(<MemoryRouter initialEntries={['/transport?panel=customer-reports']}><TransportWorkspace/></MemoryRouter>);
  await new Promise(resolve=>setTimeout(resolve,300));
  expect(mock.rpc.mock.calls.some(call=>call[0]==='transport_register_query')).toBe(false);
 });
});

describe('Transport compact register and centered controls',()=>{
 it('opens the selected trip supplier rate setup when charges have no rent yet',async()=>{
  const trip={id:'no-rent',trip_no:'OIC-NO-RENT',status:'draft',owner_name:'Supplier'};
  const normal=mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation(async(name:string,args:any)=>{
   if(name==='transport_register_query')return {data:{rows:[trip],count:1,statuses:[],permissions:{customer:true,supplier:true},totals:{}},error:null};
   if(name==='transport_bulk_rate_page')return {data:{rows:[{...trip,id:'pending-rent',trip_id:trip.id,party_id:'s',rent:null}],count:1,amount:0},error:null};
   return normal(name,args);
  });
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'Open Supplier Charges OIC-NO-RENT'}));
  await screen.findByRole('dialog',{name:'Supplier Rate & Charges'});
  expect(screen.getByText('Trip · OIC-NO-RENT')).toBeTruthy();
  expect(await screen.findByLabelText('Supplier charge')).toBeTruthy();
  expect(screen.queryByText(/No supplier rent exists/)).toBeNull();
  expect(mock.rpc).toHaveBeenCalledWith('transport_bulk_rate_page',expect.objectContaining({p_filters:expect.objectContaining({initialTrip:'no-rent'})}));
  expect(mock.rpc.mock.calls.some(([name])=>name==='transport_supplier_rent_save'||name==='transport_post_supplier_rent')).toBe(false);
 });
 it('keeps saved visible columns compact and each financial group contiguous',async()=>{
  const key='navilo:transport:trip-grid:v2:user:c:b';
  localStorage.setItem(key,JSON.stringify({order:['trip_no','company','driver','supplier_charges','from'],hidden:[]}));
  try{
   render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
   await screen.findByText('No trips yet.');
   expect(screen.getAllByText('TRIP DETAILS')).toHaveLength(1);
   const table=document.querySelector('[data-navilo-transport-register] table') as HTMLTableElement;
   expect(table.className).not.toContain('min-w-full');expect(table.querySelectorAll('col').length).toBeGreaterThan(10);expect(table.style.width).toMatch(/px$/);
  }finally{localStorage.removeItem(key);}
 });
 it('groups visible Trip Columns and puts vehicle owner and profit in matching sections',async()=>{
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('No trips yet.');fireEvent.click(screen.getByRole('button',{name:'Columns'}));
  const dialog=screen.getByRole('dialog',{name:'Trip columns'});
  expect(dialog.querySelectorAll('[data-trip-column-group]')).toHaveLength(6);
  expect(dialog.querySelector('[data-trip-column-key="owner"]')?.closest('[data-trip-column-group]')?.getAttribute('data-trip-column-group')).toBe('vehicle');
  expect(dialog.querySelector('[data-trip-column-key="profit"]')?.closest('[data-trip-column-group]')?.getAttribute('data-trip-column-group')).toBe('profit');
  expect(screen.getAllByText('VEHICLE & DRIVER').length).toBeGreaterThan(0);
  expect(screen.getAllByText('PROFIT').length).toBeGreaterThan(0);
 });
 it('reorders columns in both directions but blocks cross-group drops',async()=>{
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('No trips yet.');fireEvent.click(screen.getByRole('button',{name:'Columns'}));
  const dialog=screen.getByRole('dialog',{name:'Trip columns'}),trip=dialog.querySelector('[data-trip-column-group="trip"]')!;
  const keys=()=>Array.from(trip.querySelectorAll('[data-trip-column-key]')).map(el=>el.getAttribute('data-trip-column-key'));
  fireEvent.dragStart(trip.querySelector('[data-trip-column-key="trip_no"]')!);
  fireEvent.dragOver(trip.querySelector('[data-trip-column-key="to"]')!);
  fireEvent.drop(trip.querySelector('[data-trip-column-key="to"]')!);
  expect(keys()[keys().length-1]).toBe('trip_no');
  fireEvent.dragStart(trip.querySelector('[data-trip-column-key="trip_no"]')!);
  fireEvent.drop(trip.querySelector('[data-trip-column-key="trip_date"]')!);
  expect(keys().indexOf('trip_no')).toBeLessThan(keys().indexOf('trip_date'));
  const order=keys();
  fireEvent.dragStart(trip.querySelector('[data-trip-column-key="trip_no"]')!);
  fireEvent.drop(dialog.querySelector('[data-trip-column-key="company"]')!);
  expect(keys()).toEqual(order);
 });
 it('marks partly hidden groups and clears legacy layouts when resetting',async()=>{
  const legacy='navilo:transport:trip-grid:user:c:b',current='navilo:transport:trip-grid:v2:user:c:b';
  localStorage.setItem(legacy,JSON.stringify({order:['trip_no','company'],hidden:['company','owner']}));
  try{
   render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
   await screen.findByText('No trips yet.');fireEvent.click(screen.getByRole('button',{name:'Columns'}));
   const dialog=screen.getByRole('dialog',{name:'Trip columns'});
   const checkbox=dialog.querySelector('[data-trip-column-group="customer"] input[type="checkbox"]') as HTMLInputElement;
   await waitFor(()=>expect(checkbox.indeterminate).toBe(true));
   fireEvent.click(screen.getByRole('button',{name:'Reset Default'}));
   expect(localStorage.getItem(legacy)).toBeNull();expect(JSON.parse(localStorage.getItem(current)??'{}').hidden).toEqual([]);
   expect(checkbox.indeterminate).toBe(false);expect(checkbox.checked).toBe(true);
   fireEvent.click(screen.getByRole('button',{name:'Save as Default'}));
   expect(JSON.parse(localStorage.getItem(current)??'{}').hidden).toEqual([]);
  }finally{localStorage.removeItem(legacy);localStorage.removeItem(current);}
 });
 it('loads a saved cloud layout for this login, company and business unit',async()=>{
  const id='10000000-0000-0000-0000-000000000001';
  const key=`navilo:transport:trip-grid:v2:${id}:c:b`;
  mock.layoutUserId=id;
  mock.remoteLayout={order:['company','trip_no'],hidden:['owner'],widths:{driver:124}};
  try{
   render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
   await screen.findByTitle('Sort Customer ascending');
   await waitFor(()=>expect(mock.layoutReads).toBe(1));
   await waitFor(()=>expect(screen.queryByTitle('Sort Vehicle Owner ascending')).toBeNull());
   expect(mock.layoutQueries[0]).toEqual({user_id:id,company_id:'c',business_unit_id:'b'});
   expect(JSON.parse(localStorage.getItem(key)??'{}').hidden).toEqual(['owner']);
  }finally{localStorage.removeItem(key);}
 });
 it('saves layout changes to the signed-in user and makes them available next session',async()=>{
  const id='20000000-0000-0000-0000-000000000002',key=`navilo:transport:trip-grid:v2:${id}:c:b`;
  mock.layoutUserId=id;
  try{
   render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
   await screen.findByTitle('Sort Trip Profit ascending');
   await waitFor(()=>expect(mock.layoutReads).toBe(1));
   fireEvent.click(screen.getByRole('button',{name:'Columns'}));
   const hide=screen.getByRole('checkbox',{name:'Show column Trip Profit'});
   fireEvent.click(hide);
   fireEvent.click(screen.getByRole('button',{name:'Save as Default'}));
   await waitFor(()=>expect(mock.savedLayout?.layout?.hidden).toContain('profit'));
   expect(mock.savedLayout).toEqual(expect.objectContaining({
    user_id:id,company_id:'c',business_unit_id:'b',
    options:{onConflict:'user_id,company_id,business_unit_id'}
   }));
   expect(JSON.parse(localStorage.getItem(key)??'{}').hidden).toContain('profit');
  }finally{localStorage.removeItem(key);}
 });
 it('migrates an existing local default once when no cloud profile exists',async()=>{
  const id='30000000-0000-0000-0000-000000000003',key=`navilo:transport:trip-grid:v2:${id}:c:b`;
  mock.layoutUserId=id;
  localStorage.setItem(key,JSON.stringify({order:['trip_no'],hidden:['driver'],widths:{trip_no:112}}));
  try{
   render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
   await waitFor(()=>expect(mock.savedLayout?.layout?.hidden).toContain('driver'));
   expect(mock.savedLayout.layout.widths.trip_no).toBe(112);
   expect(mock.savedLayout.user_id).toBe(id);
  }finally{localStorage.removeItem(key);}
 });
 it('keeps the columns popup open and shows an error if cloud save fails',async()=>{
  const id='40000000-0000-0000-0000-000000000004',key=`navilo:transport:trip-grid:v2:${id}:c:b`;
  mock.layoutUserId=id;mock.layoutWriteError=true;
  try{
   render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
   await screen.findByTitle('Sort Trip No ascending');
   await waitFor(()=>expect(mock.layoutReads).toBe(1));
   fireEvent.click(screen.getByRole('button',{name:'Columns'}));
   fireEvent.click(screen.getByRole('button',{name:'Save as Default'}));
   await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Could not save columns'));
   expect(screen.getByRole('dialog',{name:'Trip columns'})).toBeTruthy();
  }finally{localStorage.removeItem(key);}
 });
 it('opens header filters and column settings outside the scrollport and closes them',async()=>{
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('No trips yet.');fireEvent.click(screen.getByRole('button',{name:'Filter Trip No'}));
  const dialog=screen.getByRole('dialog',{name:'Trip No filter popup'});expect(dialog.closest('[data-navilo-transport-register]')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Close Trip No filter'}));expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Columns'}));expect(screen.getByRole('dialog',{name:'Trip columns'}).closest('[data-navilo-transport-register]')).toBeNull();
 });
 it('cancels both canonical and failure recovery reads when leaving the register',async()=>{
  const baseTimer=window.setTimeout.bind(window);
  const shortened=vi.spyOn(window,'setTimeout').mockImplementation(((callback:TimerHandler,ms?:number,...args:any[])=>
    baseTimer(callback,ms===6500?25:ms,...args)) as typeof window.setTimeout);
  try{
   const original=mock.rpc.getMockImplementation()!;
   mock.rpc.mockImplementation((name:string,args:any)=>{
    if(name==='transport_register_query')return Promise.resolve({data:null,error:{code:'57014',message:'statement timeout'}});
    if(name==='transport_register_operational_recovery')return new Promise(()=>{});
    return original(name,args);
   });
   const view=render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
   await waitFor(()=>expect(mock.abortSignals.transport_register_operational_recovery).toBeTruthy());
   const canonical=mock.abortSignals.transport_register_query;
   const recovery=mock.abortSignals.transport_register_operational_recovery;
   expect(recovery.aborted).toBe(false);
   view.unmount();
   expect(canonical.aborted).toBe(true);
   expect(recovery.aborted).toBe(true);
  }finally{shortened.mockRestore()}
 });
 it('shows actual gross receipts and supplier payments consistently with payment amount',async()=>{
  const original=mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation((name:string,args:any)=>{
   if(name==='transport_register_query')return Promise.resolve({data:{rows:[{
    id:'gross-trip',trip_no:'GROSS-1',trip_date:'2026-10-10',ppr_status:'pending',
    received_from_company:100,customer_received_gross:115,
    supplier_paid_net:200,payment_amount:230,supplier_paid_gross:230
   }],count:1,statuses:[],permissions:{customer:true,supplier:true},totals:{}},error:null});
   return original(name,args);
  });
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  const trip=await screen.findByRole('button',{name:/^GROSS-1$/});
  const row=trip.closest('tr')!;
  expect(row.textContent).toContain('115.00');
  expect(row.textContent).not.toContain('100.00');
  expect(row.textContent?.match(/230\.00/g)).toHaveLength(2);
  expect(row.textContent).not.toContain('200.00');
 });
 it('does not compete with a pending canonical request by starting another financial read',async()=>{
  const baseTimer=window.setTimeout.bind(window);
  const shortened=vi.spyOn(window,'setTimeout').mockImplementation(((callback:TimerHandler,ms?:number,...args:any[])=>
    baseTimer(callback,ms===6500?25:ms,...args)) as typeof window.setTimeout);
  try{
   const original=mock.rpc.getMockImplementation()!;
   mock.rpc.mockImplementation((name:string,args:any)=>{
    if(name==='transport_register_query'&&!args?.p_option_key)return new Promise(()=>{});
    if(name==='transport_register_operational_recovery')return Promise.resolve({
     data:{recovery_only:true,permissions:{customer:true,supplier:true},count:16732,rows:[{
      id:'early-trip',trip_no:'19535',display_trip_no:'19535',trip_date:'2026-10-15',
      customer_name:'Safe customer',driver_name:'Driver',vehicle_no:'FLAT-1',
      from_location:'Dammam',to_location:'Riyadh',ppr_status:'pending'
     }]},error:null});
    return original(name,args);
   });
   render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
   await waitFor(()=>expect(mock.abortSignals.transport_register_query).toBeTruthy());
   await new Promise(resolve=>baseTimer(resolve,80));
   expect(mock.rpc).not.toHaveBeenCalledWith('transport_register_operational_recovery',expect.anything());
   expect(mock.rpc).not.toHaveBeenCalledWith('transport_register_financial_recovery_page',expect.anything());
   expect(screen.getByText('Loading trips…')).toBeTruthy();
  }finally{shortened.mockRestore()}
 });
 it('restores verified customer and supplier amounts only for matching recovered Trip IDs',async()=>{
  mock.rpc.mockImplementation(async(name:string,args:any)=>{
   if(name==='transport_register_query')return {data:null,error:{code:'57014',message:'statement timeout'}};
   if(name==='transport_register_operational_recovery')return {data:{
    recovery_only:true,permissions:{customer:true,supplier:true},count:16732,
    rows:[{id:'saved-trip-1',trip_no:'19535',display_trip_no:'19535',trip_date:'2026-10-10',
     customer_name:'Restored customer',driver_name:'Driver',vehicle_no:'FLAT-1',
     from_location:'Dammam',to_location:'Riyadh',ppr_status:'pending'}]},error:null};
   if(name==='transport_edit_trip_read')return {data:{id:'saved-trip-1',customer_rate:1600,customer_rate_state:'finalized'},error:null};
   if(name==='transport_register_financial_recovery_page'){
     expect(args.p_trip_ids).toEqual(['saved-trip-1']);
     return {data:{rows:[{
      id:'saved-trip-1',recovery_financial_verified:true,trip_no:'19535',
      billed_customer_net:1700,customer_rate:1700,customer_rate_state:'finalized',
      customer_outstanding_gross:1200,received_from_company:500,
      billed_supplier_net:850,supplier_rent:850,supplier_outstanding_gross:250,
      supplier_paid_net:600,owner_rent:850,supplier_rate_locked:true
     }]},error:null};
   }
   return {data:true,error:null};
  });
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  const table=screen.getByRole('table',{name:/Trips register/i});
  await waitFor(()=>expect(table.textContent).toContain('1,700.00'));
  expect(table.textContent).toContain('1,200.00');
  expect(table.textContent).toContain('850.00');
  expect(table.textContent).toContain('250.00');
  expect(table.textContent).toContain('Restored customer');
  expect(screen.getByRole('button',{name:'Open Customer Charges 19535'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Open Customer Charges 19535'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_edit_trip_read',{p_trip_id:'saved-trip-1'}));
  expect(screen.getAllByText(/Visible Trip amounts verified/).length).toBeGreaterThan(0);
 });
 it('never assigns financial amounts from a different Trip ID',async()=>{
  mock.rpc.mockImplementation(async(name:string)=>{
   if(name==='transport_register_query')return {data:null,error:{code:'57014',message:'statement timeout'}};
   if(name==='transport_register_operational_recovery')return {data:{
    recovery_only:true,permissions:{customer:true,supplier:true},count:1,
    rows:[{id:'saved-trip-1',trip_no:'19535',display_trip_no:'19535',trip_date:'2026-10-10',
      customer_name:'Protected customer',driver_name:'Driver',vehicle_no:'FLAT-1',ppr_status:'pending'}]},error:null};
   if(name==='transport_register_financial_recovery_page')
     return {data:{rows:[{id:'different-trip',recovery_financial_verified:true,
        billed_customer_net:999999}]},error:null};
   return {data:true,error:null};
  });
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText(/Original Trip Register · 1 saved Trips/);
  const table=screen.getByRole('table',{name:/Trips register/i});
  await waitFor(()=>expect(table.textContent).toContain('Protected customer'));
  expect(table.textContent).not.toContain('999,999.00');
  expect(table.textContent).toContain('—');
 });
 it('uses the bounded operational recovery for a timed-out Register without fake financial figures',async()=>{
  mock.rpc.mockImplementation(async(name:string)=>{
   if(name==='transport_register_query')return {data:null,error:{message:'canceling statement due to statement timeout',code:'57014'}};
   if(name==='transport_register_operational_recovery')return {data:{recovery_only:true,permissions:{customer:true,supplier:true},count:1,rows:[{
     id:'recovered-trip',trip_no:'19535',display_trip_no:'19535',trip_date:'2026-10-10',
     customer_name:'Recovery Customer',driver_name:'Driver',vehicle_no:'FLAT-1',
     from_location:'Dammam',to_location:'Riyadh',ppr_status:'pending'
   }]},error:null};
   return {data:true,error:null};
  });
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText(/Original Trip Register · 1 saved Trips/);
  const result=screen.getByRole('table',{name:/Trips register/i});
  expect(result.textContent).toContain('19535');
  expect(result.textContent).toContain('Recovery Customer');
  expect(result.textContent).toContain('Customer Rate (Net)');
  expect(result.textContent).toContain('Supplier Bill Balance');
  expect(result.textContent).not.toContain('1,700.00');
  expect(result.closest('[style*="display: none"]')).toBeNull();
  expect(screen.getByRole('button',{name:'Retry financial data'})).toBeTruthy();
  expect(mock.rpc).toHaveBeenCalledWith('transport_register_operational_recovery',expect.objectContaining({p_offset:0,p_search:''}));
 });
 it('checks all shown header-filter values without silently clearing the filter',async()=>{
  const original=mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation(async(name:string,args:any)=>{
    if(name==='transport_register_query' && args?.p_option_key==='company'){
      return {data:{options:['Customer A','Customer B']},error:null};
    }
    return original(name,args);
  });
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('No trips yet.');
  fireEvent.click(screen.getByRole('button',{name:'Filter Customer'}));
  await screen.findByText('Customer A');
  const dialog=screen.getByRole('dialog',{name:'Customer filter popup'});
  fireEvent.click(screen.getByRole('button',{name:'Select Shown'}));
  const boxes=Array.from(dialog.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
  await waitFor(()=>expect(boxes.map(b=>b.checked)).toEqual([true,true]));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_register_query',expect.objectContaining({
    p_filters:expect.objectContaining({columns:expect.objectContaining({company:['Customer A','Customer B']})})
  })));
  fireEvent.click(screen.getByRole('button',{name:'Clear'}));
  await waitFor(()=>expect(boxes.map(b=>b.checked)).toEqual([false,false]));
 });
 it('refuses to send more than 1,000 trip options as one massive SQL filter',async()=>{
  const original=mock.rpc.getMockImplementation()!;
  const values=Array.from({length:1010},(_,i)=>'Trip '+String(i+1));
  mock.rpc.mockImplementation(async(name:string,args:any)=>{
    if(name==='transport_register_query' && args?.p_option_key==='trip_no'){
      return {data:{options:values},error:null};
    }
    return original(name,args);
  });
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('No trips yet.');
  fireEvent.click(screen.getByRole('button',{name:'Filter Trip No'}));
  await screen.findByRole('button',{name:'Show All'});
  fireEvent.change(screen.getByPlaceholderText('Search all values...'),{target:{value:'Trip'}});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Select Shown'}).hasAttribute('disabled')).toBe(true));
 });
 it('does not display an old monetary header total under a newly sorted Register result',async()=>{
  let reads=0;
  const ordinary=mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation(async(name:string,args:any)=>{
    if(name==='transport_register_query' && !args?.p_option_key){
      reads++;
      if(reads>1)return {data:null,error:{message:'canceling statement due to statement timeout',code:'57014'}};
      return {data:{rows:[{id:'trip-stale',trip_no:'OIC-TEST',trip_date:'2026-10-15',ppr_status:'pending'}],
        count:1,statuses:[],permissions:{customer:true,supplier:true},
        summary:{paper:{received:0,not_received:1}},
        totals:{company_rate:123456,supplier_balance:654321}},error:null};
    }
    return ordinary(name,args);
  });
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('123,456.00');
  const rateHeader=screen.getByTitle('Sort Customer Rate (Net) ascending').closest('th');
  expect(rateHeader?.textContent).toContain('123,456.00');
  fireEvent.click(screen.getByTitle('Sort Customer Rate (Net) ascending'));
  await waitFor(()=>expect(rateHeader?.textContent).toContain('—'));
  expect(rateHeader?.textContent).not.toContain('123,456.00');
  await waitFor(()=>expect(reads).toBeGreaterThan(1));
  expect(rateHeader?.textContent).toContain('—');
 });
 it('distinguishes failed loading from a successfully empty register',async()=>{
  mock.rpc.mockImplementation(async(name:string)=>name==='transport_register_query'?{data:null,error:{message:'Failed to fetch'}}:{data:true,error:null});
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('Register query failed; existing Trips are safe.');expect(screen.queryByText('No trips yet.')).toBeNull();expect(screen.getAllByRole('button',{name:'Retry'}).length).toBeGreaterThan(0);
 });
});


describe('Register manual refresh and saved query results',()=>{
 function cachedRegister(){
  vi.stubEnv('MODE','development');
  const original=mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation(async(name:string,args:any)=>{
   if(name!=='transport_register_query')return original(name,args);
   if(args?.p_option_key)return {data:{options:['Driver','Second Driver']},error:null};
   return {data:{rows:[{id:'cached-trip',trip_no:'CACHE-1',trip_date:'2026-10-15',customer_name:'Cached Customer',
    driver_name:'Driver',vehicle_no:'FLAT-1',customer_rate:1700,from_location:'From',to_location:'To'}],
    count:1,statuses:[],permissions:{customer:true,supplier:true},totals:{company_rate:1700},row_versions:{'cached-trip':'v1'}},error:null};
  });
  return render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
 }
 const registerReads=()=>mock.rpc.mock.calls.filter(([name,args])=>name==='transport_register_query'&&!args?.p_option_key);
 it('keeps the verified Register on navigation and focus until Refresh is requested',async()=>{
  const mounted=cachedRegister();await screen.findByText('Cached Customer');
  expect(registerReads()).toHaveLength(1);
  fireEvent(window,new Event('focus'));fireEvent(document,new Event('visibilitychange'));
  expect(registerReads()).toHaveLength(1);
  mounted.unmount();render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('Cached Customer');expect(registerReads()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
  await waitFor(()=>expect(registerReads()).toHaveLength(2));
  expect(registerReads()[1][1].p_filters).toMatchObject({use_cache:true,refresh:true,known_rows:{'cached-trip':'v1'}});
  expect(screen.getByText('Cached Customer')).toBeTruthy();
 });
 it('reuses a previously loaded sort and retains filter values across reopen',async()=>{
  cachedRegister();await screen.findByText('Cached Customer');
  const sort=screen.getByRole('button',{name:'Customer Rate (Net)'});
  fireEvent.click(sort);await waitFor(()=>expect(registerReads()).toHaveLength(2));
  await waitFor(()=>expect(screen.queryByText('Updating saved results…')).toBeNull());
  fireEvent.click(sort);await waitFor(()=>expect(registerReads()).toHaveLength(3));
  await waitFor(()=>expect(screen.queryByText('Updating saved results…')).toBeNull());
  fireEvent.click(sort);await waitFor(()=>expect(sort.closest('th')?.getAttribute('aria-sort')).toBe('ascending'));
  expect(registerReads()).toHaveLength(3);
  fireEvent.click(screen.getByRole('button',{name:'Filter Driver'}));
  await screen.findByText('2 matching values');
  fireEvent.click(screen.getByRole('button',{name:'Close Driver filter'}));
  fireEvent.click(screen.getByRole('button',{name:'Filter Driver'}));
  await screen.findByText('2 matching values');
  expect(mock.rpc.mock.calls.filter(([name,args])=>name==='transport_register_query'&&args?.p_option_key==='driver')).toHaveLength(1);
 });
 it('merges changed rows by Trip ID and keeps the grid while Refresh is pending',async()=>{
  cachedRegister();await screen.findByText('Cached Customer');
  const original=mock.rpc.getMockImplementation()!;let finish:(result:any)=>void=()=>{};
  mock.rpc.mockImplementation((name:string,args:any)=>name==='transport_register_query'&&args?.p_filters?.refresh
   ?new Promise(resolve=>{finish=resolve;}):original(name,args));
  fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
  await waitFor(()=>expect(registerReads()).toHaveLength(2));
  expect(screen.getByText('Cached Customer')).toBeTruthy();expect(screen.queryByText('Loading trips…')).toBeNull();
  finish({data:{rows_delta:true,rows_order:['cached-trip'],rows:[{id:'cached-trip',trip_no:'CACHE-1',trip_date:'2026-10-15',
   customer_name:'Updated Customer',driver_name:'Driver',vehicle_no:'FLAT-1',customer_rate:1800,from_location:'From',to_location:'To'}],
   count:1,statuses:[],permissions:{customer:true,supplier:true},totals:{company_rate:1800},row_versions:{'cached-trip':'v2'}},error:null});
  await screen.findByText('Updated Customer');expect(screen.queryByText('Cached Customer')).toBeNull();
 });
});

describe('Transport Register workspace isolation',()=>{
 it('immediately removes old-company rows, draft search and dialogs during a company switch',async()=>{
  let resolveOrbit:((value:any)=>void)|null=null;
  mock.rpc.mockImplementation((name:string,args:any)=>{
   if(name==='transport_register_query'&&!args?.p_option_key){
    if(mock.companyId==='orbit')return new Promise(resolve=>{resolveOrbit=resolve;});
    return Promise.resolve({data:{rows:[{id:'tw-row',trip_no:'T-COMPANY',trip_date:'2026-10-15',
     customer_name:'Twakkal customer',status:'draft',ppr_status:'pending'}],count:1,statuses:[],
     permissions:{customer:true,supplier:true},totals:{}},error:null});
   }
   return Promise.resolve({data:true,error:null});
  });
  const app=()=> <MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>;
  const mounted=render(app());
  await screen.findByText('Twakkal customer');
  fireEvent.change(screen.getByRole('textbox',{name:'Search all Trip data'}),{target:{value:'OLD-COMPANY-FILTER'}});
  expect((screen.getByRole('textbox',{name:'Search all Trip data'}) as HTMLInputElement).value).toBe('OLD-COMPANY-FILTER');
  mock.companyId='orbit';mock.businessUnitId='orbit-bu';
  mounted.rerender(app());
  expect(screen.queryByText('Twakkal customer')).toBeNull();
  expect((screen.getByRole('textbox',{name:'Search all Trip data'}) as HTMLInputElement).value).toBe('');
  await waitFor(()=>expect(resolveOrbit).not.toBeNull());
  if(!resolveOrbit)throw new Error('Missing Orbit test response');
  resolveOrbit({data:{rows:[{id:'or-row',trip_no:'O-COMPANY',trip_date:'2026-10-15',
   customer_name:'Orbit customer',status:'draft',ppr_status:'pending'}],count:1,statuses:[],
   permissions:{customer:true,supplier:true},totals:{}},error:null});
  await screen.findByText('Orbit customer');
  expect(screen.queryByText('Twakkal customer')).toBeNull();
  expect(mock.rpc.mock.calls.filter(([name,args])=>name==='transport_register_query'&&!args?.p_option_key)).toHaveLength(2);
 });
});

describe('Trip Register keeps a compact operational toolbar',()=>{
 it('shows essential trip actions without redundant payment or invoice shortcuts',async()=>{
  render(<MemoryRouter initialEntries={['/transport?view=trips']}><TransportWorkspace/></MemoryRouter>);
  expect(await screen.findByRole('button',{name:'Add Trip'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Search Trips'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Filter Trip dates'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Refresh'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Pay Rent to Suppliers'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Receive Customer Payment'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Create Sale Invoice'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Create Purchase Invoice'})).toBeNull();
 });
});
