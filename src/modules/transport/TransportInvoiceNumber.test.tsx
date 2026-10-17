// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportInvoiceNumber,{invoicePostingBlockers,isValidTransportOriginalInvoice} from './TransportInvoiceNumber';

const mock=vi.hoisted(()=>({
 company:'tw',bu:'tw-bu',permission:true,
 rates:{tw:null,or:15,go:null} as Record<string,number|null>,
 requests:[] as Array<{table:string;filters:Record<string,unknown>}>,
 posts:[] as any[],
}));
const names=[{id:'tw',bu:'tw-bu',name:'Twakkal Al Khaleej'},
 {id:'or',bu:'or-bu',name:'Orbit - Usman Sajjad'},
 {id:'go',bu:'go-bu',name:'GONDAL TRANSPORT'}];
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({
 activeCompany:{company_id:mock.company},
 activeBusinessUnit:{business_unit_id:mock.bu},
})}));
vi.mock('./TransportDialog',()=>({default:({children}:any)=><div>{children}</div>}));
vi.mock('@/components/SearchableSelect',()=>({default:({children,nativeCompatibility,preserveLabel,...rest}:any)=>
 <select {...rest}>{children}</select>}));
vi.mock('@/components/NaviloDateInput',()=>({default:({value,onChange,...rest}:any)=>
 <input {...rest} value={value} onChange={onChange}/>}));
vi.mock('@/lib/supabase',()=>({supabase:{
 rpc:async(name:string,args:any)=>{
  if(name==='transport_finance_allowed')return {data:mock.permission,error:null};
  if(name==='fixed_tax_rate_on')return {data:mock.rates[args.p_company]??null,error:null};
  if(name==='transport_post_customer_bill_accounted'){
   mock.posts.push(args);
   return {data:{document_id:'new-bill'},error:null};
  }
  throw new Error('Unexpected RPC '+name);
 },
 from:(table:string)=>{
  const filters:Record<string,unknown>={};
  const q:any={
   select:()=>q,
   eq:(field:string,val:any)=>{filters[field]=val;return q;},
   order:()=>q,
   limit:()=>q,
   maybeSingle:async()=>{
    mock.requests.push({table,filters:{...filters}});
    return {data:table==='account_mappings'&&filters.company_id
     ?{account_id:String(filters.company_id)+'-rev'}:null,error:null};
   },
   then:(resolve:any)=>{
    mock.requests.push({table,filters:{...filters}});
    const all=names.map(c=>({id:c.id+'-rev',name:'Service Revenue '+c.name,company_id:c.id,is_active:true,is_group:false,type:'revenue'}));
    return Promise.resolve({data:all.filter(row=>Object.entries(filters).every(([key,val])=>(row as any)[key]===val)),error:null}).then(resolve);
   },
  };
  return q;
 }
}}));
const trip=(sale_type:'cash'|'credit'='credit')=>({
 id:'trip-1',trip_no:'1001',customer_name:'Customer A',
 customer_rate_state:'finalized' as const,customer_rate:1000,
 sale_type,from_location:'A',to_location:'B',
});
beforeEach(()=>{
 mock.company='tw';mock.bu='tw-bu';mock.permission=true;
 mock.rates={tw:null,or:15,go:null};mock.requests=[];mock.posts=[];
});
afterEach(cleanup);
const mount=(sale_type:'cash'|'credit'='credit')=>{
 const onClose=vi.fn();const onChanged=vi.fn(async()=>{});
 const view=render(<TransportInvoiceNumber trip={trip(sale_type)} onClose={onClose} onChanged={onChanged}/>);
 return {view,onClose,onChanged};
};
async function readyAccount(company:string){
 await waitFor(()=>expect((screen.getByRole('combobox',{name:'Revenue account'}) as HTMLSelectElement).value).toBe(company+'-rev'));
}

describe('Transport invoice posting in all company contexts',()=>{
 it.each(names)('uses only $name revenue accounts and defaults to that company mapping',async c=>{
  mock.company=c.id;mock.bu=c.bu;
  mount();
  await readyAccount(c.id);
  const selector=screen.getByRole('combobox',{name:'Revenue account'});
  expect(screen.getByRole('option',{name:'Service Revenue '+c.name})).toBeTruthy();
  expect(screen.queryAllByRole('option').filter(o=>/Service Revenue/.test(o.textContent??''))).toHaveLength(1);
  const queries=mock.requests.filter(x=>x.table==='chart_of_accounts'||x.table==='account_mappings');
  expect(queries).toHaveLength(2);
  expect(queries.every(q=>q.filters.company_id===c.id)).toBe(true);
  expect((selector as HTMLSelectElement).value).toBe(c.id+'-rev');
 });
 it('blocks a Twakkal credit invoice when tax rate is missing, explaining the reason',async()=>{
  mount();
  await readyAccount('tw');
  fireEvent.change(screen.getByRole('combobox',{name:'Invoice number method'}),{target:{value:'manual'}});
  fireEvent.change(screen.getByLabelText('Your Invoice Number'),{target:{value:'ORIG-123'}});
  const requirements=screen.getByRole('status',{name:'Invoice posting requirements'});
  await waitFor(()=>expect(requirements.textContent).toContain('Effective Sales VAT is unavailable'));
  expect((screen.getByRole('button',{name:'Post Invoice'}) as HTMLButtonElement).disabled).toBe(true);
  expect(mock.posts).toHaveLength(0);
 });
 it('posts an Orbit credit invoice only with its original number and its revenue account',async()=>{
  mock.company='or';mock.bu='or-bu';
  const {onClose,onChanged}=mount();
  await readyAccount('or');
  await screen.findByText(/VAT 15%/);
  fireEvent.change(screen.getByRole('combobox',{name:'Invoice number method'}),{target:{value:'manual'}});
  fireEvent.change(screen.getByLabelText('Your Invoice Number'),{target:{value:'ORIG-2026-99'}});
  const post=screen.getByRole('button',{name:'Post Invoice'});
  await waitFor(()=>expect((post as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(post);
  await waitFor(()=>expect(onClose).toHaveBeenCalledTimes(1));
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(mock.posts).toHaveLength(1);
  expect(mock.posts[0]).toEqual(expect.objectContaining({
   p_trip_id:'trip-1',p_revenue_account_id:'or-rev',p_with_tax:true,p_invoice_no:'ORIG-2026-99',
  }));
 });
 it('allows Cash auto numbering without VAT configuration and never invents a Credit invoice reference',async()=>{
  const {onClose}=mount('cash');
  await readyAccount('tw');
  fireEvent.change(screen.getByRole('combobox',{name:'Invoice number method'}),{target:{value:'auto'}});
  await waitFor(()=>expect((screen.getByRole('button',{name:'Post Invoice'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Post Invoice'}));
  await waitFor(()=>expect(onClose).toHaveBeenCalled());
  expect(mock.posts).toHaveLength(1);
  expect(mock.posts[0]).toEqual(expect.objectContaining({p_revenue_account_id:'tw-rev',p_with_tax:false,p_invoice_no:null}));
 });
 it('never offers a duplicate post after a successful invoice when register refresh fails',async()=>{
  const onClose=vi.fn();
  const onChanged=vi.fn(async()=>{throw new Error('Register timed out')});
  render(<TransportInvoiceNumber trip={trip('cash')} onClose={onClose} onChanged={onChanged}/>);
  await readyAccount('tw');
  fireEvent.change(screen.getByRole('combobox',{name:'Invoice number method'}),{target:{value:'auto'}});
  await waitFor(()=>expect((screen.getByRole('button',{name:'Post Invoice'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Post Invoice'}));
  await screen.findByText(/Invoice POSTED successfully, but Register refresh failed/);
  expect(mock.posts).toHaveLength(1);
  expect(screen.queryByRole('button',{name:'Post Invoice'})).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  expect(onChanged).toHaveBeenCalledTimes(1);
 });
 it('does not enable posting for a user without billing permission',async()=>{
  mock.permission=false;mount('cash');
  await readyAccount('tw');
  fireEvent.change(screen.getByRole('combobox',{name:'Invoice number method'}),{target:{value:'auto'}});
  expect(screen.getByRole('status',{name:'Invoice posting requirements'}).textContent).toContain('Billing/post permission');
  expect((screen.getByRole('button',{name:'Post Invoice'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it('drops the old company account on a workspace switch',async()=>{
  const a=mount('cash');await readyAccount('tw');
  mock.company='or';mock.bu='or-bu';
  a.view.rerender(<TransportInvoiceNumber trip={trip('cash')} onClose={a.onClose} onChanged={a.onChanged}/>);
  expect((screen.getByRole('combobox',{name:'Revenue account'}) as HTMLSelectElement).value).toBe('');
  await readyAccount('or');
  expect(screen.queryByRole('option',{name:'Service Revenue Twakkal Al Khaleej'})).toBeNull();
 });
 it('rejects H-S and remark invoice references before RPC',()=>{
  for(const bad of ['H-S-001','h-s-001','YES','CLEARED','CLEARED ASAD','CLERAED','NO INVOICE','BAD DEBTS','ADJUSTED WITH RECEIPT','INVOICE ADJUSTED','PENDING','N/A','0'])
   expect(isValidTransportOriginalInvoice(bad)).toBe(false);
  expect(isValidTransportOriginalInvoice('INV-2501')).toBe(true);
  const base={posted:false,loading:false,allowed:true,rateReady:true,
   mode:'manual' as const,number:'H-S-123',date:'2026-10-17',account:'tw-rev',
   vatReady:true,withTax:true,validSaleType:true};
  expect(invoicePostingBlockers(base)).toContain('Enter a genuine original invoice number (not H-S, YES or a settlement remark).');
 });
});
