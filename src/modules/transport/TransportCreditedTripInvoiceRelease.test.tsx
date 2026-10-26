// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportCreditedTripInvoiceRelease from './TransportCreditedTripInvoiceRelease';

const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./TransportDialog',()=>({default:({children}:any)=><div>{children}</div>}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc}}));

const balance={original_gross:1150,credited_gross:1150,outstanding_gross:0,paid_gross:0,refunded_gross:0} as any;
const baseProps={order:{id:'invoice-1',order_no:'TEST-INV-1',status:'posted'},trips:[{trip_no:'TEST-TRIP-1'}],lineCount:1,chargesCount:0,balance,transportAttributed:true,cash:false,onReleased:vi.fn()};

beforeEach(()=>{
 mock.rpc.mockReset().mockImplementation(async(name:string)=>name==='transport_admin_invoice_trip_release_access'
  ?{data:true,error:null}
  :{data:{success:true,invoice_no:'TEST-INV-1',trip_no:'TEST-TRIP-1'},error:null});
 vi.stubGlobal('confirm',vi.fn(()=>true));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

it.each([
 ['customer','transport_admin_release_credited_trip_invoice','credited'],
 ['supplier','transport_admin_release_debited_supplier_trip_invoice','debited'],
] as const)('releases an eligible %s Trip link after its note, preserving invoice history',async(side,rpcName,noteWord)=>{
 const onReleased=vi.fn();
 render(<TransportCreditedTripInvoiceRelease {...baseProps} side={side} onReleased={onReleased}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Release Trip Link'}));
 expect(screen.getByText(`This fully ${noteWord} invoice and its note will stay in audit history. Releasing only the Trip Register link makes the Trip available for a new invoice number.`)).toBeTruthy();
 const reason=screen.getByRole('textbox',{name:'Trip link release reason'});
 const confirm=screen.getByRole('button',{name:'Confirm Trip Link Release'}) as HTMLButtonElement;
 expect(confirm.disabled).toBe(true);
 fireEvent.change(reason,{target:{value:'Full note issued; corrected invoice needed'}});
 expect(confirm.disabled).toBe(false);
 fireEvent.click(confirm);
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith(rpcName,{p_order_id:'invoice-1',p_reason:'Full note issued; corrected invoice needed'}));
 expect(window.confirm).toHaveBeenCalledWith(`Release Trip TEST-TRIP-1 from invoice TEST-INV-1? The invoice, journal and ${side==='customer'?'credit':'debit'} note remain in history.`);
 await waitFor(()=>expect(onReleased).toHaveBeenCalledWith('TEST-INV-1','TEST-TRIP-1'));
});

it.each([
 ['unpaid balance',{...balance,credited_gross:0,outstanding_gross:1150}],
 ['partial note',{...balance,credited_gross:575,outstanding_gross:575}],
 ['paid invoice',{...balance,paid_gross:1150}],
 ['cash customer',balance],
] as const)('hides release for an ineligible customer invoice: %s',async(label,blockedBalance)=>{
 render(<TransportCreditedTripInvoiceRelease {...baseProps} side="customer" balance={blockedBalance} cash={label==='cash customer'}/>);
 await waitFor(()=>expect(mock.rpc).not.toHaveBeenCalledWith('transport_admin_invoice_trip_release_access'));
 expect(screen.queryByRole('button',{name:'Release Trip Link'})).toBeNull();
});

it('hides release when Admin permission is denied',async()=>{
 mock.rpc.mockResolvedValue({data:false,error:null});
 render(<TransportCreditedTripInvoiceRelease {...baseProps} side="supplier"/>);
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_admin_invoice_trip_release_access'));
 expect(screen.queryByRole('button',{name:'Release Trip Link'})).toBeNull();
});
