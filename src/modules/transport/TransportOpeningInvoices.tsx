import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {formatNaviloDate} from '@/lib/naviloDate';
import {financialNumber} from './transportFinancialTypes';
import type {PartyDocument,PartySide} from './transportPartyReporting';
import TransportDialog from './TransportDialog';
const PartyReports=lazy(()=>import('./TransportPartyReports'));

export default function TransportOpeningInvoices({side}:{side:PartySide}){
 const {activeCompany,activeBusinessUnit,accessContext}=useAuth();
 if(activeBusinessUnit?.business_unit_type!=='transport')return null;
 const location=(accessContext as unknown as {current_operating_location?:{id?:string;operating_location_id?:string};operating_location_id?:string}|null);
 const scope=`${activeCompany?.company_id}:${activeBusinessUnit.business_unit_id}:${location?.current_operating_location?.id??location?.current_operating_location?.operating_location_id??location?.operating_location_id}:${side}`;
 return <OpeningInvoices key={scope} side={side}/>;
}
function OpeningInvoices({side}:{side:PartySide}){
 const [rows,setRows]=useState<PartyDocument[]>([]);const [summary,setSummary]=useState({count:0,outstanding:0,credit:0});
 const [search,setSearch]=useState('');const [page,setPage]=useState(0);const [next,setNext]=useState(false);
 const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [refresh,setRefresh]=useState(0);
 const [party,setParty]=useState('');const generation=useRef(0);
 useEffect(()=>{const request=++generation.current;setLoading(true);setError('');const timer=window.setTimeout(async()=>{
  try{
   const filters={party:'',to:'',search};const results=await Promise.all([
    supabase.rpc('transport_opening_invoice_query',{p_kind:'documents',p_side:side,p_filters:filters,p_limit:101,p_offset:page*100}),
    supabase.rpc('transport_opening_invoice_query',{p_kind:'summary',p_side:side,p_filters:filters,p_limit:1,p_offset:0})
   ]);
   for(const r of results)if(r.error)throw r.error;
   if(!Array.isArray(results[0].data)||typeof results[1].data?.count!=='number')throw new Error('Invalid imported invoice response.');
   if(request===generation.current){setRows(results[0].data.slice(0,100));setNext(results[0].data.length>100);setSummary(results[1].data)}
  }catch(e){if(request===generation.current){setRows([]);setNext(false);setError(e&&typeof e==='object'&&'message'in e?String(e.message):'Unable to load imported invoices.')}}
  finally{if(request===generation.current)setLoading(false)}
 },200);return()=>{window.clearTimeout(timer);generation.current++}},[side,search,page,refresh]);
 if(!loading&&!error&&!summary.count&&!search)return null;
 return <section aria-label="Imported opening invoices" className="rounded-lg border border-slate-300 bg-white p-3 text-xs" data-no-export>
  <header className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Imported opening invoices · {side==='customer'?'Customers':'Suppliers'}</h2><div className="flex gap-2"><label>Invoice / Trip / party<input className="input ml-2" value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}}/></label><button className="btn" disabled={loading} onClick={()=>setRefresh(x=>x+1)}>Refresh imported invoices</button></div></header>
  <p className="my-2 text-slate-600">Original invoice references and settled amounts are retained. Opening date is the balance carry-forward date; original issue dates were not supplied. These records link existing posted balances. They do not issue a new tax invoice.</p>
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  {loading?<p role="status">Loading imported invoices…</p>:!error&&<>
   <div className="mb-2 flex flex-wrap gap-5 font-semibold"><span>Records: {summary.count.toLocaleString()}</span><span>{side==='customer'?'Receivable':'Payable'}: {financialNumber(summary.outstanding)}</span><span>Credits: {financialNumber(summary.credit)}</span></div>
   <div className="max-h-72 overflow-auto"><table className="w-full text-left"><thead className="sticky top-0 bg-slate-100"><tr>{['Original reference','Party','Trips','Opening date','Original gross','Previously settled','New received / paid','Remaining','Credit','Action'].map(c=><th className="px-2 py-1" key={c}>{c}</th>)}</tr></thead><tbody>{rows.map(d=><tr className="border-t" key={d.order_id}><td className="px-2 py-1 font-semibold">{d.order_no}</td><td className="px-2">{d.party_name}</td><td className="max-w-48 truncate px-2" title={d.trip_no}>{d.trip_no}</td><td className="px-2 whitespace-nowrap">{formatNaviloDate(d.order_date)}</td><td className="px-2 text-right">{financialNumber(d.original_gross)}</td><td className="px-2 text-right">{financialNumber(d.historical_settled)}</td><td className="px-2 text-right">{financialNumber(Number(d.current_paid_gross)-Number(d.historical_settled))}</td><td className="px-2 text-right">{financialNumber(d.current_outstanding_gross)}</td><td className="px-2 text-right">{financialNumber(d.current_credit_gross)}</td><td className="px-2"><button className="btn whitespace-nowrap" onClick={()=>setParty(d.party_id)}>{side==='customer'?'Receive / review':'Pay / review'}</button></td></tr>)}</tbody></table></div>
   <footer className="mt-2 flex items-center gap-3"><button className="btn" disabled={!page} onClick={()=>setPage(x=>x-1)}>Previous 100</button><span>{summary.count?page*100+1:0}–{Math.min(page*100+rows.length,summary.count)} / {summary.count}</span><button className="btn" disabled={!next} onClick={()=>setPage(x=>x+1)}>Next 100</button><span>Totals cover the complete search.</span></footer>
  </>}
  {party&&<TransportDialog onClose={()=>setParty('')}><div role="dialog" aria-modal="true" aria-label="Imported invoice payment" className="max-h-[94vh] w-full max-w-6xl overflow-auto rounded-lg bg-white"><Suspense fallback={<p className="p-3">Loading payment review…</p>}><PartyReports initialSide={side} initialPartyId={party} allocationEntry onClose={()=>setParty('')} onChanged={async()=>{setRefresh(x=>x+1)}}/></Suspense></div></TransportDialog>}
 </section>;
}
