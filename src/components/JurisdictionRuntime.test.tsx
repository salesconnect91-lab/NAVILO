// @vitest-environment jsdom
import {render,screen,waitFor,cleanup} from '@testing-library/react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import JurisdictionRuntime from './JurisdictionRuntime';
import {formatCurrency} from './ui';
const mocks=vi.hoisted(()=>({company:'a',base:'SAR'}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:mocks.company}})}));
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getSession:async()=>({data:{session:{}}})},from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null,error:null}),single:async()=>({data:table==='companies'?{base_currency_code:mocks.base}:null,error:null})};return q;}}}));
afterEach(()=>{cleanup();mocks.company='a';mocks.base='SAR';});
function Report(){return <p>{formatCurrency(1234.5)} · USD 25.00</p>}
describe('company report currency',()=>{
 it('loads canonical base currency without settings and preserves source USD',async()=>{
 render(<JurisdictionRuntime><Report/></JurisdictionRuntime>);
 await screen.findByText('SAR 1,234.50 · USD 25.00');
 expect(document.documentElement.dataset.naviloCurrency).toBe('SAR');
 });
 it('reloads canonical currency when company changes',async()=>{
 const view=render(<JurisdictionRuntime><Report/></JurisdictionRuntime>);
 await screen.findByText('SAR 1,234.50 · USD 25.00');
 mocks.company='b';mocks.base='AED';view.rerender(<JurisdictionRuntime><Report/></JurisdictionRuntime>);
 await waitFor(()=>expect(screen.getByText('AED 1,234.50 · USD 25.00')).toBeTruthy());
 });
});
