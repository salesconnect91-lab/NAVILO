// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import SalesInvoiceCreate from '../sales/SalesInvoiceCreate';
import PurchaseInvoiceCreate from '../purchase/MainPurchaseInvoiceV2';
const mock=vi.hoisted(()=>({type:'transport',from:vi.fn()}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeBusinessUnit:{business_unit_id:'b',business_unit_type:mock.type}})}));
vi.mock('./TransportInvoiceCreate',()=>({default:({side}:{side:string})=><div>Trip service invoice: {side}</div>}));
vi.mock('@/lib/supabase',()=>({supabase:{from:(table:string)=>{mock.from(table);const q:any={};for(const key of ['select','eq','order','range','in','limit','single','maybeSingle'])q[key]=()=>q;q.then=(resolve:any)=>Promise.resolve({data:[],error:null}).then(resolve);return q},rpc:async()=>({data:null,error:null})}}));
beforeEach(()=>{mock.type='transport';mock.from.mockClear()});afterEach(cleanup);
describe('Business-unit invoice route isolation',()=>{
 it('uses Trip services on Transport Sales without querying inventory',()=>{render(<MemoryRouter><SalesInvoiceCreate/></MemoryRouter>);expect(screen.getByText('Trip service invoice: customer')).toBeTruthy();expect(mock.from).not.toHaveBeenCalled()});
 it('uses Trip rents on Transport Purchase without querying inventory',()=>{render(<MemoryRouter><PurchaseInvoiceCreate/></MemoryRouter>);expect(screen.getByText('Trip service invoice: supplier')).toBeTruthy();expect(mock.from).not.toHaveBeenCalled()});
 it('retains the existing Steel Sales editor',()=>{mock.type='steel';render(<MemoryRouter><SalesInvoiceCreate/></MemoryRouter>);expect(screen.getByText('New Sales Invoice')).toBeTruthy();expect(screen.queryByText('Trip service invoice: customer')).toBeNull()});
 it('retains the existing Steel Purchase editor',()=>{mock.type='steel';render(<MemoryRouter><PurchaseInvoiceCreate/></MemoryRouter>);expect(screen.getByText('Main Purchase Invoice')).toBeTruthy();expect(screen.queryByText('Trip service invoice: supplier')).toBeNull()});
});
