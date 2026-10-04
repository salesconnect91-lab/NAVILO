// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import TransportVatPreview,{vatPreviewAmounts} from './TransportVatPreview';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'company-a'}})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc}}));
afterEach(()=>{cleanup();mock.rpc.mockReset()});
it('rounds each invoice VAT before adding batch totals',()=>{expect(vatPreviewAmounts([0.03,0.03],18)).toEqual({net:0.06,vat:0.02,total:0.08})});
it('keeps without-VAT preview free of tax queries',()=>{render(<TransportVatPreview side="customer" date="2026-10-04" withTax={false} amounts={[100]}/>);expect(screen.getByText(/Net: 100.00/)).toBeTruthy();expect(mock.rpc).not.toHaveBeenCalled()});
it('uses the supplier invoice date and purchase context then invalidates a stale preview',async()=>{
 mock.rpc.mockResolvedValueOnce({data:18,error:null}).mockResolvedValueOnce({data:null,error:null});const ready=vi.fn();
 const r=render(<TransportVatPreview side="supplier" date="2026-10-04" withTax amounts={[100,50]} onReady={ready}/>);
 await screen.findByText(/VAT 18%: 27.00/);expect(mock.rpc).toHaveBeenCalledWith('fixed_tax_rate_on',{p_company:'company-a',p_context:'purchase',p_date:'2026-10-04'});expect(ready).toHaveBeenLastCalledWith(true);
 r.rerender(<TransportVatPreview side="supplier" date="2026-10-05" withTax amounts={[100,50]} onReady={ready}/>);
 await screen.findByText(/Configure an effective fixed VAT rate/);expect(ready).toHaveBeenLastCalledWith(false);
});
it('fails closed on an unavailable tax lookup instead of displaying zero VAT',async()=>{mock.rpc.mockRejectedValue(new Error('Unavailable'));const ready=vi.fn();render(<TransportVatPreview side="customer" date="2026-10-04" withTax amounts={[100]} onReady={ready}/>);await screen.findByText('Unavailable');await waitFor(()=>expect(ready).toHaveBeenLastCalledWith(false));expect(screen.queryByText(/Total including VAT:/)).toBeNull()});
