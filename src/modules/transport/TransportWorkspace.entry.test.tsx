// @vitest-environment jsdom
import {StrictMode} from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportWorkspace from './TransportWorkspace';
import UniversalDataTools from '@/components/UniversalDataTools';
import GlobalLanguageRuntime from '@/components/GlobalLanguageRuntime';
import LanguageRuntime from '@/components/LanguageRuntime';
import JurisdictionRuntime from '@/components/JurisdictionRuntime';
import {MemoryRouter} from 'react-router-dom';
import * as XLSX from 'xlsx';
import {webcrypto} from 'node:crypto';
vi.mock('./transportTripImport',async original=>({...await original<any>(),saveImport:async()=>{},storedImport:async()=>null}));
const mock=vi.hoisted(()=>({rpc:vi.fn(),tables:{} as Record<string,any[]>,allow:true}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'c',membership_role:'company_owner',enabled_modules:['transport']},activeBusinessUnit:{business_unit_id:'b',membership_role:'company_owner',business_unit_type:'transport',enabled_modules:['transport']}})}));
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}})},rpc:(...args:any[])=>{const request=mock.rpc(...args);request.abortSignal=()=>request;return request;},from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,update:()=>q,
 insert:(values:any)=>{const row={...values,id:'added',is_active:true};(mock.tables[table]??=[]).push(row);return {select:()=>({single:async()=>({data:row,error:null})})};},range:()=>Promise.resolve({data:mock.tables[table]??[],error:null}),then:(resolve:any)=>Promise.resolve({data:mock.tables[table]??[],error:null}).then(resolve)};return q;}}}));
vi.mock('./TransportFinancialPanel',()=>({default:()=>null}));vi.mock('./TransportInitialRate',()=>({default:()=>null}));
vi.mock('./TransportCostUpload',()=>({default:()=>null}));vi.mock('./TransportAudit',()=>({default:()=>null}));
vi.mock('./TransportPartyReports',()=>({default:()=>null}));vi.mock('./TransportAccountStatement',()=>({default:()=>null}));
beforeEach(()=>{
 Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
 mock.allow=true;mock.rpc.mockReset();mock.rpc.mockImplementation(async(name:string,args:any)=>({data:name==='transport_register_query'?{rows:[],count:0,statuses:[],permissions:{customer:true,supplier:true},totals:{}}:name==='transport_prepare_trip_import'?{id:'job',completed:0}:name==='transport_import_trip_batch'?args.p_rows.map(()=>({id:'trip',trip_no:'OIC-1'})):name==='transport_create_trips'?[{id:'trip',trip_no:'OIC-1'}]:mock.allow,error:null}));
 mock.tables={customers:[{id:'c1',name:'Customer',is_active:true}],suppliers:[{id:'s',name:'Supplier',is_active:true}],employees:[{id:'e',name:'Employee',is_active:true}],
 transport_truck_types:[{id:'tt',name:'Flatbed',is_active:true},{id:'tt2',name:'Tanker',is_active:true}],
 transport_locations:[{id:'f',name:'From',is_active:true},{id:'t',name:'To',is_active:true}],
 transport_drivers:[{id:'d',driver_name:'Driver',mobile:'12345',driver_type:'company',employee_id:'e',supplier_id:null,is_active:true},{id:'inactive',driver_name:'Inactive Driver',is_active:false}],
 transport_vehicles:[{id:'v',vehicle_no:'FLAT-1',truck_type_id:'tt',is_active:true},{id:'v2',vehicle_no:'TANK-1',truck_type_id:'tt2',is_active:true}],
 transport_vehicle_ownership:[{id:'old',vehicle_id:'v',owner_type:'third_party',supplier_id:'s',owner_name_snapshot:'Supplier',effective_from:'2020-01-01',effective_to:'2026-06-30'},
 {id:'current',vehicle_id:'v',owner_type:'company',supplier_id:null,owner_name_snapshot:'Company',effective_from:'2026-07-01',effective_to:null}]};
});afterEach(cleanup);
async function view(){render(<MemoryRouter initialEntries={["/transport?view=new"]}><TransportWorkspace/></MemoryRouter>);await waitFor(()=>expect(screen.getByRole('button',{name:'Add Truck Type'})).toBeTruthy());await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_finance_allowed',{p_action:'driver'}));}
function choose(placeholder:string,name:string){fireEvent.focus(screen.getByPlaceholderText(placeholder));fireEvent.mouseDown(screen.getByRole('button',{name}));}
async function fill(){await view();choose('Search Customer','Customer');choose('Search From','From');choose('Search To','To');fireEvent.change(screen.getByLabelText('Sale Type'),{target:{value:'credit'}});}
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
 it('clears company Driver Pay when switching to a supplier driver and creates without salary earnings',async()=>{mock.tables.transport_drivers.push({id:'sd',driver_name:'Supplier Driver',driver_type:'supplier',supplier_id:'s',employee_id:null,is_active:true});await fill();choose('Search Driver','Driver');expect((screen.getByLabelText('Driver Pay') as HTMLInputElement).disabled).toBe(false);fireEvent.change(screen.getByLabelText('Driver Pay'),{target:{value:'100'}});choose('Search Driver','Supplier Driver');expect((screen.getByLabelText('Driver Pay') as HTMLInputElement).disabled).toBe(true);expect((screen.getByLabelText('Driver Pay') as HTMLInputElement).value).toBe('');fireEvent.click(screen.getByRole('button',{name:'Create Trip'}));await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_create_trips',expect.objectContaining({p_rows:[expect.objectContaining({driver_id:'sd',driver_pay:null})]})))});
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
 async function upload(sale='Credit',owner='Supplier'){
  await view();fireEvent.click(screen.getByRole('button',{name:'Bulk Upload'}));
  const headers=['DATE','TRUCK TYPE','COMPANY NAME','DRIVER NAME','OWNER','PLATE #','FROM','TO','PAPER RECEIVED BY','DATE','Customer Rate','Supplier Rent','Driver Pay','Sale Type (Cash / Credit)'];
  const row=['2026-06-01','Flatbed','Customer','Driver',owner,'FLAT-1','From','To','PPR PENDING','','1000','300','50',sale];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([headers,row]),'Trips');
  const bytes=XLSX.write(wb,{bookType:'xlsx',type:'array'});const file=new File([bytes],'trip.xlsx');Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes});
  fireEvent.change(screen.getByLabelText(/Select Transport Excel/),{target:{files:[file]}});await screen.findByText('trip.xlsx');
 }
 it('rejects supplier-driver earnings in daily bulk before import',async()=>{mock.tables.transport_drivers[0]={...mock.tables.transport_drivers[0],driver_type:'supplier',employee_id:null,supplier_id:'s'};await upload();expect(screen.getByRole('button',{name:/Import Valid Rows/}).hasAttribute('disabled')).toBe(true);expect(screen.getByTitle(/Driver Pay requires a company driver/)).toBeTruthy();expect(mock.rpc.mock.calls.some(c=>c[0]==='transport_import_trip_batch')).toBe(false)});
 it('rejects bulk invalid Cash/Credit and free-text Owner mismatch',async()=>{
  await upload('Other','Fake Owner');expect(screen.getByRole('button',{name:/Import Valid Rows/}).hasAttribute('disabled')).toBe(true);
  expect(screen.getByTitle(/Sale Type/).getAttribute('title')).toContain('Sale Type');expect(screen.getByTitle(/Sale Type/).getAttribute('title')).toContain('dated ownership');
 });
 it('imports bulk through the same atomic entry RPC with separate rent/pay and no owner text',async()=>{
  vi.spyOn(window,'confirm').mockReturnValue(true);vi.spyOn(window,'alert').mockImplementation(()=>{});await upload();
  fireEvent.click(screen.getByRole('button',{name:/Import Valid Rows/}));await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_import_trip_batch',expect.objectContaining({p_rows:[expect.objectContaining({vehicle_id:'v',supplier_rent:300,driver_pay:50,sale_type:'credit'})]})));
  expect(mock.rpc.mock.calls.find(c=>c[0]==='transport_import_trip_batch')![1].p_rows[0]).not.toHaveProperty('owner_name_snapshot');
 });

});


describe('Transport register server pagination',()=>{
 it('navigates directly to Last and keeps whole filtered totals',async()=>{
  mock.rpc.mockImplementation(async(name:string,args:any)=>({data:name==='transport_register_query'?{rows:[{id:'trip-'+args.p_offset,trip_no:'TRP-'+args.p_offset,trip_date:'2026-10-01',customer_rate:10,status:'draft'}],count:50000,statuses:[],permissions:{customer:true,supplier:true},totals:{company_rate:800000},completed:0,paper_pending:50000}:true,error:null}));
  render(<MemoryRouter><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('TRP-0');expect(screen.getByText(/800,000.00/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Last'}));await screen.findByText('TRP-49500');
  expect(mock.rpc).toHaveBeenCalledWith('transport_register_query',expect.objectContaining({p_limit:500,p_offset:49500}));
  expect(screen.getByText(/800,000.00/)).toBeTruthy();expect(mock.rpc.mock.calls.some(c=>c[0]==='transport_financial_register_page')).toBe(false);
 });
 it('resets to first page and sends searches to the server',async()=>{
  mock.rpc.mockImplementation(async(name:string,args:any)=>({data:name==='transport_register_query'?{rows:args.p_filters?.search?[{id:'found',trip_no:'OFF-PAGE-TRIP',trip_date:'2026-10-01',customer_rate:50,status:'draft'}]:[],count:args.p_filters?.search?1:50000,statuses:[],permissions:{customer:true,supplier:true},totals:{company_rate:args.p_filters?.search?50:800000},completed:0,paper_pending:1}:true,error:null}));
  render(<MemoryRouter><TransportWorkspace/></MemoryRouter>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Last'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Last'}));await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_register_query',expect.objectContaining({p_offset:49500})));
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
 it('keeps both Transport themes and persists the selected register theme',async()=>{
  const key='navilo:transport:trip-theme:user:c:b';localStorage.removeItem(key);
  try{
   render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
   const theme1=await screen.findByRole('button',{name:'Theme 1'}),theme2=screen.getByRole('button',{name:'Theme 2'});
   expect(theme1.getAttribute('aria-pressed')).toBe('true');
   fireEvent.click(theme2);
   expect(theme2.getAttribute('aria-pressed')).toBe('true');expect(localStorage.getItem(key)).toBe('theme2');
   expect(document.querySelector('[data-navilo-transport-register]')?.getAttribute('data-navilo-theme')).toBe('theme2');
   const theme3=screen.getByRole('button',{name:'Theme 3'});fireEvent.click(theme3);
   expect(theme3.getAttribute('aria-pressed')).toBe('true');expect(localStorage.getItem(key)).toBe('theme3');
   expect(document.querySelector('[data-navilo-transport-register]')?.getAttribute('data-navilo-theme')).toBe('theme3');
   const scopedThemeCss=document.querySelector('[data-navilo-transport-register] style')?.textContent??'';
   expect(scopedThemeCss).toContain('Theme 2 — BLUE OPERATIONS / spreadsheet console');
   expect(scopedThemeCss).toContain('Theme 3 — MODERN EXECUTIVE / spacious cards + pills');
   expect(scopedThemeCss).toContain('height: 29px !important');
   expect(scopedThemeCss).toContain('height: 38px !important');
   const theme4=screen.getByRole('button',{name:'Theme 4'});fireEvent.click(theme4);
   expect(theme4.getAttribute('aria-pressed')).toBe('true');expect(localStorage.getItem(key)).toBe('theme4');
   expect(document.querySelector('[data-navilo-transport-register]')?.getAttribute('data-navilo-theme')).toBe('theme4');
   expect(scopedThemeCss).toContain('Theme 4 — CLASSIC LEDGER / serif + ivory + brass');
  }finally{localStorage.removeItem(key);}
 });
 it('shows customer and supplier invoice numbers in their own financial groups',async()=>{
  mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_register_query'?{rows:[{id:'invoice-trip',trip_no:'INV-TRIP',trip_date:'2026-10-01',status:'locked',invoice_no:'TR-S000010',supplier_invoice_no:'TR-P000010'}],count:1,statuses:[],permissions:{customer:true,supplier:true},totals:{}}:true,error:null}));
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  await screen.findByText('INV-TRIP');
  expect(screen.getByTitle('Sort Customer Invoice ascending')).toBeTruthy();
  expect(screen.getByTitle('Sort Supplier Invoice ascending')).toBeTruthy();
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
   await screen.findByTitle('Sort Trip No ascending');fireEvent.click(screen.getByRole('button',{name:'Columns'}));
   const supplier=screen.getAllByText('Supplier Credit / Advance').map(e=>e.closest('div[draggable]')).find(Boolean)!;
   const customer=screen.getAllByText('Customer Credit / Advance').map(e=>e.closest('div[draggable]')).find(Boolean)!;
   expect(supplier.querySelector('input')).toBeTruthy();
   expect((customer.querySelector('input') as HTMLInputElement).checked).toBe(false);
   fireEvent.click(customer.querySelector('input')!);
   expect(await screen.findByTitle('Sort Customer Credit / Advance ascending')).toBeTruthy();
  }finally{localStorage.removeItem(key);}
 });
 it('toggles header ASC/DESC through the server query while retaining the 500 row page limit',async()=>{
  render(<MemoryRouter initialEntries={['/transport']}><TransportWorkspace/></MemoryRouter>);
  const header=await screen.findByTitle('Sort Trip No ascending');fireEvent.click(header);
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_register_query',expect.objectContaining({p_limit:500,p_offset:0,p_sort:'trip_no',p_direction:'asc'})));
  expect(header.closest('th')?.getAttribute('aria-sort')).toBe('ascending');fireEvent.click(header);
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_register_query',expect.objectContaining({p_limit:500,p_offset:0,p_sort:'trip_no',p_direction:'desc'})));
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
  expect((screen.getByLabelText('Trip Date') as HTMLInputElement).disabled).toBe(true);
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
