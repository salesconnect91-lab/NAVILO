// @vitest-environment jsdom
import {useState} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportReasonSelect from './TransportReasonSelect';
import type {TransportReasonKind} from './transportRateReasons';
vi.mock('@/components/SearchableSelect',()=>({default:({nativeCompatibility,preserveLabel,children,...props}:any)=><select {...props}>{children}</select>}));
afterEach(cleanup);
function Form({initial='',disabled=false,kind='customer_rate'}:{initial?:string;disabled?:boolean;kind?:TransportReasonKind}){
 const [reason,setReason]=useState(initial);
 return <><TransportReasonSelect kind={kind} value={reason} onChange={setReason} disabled={disabled}/><output aria-label="Audit value">{reason}</output></>;
}
it('prefills an editable audit reason without any Save action',async()=>{
 render(<Form/>);
 await waitFor(()=>expect(screen.getByLabelText('Audit value').textContent).toBe('Customer rate updated'));
 expect((screen.getByLabelText('Reason selection') as HTMLSelectElement).value).toBe('Customer rate updated');
 fireEvent.change(screen.getByLabelText('Reason selection'),{target:{value:'Rate entered incorrectly'}});
 expect(screen.getByLabelText('Audit value').textContent).toBe('Rate entered incorrectly');
});
it('keeps Other empty until the user supplies their own reason',async()=>{
 render(<Form/>);
 fireEvent.change(screen.getByLabelText('Reason selection'),{target:{value:'__other__'}});
 await waitFor(()=>expect(screen.getByLabelText('Audit value').textContent).toBe(''));
 fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Customer-specific correction'}});
 expect(screen.getByLabelText('Audit value').textContent).toBe('Customer-specific correction');
 fireEvent.change(screen.getByLabelText('Reason'),{target:{value:''}});
 expect(screen.getByLabelText('Audit value').textContent).toBe('');
});
it('preserves an existing custom audit reason',()=>{
 render(<Form initial="Existing explanation"/>);
 expect(screen.getByLabelText('Audit value').textContent).toBe('Existing explanation');
 expect((screen.getByLabelText('Reason selection') as HTMLSelectElement).value).toBe('__other__');
});

it('uses the new action default when a Register panel switches context',async()=>{
 const {rerender}=render(<Form/>);
 await waitFor(()=>expect(screen.getByLabelText('Audit value').textContent).toBe('Customer rate updated'));
 rerender(<Form kind="supplier_rate"/>);
 await waitFor(()=>expect(screen.getByLabelText('Audit value').textContent).toBe('Supplier rent updated'));
});
