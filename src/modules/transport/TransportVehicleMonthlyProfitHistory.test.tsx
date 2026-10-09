// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import TransportVehicleMonthlyProfitHistory from './TransportVehicleMonthlyProfitHistory';

const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'company'},activeBusinessUnit:{business_unit_id:'unit'}})}));
vi.mock('@/lib/fetchAllPages',()=>({fetchAllPages:vi.fn().mockResolvedValue([])}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc,from:()=>({select:()=>({eq:()=>({order:()=>Promise.resolve({data:[]})})})})}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});

it('preserves historical net without presenting missing income and expenses as zero',async()=>{
 rpc.mockResolvedValue({data:[{vehicle_id:'vehicle',vehicle_no:'2512',month:'2026-08-01',historical_net:-7856.28,posted_revenue:0,posted_cost:0,net_profit:-7856.28,source_kind:'historical_opening'}]});
 render(<TransportVehicleMonthlyProfitHistory reportFrom="2026-08-01" reportTo="2026-08-31" readOnly/>);
 const row=await screen.findByRole('row',{name:/2512/});
 const cells=within(row).getAllByRole('cell');
 expect(cells[3].textContent).toBe('—');expect(cells[4].textContent).toBe('—');
 expect(cells[5].textContent).toBe('-7,856.28');
 expect(rpc).toHaveBeenCalledWith('transport_vehicle_monthly_profit_report',{p_from:'2026-08-01',p_to:'2026-08-01'});
 expect(screen.queryByLabelText('Vehicle profit from month')).toBeNull();
});

it('shows posted operating income, expense and net profit separately',async()=>{
 rpc.mockResolvedValue({data:[{vehicle_id:'vehicle',vehicle_no:'7979',month:'2026-09-01',historical_net:0,posted_revenue:1000,posted_cost:300,net_profit:700,source_kind:'posted_operations'}]});
 render(<TransportVehicleMonthlyProfitHistory/>);
 const row=await screen.findByRole('row',{name:/7979/});
 const cells=within(row).getAllByRole('cell');
 expect(cells[2].textContent).toBe('—');expect(cells[3].textContent).toBe('1,000.00');
 expect(cells[4].textContent).toBe('300.00');expect(cells[5].textContent).toBe('700.00');
});
