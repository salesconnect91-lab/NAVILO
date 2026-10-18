// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import TransportNormalInvoiceCreate,{validateNormalInvoiceLines} from './TransportNormalInvoiceCreate';
const mock=vi.hoisted(()=>({company:'a',bu:'a-bu',calls:[] as Array<{table:string;filters:Record<string,any>}>,
 posts:[] as any[],reject:false,unlinked:false}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({
 activeCompany:{company_id:mock.company},
 activeBusinessUnit:{business_unit_id:mock.bu,business_unit_type:'transport'}
})}));
vi.mock('@/components/NaviloDateInput',()=>({default:({value,onChange,...props}:any)=><input type="date" value={value} onChange={onChange} {...props}/>}));
vi.mock('@/components/SearchableSelect',()=>({default:({children,nativeCompatibility,preserveLabel,...props}:any)=><select {...props}>{children}</select>}));
vi.mock('@/lib/supabase',()=>({supabase:{
 rpc:async(name:string,args:any)=>{
  if(name!=='transport_normal_invoice_create')throw new Error('Unexpected RPC '+name);
  mock.posts.push(args);
  if(mock.reject)return {data:null,error:{message:'Finance posting permission required'}};
  return {data:{document_id:'doc-1',invoice_no:args.p_invoice_no||'AUTO-1',gross:325,status:args.p_post?'posted':'draft'},error:null};
 },
 from:(table:string)=>{
  const filters:Record<string,any>={};
  const q:any={
   select:()=>q,eq:(key:string,val:any)=>{filters[key]=val;return q;},
   order:()=>q,limit:()=>q,range:()=>q,
   maybeSingle:async()=>{mock.calls.push({table,filters:{...filters}});return {data:{account_id:mock.company+'-account'},error:null};},
   then:(cb:any)=>{
    mock.calls.push({table,filters:{...filters}});
    if(table==='transport_vehicles')return Promise.resolve({data:[{id:mock.company+'-vehicle-1',vehicle_no:'7979',revenue_account_id:mock.unlinked?null:mock.company+'-account'},{id:mock.company+'-vehicle-2',vehicle_no:'7494',revenue_account_id:mock.company+'-account'}],error:null}).then(cb);
    if(table==='transport_vehicle_ownership')return Promise.resolve({data:[{vehicle_id:mock.company+'-vehicle-1',owner_type:'company',effective_from:'2020-01-01',effective_to:null},{vehicle_id:mock.company+'-vehicle-2',owner_type:'company',effective_from:'2020-01-01',effective_to:null}],error:null}).then(cb);
    if(table==='customers'||table==='suppliers')
     return Promise.resolve({data:[{id:mock.company+'-party',name:'Master '+mock.company}],error:null}).then(cb);
    if(table==='chart_of_accounts')
     return Promise.resolve({data:[{id:mock.company+'-account',name:'Account '+mock.company}],error:null}).then(cb);
    throw new Error('Unknown table '+table);
   }
  };return q;
 }
}}));
beforeEach(()=>{mock.company='a';mock.bu='a-bu';mock.calls=[];mock.posts=[];mock.reject=false;mock.unlinked=false});
afterEach(cleanup);
const load=async(side:'customer'|'supplier')=>{
 const ui=render(<MemoryRouter><TransportNormalInvoiceCreate side={side}/></MemoryRouter>);
 await waitFor(()=>expect((screen.getByRole('combobox',{name:'Normal invoice ledger account'}) as HTMLSelectElement).value).toBe('a-account'));
 return ui;
};
describe('Normal Transport Sales and Purchase UI, without Trip linkage',()=>{
 it('posts manual multi-description customer Sales using company Master/account',async()=>{
  await load('customer');
  fireEvent.change(screen.getByRole('combobox',{name:'Normal invoice customer'}),{target:{value:'a-party'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Description 1'}),{target:{value:'Additional service'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Amount 1'}),{target:{value:'300.00'}});
  fireEvent.click(screen.getByRole('button',{name:'+ Description Line'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Description 2'}),{target:{value:'Service fee'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Amount 2'}),{target:{value:'25'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Normal invoice number'}),{target:{value:'INV-PRIVATE-01'}});
  fireEvent.click(screen.getByRole('button',{name:'Post Sale Invoice'}));
  await screen.findByText(/Sale invoice posted/);
  expect(mock.posts).toHaveLength(1);
  expect(mock.posts[0]).toEqual(expect.objectContaining({
   p_side:'customer',p_party:'a-party',p_account:'a-account',p_invoice_no:'INV-PRIVATE-01',
   p_post:true,p_lines:[{description:'Additional service',amount:'300.00'},{description:'Service fee',amount:'25'}],
  }));
  expect(Object.keys(mock.posts[0]).some(x=>x.includes('trip'))).toBe(false);
 });
 it('keeps multiple vehicle allocations on separate description lines in one invoice',async()=>{
  await load('customer');await screen.findByRole('option',{name:/7979/});
  fireEvent.change(screen.getByRole('combobox',{name:'Normal invoice customer'}),{target:{value:'a-party'}});
  fireEvent.change(screen.getByLabelText('Description 1'),{target:{value:'Vehicle one'}});fireEvent.change(screen.getByLabelText('Amount 1'),{target:{value:'100'}});fireEvent.change(screen.getByLabelText('Vehicle 1'),{target:{value:'a-vehicle-1'}});
  fireEvent.click(screen.getByRole('button',{name:'+ Description Line'}));fireEvent.change(screen.getByLabelText('Description 2'),{target:{value:'Vehicle two'}});fireEvent.change(screen.getByLabelText('Amount 2'),{target:{value:'200'}});fireEvent.change(screen.getByLabelText('Vehicle 2'),{target:{value:'a-vehicle-2'}});
  fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));await screen.findByText(/Sale invoice draft/);
  expect(mock.posts[0].p_lines).toEqual([{description:'Vehicle one',amount:'100',vehicle_id:'a-vehicle-1'},{description:'Vehicle two',amount:'200',vehicle_id:'a-vehicle-2'}]);
  expect(mock.posts).toHaveLength(1);
 });
 it('posts with common Revenue even when dedicated Income account is absent',async()=>{
  mock.unlinked=true;
  await load('customer');await screen.findByRole('option',{name:/7979/});
  fireEvent.change(screen.getByRole('combobox',{name:'Normal invoice customer'}),{target:{value:'a-party'}});
  fireEvent.change(screen.getByLabelText('Description 1'),{target:{value:'Vehicle income'}});
  fireEvent.change(screen.getByLabelText('Amount 1'),{target:{value:'100'}});
  fireEvent.change(screen.getByLabelText('Vehicle 1'),{target:{value:'a-vehicle-1'}});
  expect(screen.queryByText(/Vehicle 7979 has no linked Income COA/)).toBeNull();
  expect((screen.getByRole('button',{name:'Post Sale Invoice'}) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Post Sale Invoice'}));
  await screen.findByText(/Sale invoice posted/);
  expect(mock.posts).toHaveLength(1);
  expect(mock.posts[0].p_account).toBe('a-account');
  expect(mock.posts[0].p_lines[0].vehicle_id).toBe('a-vehicle-1');
 });
 it('saves supplier Purchase draft through same canonical service model',async()=>{
  await load('supplier');
  fireEvent.change(screen.getByRole('combobox',{name:'Normal invoice supplier'}),{target:{value:'a-party'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Description 1'}),{target:{value:'Admin purchase'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Amount 1'}),{target:{value:'50'}});
  fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));
  await screen.findByText(/Purchase invoice draft/);
  expect(mock.posts[0]).toEqual(expect.objectContaining({p_side:'supplier',p_post:false,p_account:'a-account'}));
  expect(screen.getByRole('link',{name:'View Invoice'}).getAttribute('href')).toBe('/purchase/doc-1');
 });
 it('keeps each company\'s Master/account isolated on company switch',async()=>{
  const view=await load('customer');
  mock.company='b';mock.bu='b-bu';
  view.rerender(<MemoryRouter><TransportNormalInvoiceCreate side="customer"/></MemoryRouter>);
  await waitFor(()=>expect((screen.getByRole('combobox',{name:'Normal invoice ledger account'}) as HTMLSelectElement).value).toBe('b-account'));
  expect(screen.queryByRole('option',{name:'Master a'})).toBeNull();
  expect(mock.calls.filter(x=>x.table==='chart_of_accounts').every(x=>x.filters.company_id=== 'a'||x.filters.company_id==='b')).toBe(true);
  expect((screen.getByRole('combobox',{name:'Normal invoice customer'}) as HTMLSelectElement).value).toBe('');
 });
 it('does not claim posting when canonical RPC denies permission',async()=>{
  mock.reject=true;await load('customer');
  fireEvent.change(screen.getByRole('combobox',{name:'Normal invoice customer'}),{target:{value:'a-party'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Description 1'}),{target:{value:'Service'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Amount 1'}),{target:{value:'30'}});
  fireEvent.click(screen.getByRole('button',{name:'Post Sale Invoice'}));
  expect((await screen.findByRole('alert')).textContent).toContain('permission');
  expect(mock.posts).toHaveLength(1);
  expect(screen.queryByText(/Sale invoice posted/)).toBeNull();
 });
 it('rejects missing/invalid description and amount',()=>{
  expect(validateNormalInvoiceLines([{description:'',amount:'3'}])).toMatch(/description/);
  expect(validateNormalInvoiceLines([{description:'Fine',amount:'3.777'}])).toMatch(/2 decimals/);
  expect(validateNormalInvoiceLines([{description:'Fine',amount:'4.00'}])).toBeNull();
 });
});
