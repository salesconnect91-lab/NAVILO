import {useEffect,useMemo,useState} from 'react';
import SearchableSelect from '@/components/SearchableSelect';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
type Account={id:string;code:string;name:string};
type Entry={entry_date:string;entry_no:string;description:string|null;debit:number;credit:number;balance:number};
type Ledger={month:string;account_id:string;opening_balance:number;month_movement:number;closing_balance:number;entry_count:number;truncated:boolean;entries:Entry[];posted_only:boolean};
const fmt=(n:number)=>Number(n??0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export default function TransportPartnerCurrentLedger({month,accounts}:{month:string;accounts:Account[]}){
 const{activeCompany,activeBusinessUnit}=useAuth();
 const[selected,setSelected]=useState('');
 const[ledger,setLedger]=useState<Ledger|null>(null);
 const[busy,setBusy]=useState(false),[error,setError]=useState('');
 const current=useMemo(()=>accounts.find(x=>x.id===selected)??accounts[0],[accounts,selected]);
 const accountId=current?.id??'';
 useEffect(()=>{
  let live=true;setLedger(null);setError('');
  if(!accountId||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return;
  setBusy(true);
  void supabase.rpc('transport_profit_distribution_partner_ledger',{p_account_id:accountId,p_month:month+'-01',p_limit:200})
   .then(({data,error:e})=>{
     if(!live)return;
     if(e)setError(e.message);
     else setLedger(data as Ledger);
   }).catch(e=>{if(live)setError(e instanceof Error?e.message:'Could not load partner ledger');})
   .finally(()=>{if(live)setBusy(false);});
  return()=>{live=false;};
 },[accountId,month,activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);
 return <section className="rounded border bg-white p-3 space-y-2">
  <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Partner Current Account · Posted Ledger</h2><p className="text-xs text-slate-500">Actual posted journal lines only, from the selected Transport business unit (all its branches). Credit-positive equity balance. Preview allocations are not posted.</p></div><span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">READ ONLY</span></div>
  <label className="grid gap-1 text-xs font-semibold">Linked partner Current Account
   <SearchableSelect className="input" searchPlaceholder="Search partner Current Account..." preserveLabel aria-label="Partner Current Account ledger" value={accountId} onChange={e=>setSelected(e.target.value)}>
    {accounts.map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
   </SearchableSelect>
  </label>
  {busy&&<p role="status" className="text-xs text-slate-600">Loading posted ledger…</p>}
  {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">{error}</p>}
  {ledger&&!busy&&<><div className="grid gap-2 sm:grid-cols-3">
    <div className="rounded bg-slate-50 p-2"><span className="text-xs text-slate-500">Opening balance</span><p className="font-bold tabular-nums">{fmt(ledger.opening_balance)}</p></div>
    <div className="rounded bg-slate-50 p-2"><span className="text-xs text-slate-500">Net posted movement</span><p className="font-bold tabular-nums">{fmt(ledger.month_movement)}</p></div>
    <div className="rounded bg-slate-50 p-2"><span className="text-xs text-slate-500">Closing balance</span><p className="font-bold tabular-nums">{fmt(ledger.closing_balance)}</p></div>
   </div>
   <div className="overflow-x-auto"><table className="w-full min-w-[670px] text-xs">
    <thead className="bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Journal</th><th className="p-2 text-left">Description</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th><th className="p-2 text-right">Running balance</th></tr></thead>
    <tbody>{ledger.entries.length===0?<tr><td colSpan={6} className="p-3 text-center text-slate-500">No posted entries in this month.</td></tr>:ledger.entries.map((e,i)=><tr className="border-b" key={e.entry_no+'-'+e.entry_date+'-'+i}><td className="p-2">{e.entry_date}</td><td className="p-2">{e.entry_no}</td><td className="p-2">{e.description??'—'}</td><td className="p-2 text-right tabular-nums">{fmt(e.debit)}</td><td className="p-2 text-right tabular-nums">{fmt(e.credit)}</td><td className="p-2 text-right tabular-nums">{fmt(e.balance)}</td></tr>)}</tbody>
   </table></div>
   {ledger.truncated&&<p className="rounded bg-amber-50 p-2 text-xs text-amber-800">Displaying first 200 of {ledger.entry_count} journal lines. Opening and closing balances include all posted lines.</p>}
   <p className="text-xs text-slate-500">Profit-share allocation preview does not increase this ledger. Automatic posting, reversals and month lock are not enabled.</p>
  </>}
 </section>;
}
