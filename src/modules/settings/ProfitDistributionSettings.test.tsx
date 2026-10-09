// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import ProfitDistributionSettings from './ProfitDistributionSettings';
const {rpc,from}=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'c'},activeBusinessUnit:{id:'b',business_unit_type:'transport'},accessContext:{current_operating_location:{id:'loc',name:'Head Office'}}})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc,from}}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const preview={net_profit:700,source_hash:'verified',draft_count:0,historical_opening:false,ready:true,closure:null,accounts:[{account_id:'income',name:'Income',net_debit:-1000},{account_id:'expense',name:'Expense',net_debit:300}]};
function setup(p=preview){
 rpc.mockReset();rpc.mockImplementation((name)=>Promise.resolve({data:name==='transport_close_profit_month'?{entry_no:'MPC-TEST'}:p}));
 const query:any={};for(const method of ['select','eq'])query[method]=()=>query;
 query.order=()=>Promise.resolve({data:[{id:'equity',code:'3200',name:'Undistributed Profit'},{id:'aug',code:'3201',name:'August 2026 Undistributed Profit'}]});from.mockReturnValue(query);
 render(<MemoryRouter><ProfitDistributionSettings/></MemoryRouter>);
}
it('requires expense review and an equity account, confirms closing and never allocates partner profit',async()=>{
 setup();await screen.findByText(/Net profit \/ \(loss\): 700.00/);
 expect((screen.getByRole('button',{name:'Close Month'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.queryByRole('option',{name:/August/})).toBeNull();
 fireEvent.change(screen.getByLabelText('Undistributed Profit account'),{target:{value:'equity'}});
 fireEvent.click(screen.getByRole('checkbox'));
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 fireEvent.click(screen.getByRole('button',{name:'Close Month'}));expect(rpc.mock.calls.some(x=>x[0]==='transport_close_profit_month')).toBe(false);
 confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Close Month'}));
 await screen.findByRole('status');
 expect(rpc.mock.calls.find(x=>x[0]==='transport_close_profit_month')?.[1]).toMatchObject({p_account_id:'equity',p_source_hash:'verified'});
 expect(rpc.mock.calls.some(x=>String(x[0]).includes('distribution'))).toBe(false);
});
it('historical opening cannot be closed again',async()=>{
 setup({...preview,historical_opening:true,ready:false});await screen.findByText(/Historical opening profit is already recorded/);
 expect(screen.queryByRole('button',{name:'Close Month'})).toBeNull();
});
it('already closed month exposes history without a second post button',async()=>{
 setup({...preview,ready:false,closure:{net_profit:700,journal_entry_id:'j'}} as any);
 await screen.findByText(/Already closed/);expect(screen.queryByRole('button',{name:'Close Month'})).toBeNull();
});
