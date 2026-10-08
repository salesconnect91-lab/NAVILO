import {fetchAllPages} from '@/lib/fetchAllPages';
import {supabase} from '@/lib/supabase';

export type MobilePartyOption = {id:string;name:string;is_active:boolean};

// This RPC enforces the logged-in actor, active Transport BU, feature create
// entitlement and current Company in Postgres. It exposes only dropdown fields.
export function loadTransportMobilePartyOptions(
  table:'customers'|'suppliers', client:typeof supabase=supabase,
):Promise<MobilePartyOption[]> {
  return fetchAllPages<MobilePartyOption>((start,end)=>
    (client as any).rpc('transport_mobile_quick_list_parties',{
      p_party_type:table==='customers'?'customer':'supplier',
    }).range(start,end)
  );
}
