import {describe,it,expect,vi,afterEach} from 'vitest';
import {linkedPartyRows} from './transportOpeningInvoices';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc}}));
afterEach(()=>vi.clearAllMocks());
describe('Linked invoice report sources',()=>{
 it('loads all opening pages beside native documents with the same party scope',async()=>{
  rpc.mockImplementation(async(name:string,args:{p_offset:number})=>({error:null,data:name==='transport_party_report_query'?[{order_id:'native'}]:args.p_offset===0?Array.from({length:1000},(_,i)=>({order_id:`opening-${i}`})):[{order_id:'opening-1000'}]}));
  const rows=await linkedPartyRows('documents','supplier',{party:'party',to:'',search:''});
  expect(rows).toHaveLength(1002);expect(rpc.mock.calls.every(([,p])=>p.p_side==='supplier'&&p.p_filters.party==='party')).toBe(true);
  expect(rpc).toHaveBeenCalledWith('transport_opening_invoice_query',expect.objectContaining({p_offset:1000}));
 });
 it('rejects a failed or malformed opening source instead of reporting an empty success',async()=>{
  rpc.mockImplementation(async(name:string)=>name==='transport_party_report_query'?{data:[],error:null}:{data:null,error:{message:'Opening invoices unavailable'}});
  await expect(linkedPartyRows('documents','customer',{party:'p'})).rejects.toThrow('Opening invoices unavailable');
  rpc.mockImplementation(async()=>({data:true,error:null}));
  await expect(linkedPartyRows('documents','customer',{})).rejects.toThrow('Invalid invoice report response');
 });
});
