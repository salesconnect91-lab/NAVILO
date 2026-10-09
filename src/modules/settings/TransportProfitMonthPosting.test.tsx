// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportProfitMonthPosting from './TransportProfitMonthPosting';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'company'},activeBusinessUnit:{business_unit_id:'unit'}})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const active={id:'rule',method:'fixed_percentage',effective_from:'2026-08-01',shares:[{account_id:'a',name:'A',percentage:50},{account_id:'b',name:'B',percentage:50}]};
const info={rule_id:'rule',method:'fixed_percentage',record:null,posted_net_profit:80,posted_source_lines:2,source_gl_account_id:'opening',source_kind:'historical_opening',source_account_name:'August Undistributed Profit',allocations:null,month_ended:true,posting_enabled:true};
it('uses verified opening NET once while keeping reconciliation evidence editable',async()=>{
 rpc.mockResolvedValue({data:info});render(<TransportProfitMonthPosting month="2026-08" active={active}/>);
 const own=screen.getByLabelText('Reviewed own-fleet net profit') as HTMLInputElement;
 await waitFor(()=>expect(own.value).toBe('80'));expect(own.disabled).toBe(true);
 const evidence=screen.getByLabelText('Reconciliation evidence / approval reference') as HTMLTextAreaElement;
 expect(evidence.disabled).toBe(false);fireEvent.change(evidence,{target:{value:'approved opening reference'}});
 expect((screen.getByRole('button',{name:'1. Save / Update Draft'}) as HTMLButtonElement).disabled).toBe(false);
 expect(screen.getByText('August Undistributed Profit')).toBeTruthy();
});
it.each([false,true])('preserves source history and reports remainder after posted/reversed transfer: reversal %s',async reversed=>{
 rpc.mockImplementation(name=>Promise.resolve({data:name==='transport_profit_month_reversal_info'?(reversed?{id:'reversal',reversal_journal_entry_id:'r',reversed_on:'2026-10-09',reason:'correction'}:null):{...info,record:{id:'review',status:'posted',own_fleet_profit:80,twakkal_profit:0,total_profit:80,source_note:'approved opening reference',created_by:'owner',journal_entry_id:'j'}}}));
 render(<TransportProfitMonthPosting month="2026-08" active={active}/>);
 await screen.findByText(/Original distribution posted and locked/);
 await waitFor(()=>{
  const source=screen.getByText(/Undistributed for this review:/);
  expect(source.textContent).toContain(reversed?'80.00':'0.00');
 });
 expect(screen.getByText('Historical fleet net profit')).toBeTruthy();
});
