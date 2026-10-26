import {useEffect,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
export type TransportBillingMode='Cash'|'Credit';
export default function useTransportBillingMode(side:'customer'|'supplier',partyId?:string|null,enabled=true){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const key=`${activeCompany?.company_id}:${activeBusinessUnit?.business_unit_id}:${side}:${partyId}`;
 const [result,setResult]=useState<{key:string;mode:TransportBillingMode|null;error:string;modes:Record<string,TransportBillingMode>}>({key:'',mode:null,error:'',modes:{}});
 useEffect(()=>{if(!enabled)return;let active=true;
  void Promise.resolve(supabase.rpc('transport_billing_modes',{p_side:side})).then(({data,error})=>{
   if(error)throw error;const modes:Record<string,TransportBillingMode>=Object.fromEntries((data?.rows||[]).filter((r:{mode:string})=>r.mode==='Cash'||r.mode==='Credit').map((r:{id:string;mode:TransportBillingMode})=>[r.id,r.mode]));const mode=data?.rows?.find((r:{id:string})=>r.id===partyId)?.mode;
   if(active)setResult({key,mode:mode==='Cash'||mode==='Credit'?mode:null,modes,error:!partyId||mode?'':`Set ${side} Cash/Credit in Master Billing Rules.`});
  }).catch(e=>{if(active)setResult({key,mode:null,modes:{},error:e.message||'Billing rule unavailable.'})});
  return()=>{active=false};
 },[key,side,partyId,enabled]);
 return result.key===key?{...result,ready:Boolean(result.mode),withTax:result.mode==='Credit'}:{mode:null,modes:{},error:'',ready:false,withTax:false};
}
