// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import TransportTripReports from './TransportTripReports';
const mock=vi.hoisted(()=>({rpc:vi.fn(),report:null as any}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'c'},activeBusinessUnit:{business_unit_id:'b'}})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc}}));
vi.mock('./ConfigurableReport',()=>({default:({report}:any)=>{mock.report=report;return <div>Report ready</div>}}));
beforeEach(()=>{mock.rpc.mockReset();mock.rpc.mockResolvedValue({data:{rows:[{trip_no:'ONE',trip_date:'2026-10-01',billed_customer_net:'1000',customer_received_gross:'300'}],count:501,summary:{revenue:50000,profit:10000,customer_received_gross:20000}},error:null})});afterEach(cleanup);
it('applies parent filters to server queries and shows whole filtered totals instead of page totals',async()=>{
 const view=render(<TransportTripReports party="customer" externalFilters={{from:'2026-09-01',to:'2026-10-03',search:'INV-1'}}/>);
 await screen.findByText('Report ready');
 expect(mock.rpc).toHaveBeenCalledWith('transport_trip_report',expect.objectContaining({p_filters:expect.objectContaining({party:'customer',from:'2026-09-01',to:'2026-10-03',search:'INV-1'})}));
 const total=mock.report.rows.at(-1);expect(total[0]).toBe('TOTAL · full filter');expect(total[16]).toBe(50000);
 const received=mock.report.columns.indexOf('Customer received gross');expect(total[received]).toBe(20000);expect(mock.report.rows[0][received]).toBe(300);
 view.rerender(<TransportTripReports party="customer" externalFilters={{from:'2026-09-01',to:'2026-10-03',search:'INV-2'}}/>);
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_trip_report',expect.objectContaining({p_offset:0,p_filters:expect.objectContaining({search:'INV-2'})})));
});
