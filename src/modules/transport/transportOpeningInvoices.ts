import {supabase} from '@/lib/supabase';
import {fetchAllPages} from '@/lib/fetchAllPages';
import type {PartyDocument,PartyMovement,PartySide} from './transportPartyReporting';

// Both sources describe posted balances, but imported balances must never be
// sent through the new invoice posting or native invoice allocation endpoint.
export async function linkedPartyRows<T extends PartyDocument|PartyMovement>(kind:'documents'|'movements',side:PartySide,filters:Record<string,string>){
 const rows:T[]=[];
 // Avoid competing full-history scans on the same database connection pool.
 for(const name of ['transport_party_report_query','transport_opening_invoice_query']){
  rows.push(...await fetchAllPages<T>(async(start,end)=>{
   const result=await supabase.rpc(name,{p_kind:kind,p_side:side,p_filters:filters,p_limit:end-start+1,p_offset:start});
   if(!result.error&&!Array.isArray(result.data))throw new Error('Invalid invoice report response.');
   return result;
  }));
 }
 return rows;
}
