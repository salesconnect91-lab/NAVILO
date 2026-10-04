import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {fetchAllPages} from '@/lib/fetchAllPages';
import {useCallback,useEffect,useRef,useState} from 'react';
import TransportPartySettlement from '@/modules/transport/TransportPartySettlement';
import type {PartyDocument,PartySide} from '@/modules/transport/transportPartyReporting';

type Account={id:string;name:string;detail_type:string};
export default function TransportCashSettlement({side,party,onPosted,onBusyChange}:{side:PartySide;party:string;onPosted:()=>Promise<void>;onBusyChange:(busy:boolean)=>void}){
 const {activeCompany,activeBusinessUnit,accessContext}=useAuth();
 const location=((accessContext as unknown as {current_operating_location?:{operating_location_id:string}|null})?.current_operating_location)?.operating_location_id;
 const scope=`${activeCompany?.company_id}:${activeBusinessUnit?.business_unit_id}:${location}:${side}:${party}`;
 const [documents,setDocuments]=useState<PartyDocument[]>([]),[accounts,setAccounts]=useState<Account[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 const generation=useRef(0);
 const load=useCallback(async()=>{
  const current=++generation.current;setLoading(true);setError('');
  try{
   if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)throw new Error("Select Company and Business Unit first.");
   const [docs,cash]=await Promise.all([
    fetchAllPages<PartyDocument>((start,end)=>supabase.rpc('transport_party_report_query',{p_kind:'documents',p_side:side,p_filters:{party},p_limit:end-start+1,p_offset:start})),
    fetchAllPages<Account>((start,end)=>supabase.from('chart_of_accounts').select('id,name,detail_type').eq('company_id',activeCompany.company_id).eq('is_active',true).eq('is_group',false).eq('allow_manual_entries',true).in('detail_type',['Cash on Hand','Bank Account']).order('id').range(start,end))
   ]);
   if(current!==generation.current)return;
   setDocuments(docs);setAccounts(cash);
  }catch(e){if(current===generation.current){setDocuments([]);setError(e&&typeof e==='object'&&'message' in e?String(e.message):'Unable to load Transport invoices.')}throw e;}
  finally{if(current===generation.current)setLoading(false);}
 },[scope,side,party,activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);
 useEffect(()=>{setDocuments([]);if(party)void load().catch(()=>{});else setLoading(false);return()=>{generation.current++}},[load,party]);
 if(!party)return <p className="text-sm text-slate-500">Select a {side==='customer'?'customer':'supplier'} first.</p>;
 return <div>
  <div className="flex items-center justify-between"><p className="text-xs text-slate-600">Select posted invoices by Invoice No. or Trip No. Partial allocations are supported. A bill covering several trips is settled at invoice level.</p><button type="button" className="btn-secondary" disabled={loading} onClick={()=>void load().catch(()=>{})}>Refresh invoices</button></div>
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  {loading&&<p role="status">Loading open Transport invoices…</p>}
  {!error&&(!loading||documents.length>0)&&<>
   {!documents.some(d=>Number(d.current_outstanding_gross)>0)&&<p className="my-2 text-sm text-amber-800">No posted outstanding Transport invoices for this party in the active branch. Finalized rates alone are not payable invoices; post the customer bill or supplier rent first.</p>}
   <TransportPartySettlement key={scope} side={side} party={party} documents={documents} accounts={accounts} onBusyChange={onBusyChange} onPosted={async()=>{await load();await onPosted()}}/>
  </>}
 </div>;
}
