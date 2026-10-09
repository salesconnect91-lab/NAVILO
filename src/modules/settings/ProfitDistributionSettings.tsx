import {useCallback,useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
interface Account {id:string;code:string;name:string;}
interface Preview {net_profit:number;source_hash:string;draft_count:number;historical_opening:boolean;ready:boolean;closure:{net_profit:number;journal_entry_id:string}|null;accounts:{account_id:string;name:string;net_debit:number}[];}
const money=(n:number)=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export default function ProfitDistributionSettings(){
 const {activeBusinessUnit,activeCompany,accessContext}=useAuth();
 const [month,setMonth]=useState(()=>{const d=new Date();d.setUTCMonth(d.getUTCMonth()-1,1);return d.toISOString().slice(0,7);});
 const [accounts,setAccounts]=useState<Account[]>([]),[account,setAccount]=useState(''),[preview,setPreview]=useState<Preview|null>(null);
 const [loading,setLoading]=useState(false),[posting,setPosting]=useState(false),[reviewed,setReviewed]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const branch=(accessContext as unknown as {current_operating_location?:{id:string;name?:string}|null})?.current_operating_location;
 const requestId=useRef(0);
 const transport=activeBusinessUnit?.business_unit_type==='transport';
 const load=useCallback(async()=>{
  const request=++requestId.current;
  setPreview(null);setReviewed(false);setError('');if(!transport||!/^\d{4}-\d{2}$/.test(month))return;
  setLoading(true);
  try{const [p,a]=await Promise.all([supabase.rpc('transport_monthly_profit_preview',{p_month:`${month}-01`}),supabase.from('chart_of_accounts').select('id,code,name').eq('type','equity').eq('is_active',true).eq('is_group',false).eq('allow_manual_entries',true).order('code')]);
   if(request!==requestId.current)return;
   if(p.error||a.error)throw p.error||a.error;
   setPreview(p.data as Preview);const profitAccounts=(a.data??[]).filter(x=>x.name.trim().toLowerCase()==='undistributed profit');setAccounts(profitAccounts);if(profitAccounts.length===1)setAccount(profitAccounts[0].id);
  }catch(e){if(request!==requestId.current)return;setError(e instanceof Error?e.message:(e as {message?:string})?.message||'Unable to load closing preview');}finally{if(request===requestId.current)setLoading(false);}
 },[month,transport,activeCompany?.company_id,activeBusinessUnit?.business_unit_id,branch?.id]);
 useEffect(()=>{setAccount('');setSuccess('');void load();},[load]);
 async function closeMonth(){
  if(!preview?.ready||!account||!reviewed||posting)return;
  if(!window.confirm(`Close ${month} for the ACTIVE BRANCH? Net profit / loss: ${money(preview.net_profit)}. This posts a closing journal and blocks further postings dated in this branch month. Partners are not paid or allocated automatically.`))return;
  setPosting(true);setError('');setSuccess('');
  try{const r=await supabase.rpc('transport_close_profit_month',{p_month:`${month}-01`,p_account_id:account,p_source_hash:preview.source_hash});if(r.error)throw r.error;setSuccess(`Closed ${month}: ${r.data.entry_no}. Partners can now be credited through a Journal Entry dated in an open month.`);await load();}
  catch(e){setError((e as {message?:string})?.message||'Closing failed');}finally{setPosting(false);}
 }
 if(!transport)return <p>Profit closing is available in Transport business units.</p>;
 return <section className="space-y-3 rounded border bg-white p-3 text-sm">
  <h1 className="text-base font-semibold">Monthly Profit Closing · Journal Entries</h1>
  <p>Scope: {branch?.name||'active branch'}. Close each branch separately. Review all posted income and expenses, including salaries, before closing. Partner allocation remains manual.</p>
  <div className="flex flex-wrap items-end gap-2"><label>Profit month<input aria-label="Profit month" type="month" className="input block" value={month} disabled={posting} onChange={e=>{setMonth(e.target.value);setSuccess('');}}/></label><label>Undistributed Profit account<select aria-label="Undistributed Profit account" className="input block" value={account} disabled={posting} onChange={e=>setAccount(e.target.value)}><option value="">Select equity account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label><button className="btn btn-secondary" disabled={loading||posting} onClick={()=>void load()}>Refresh</button></div>
  <p className="text-xs text-slate-600">Use one equity account named Undistributed Profit for both historical opening and future monthly closing. The journal date and description identify the month; do not record opening profit again.</p>
  {error&&<p role="alert" className="text-red-700">{error}</p>}{success&&<p role="status" className="text-green-700">{success}</p>}
  {loading?<p>Loading preview…</p>:preview&&<>
   <p className="font-semibold">Net profit / (loss): {money(preview.net_profit)} · Draft journals: {preview.draft_count}</p>
   {preview.closure?<p className="rounded border bg-green-50 p-2">Already closed. Recorded profit / (loss): {money(preview.closure.net_profit)}. Check the closing journal in Journal Entries.</p>:preview.historical_opening?<p className="rounded border bg-amber-50 p-2">Historical opening profit is already recorded. Do not close it again; distribute its existing equity balance manually.</p>:<>
    <details><summary className="cursor-pointer">Accounts to close</summary><table className="w-full text-xs"><thead><tr><th className="text-left">Account</th><th className="text-right">Debit / (credit) balance</th></tr></thead><tbody>{preview.accounts.map(a=><tr key={a.account_id}><td>{a.name}</td><td className="text-right">{money(a.net_debit)}</td></tr>)}</tbody></table></details>
    {!preview.ready&&<p className="text-amber-700">Only finished months with posted income/expenses and no draft journals can close.</p>}
    <label className="flex items-center gap-2"><input type="checkbox" checked={reviewed} disabled={posting} onChange={e=>setReviewed(e.target.checked)}/>I reviewed all income, expenses and salaries for this branch month.</label>
    <button className="btn btn-primary" disabled={!preview.ready||!account||!reviewed||posting} onClick={()=>void closeMonth()}>{posting?'Closing…':'Close Month'}</button>
   </>}
  </>}
  <p className="rounded border bg-blue-50 p-2">Closing transfers the ledger result to the selected equity account. Monthly and annual P&amp;L keep the original income/expense history. For a profit, debit that equity account and credit partner Current Accounts for agreed shares in one manual journal dated in an open month. Check prior distributions first. A loss reduces equity; do not distribute it as profit.</p>
  <div className="flex flex-wrap gap-3"><Link className="text-blue-700 underline" to="/accounting">Journal Entries</Link><Link className="text-blue-700 underline" to="/accounting/profit-loss">Profit &amp; Loss</Link><Link className="text-blue-700 underline" to="/accounting/ledgers">General Ledgers</Link><Link className="text-blue-700 underline" to="/accounting/accounts">Chart of Accounts</Link></div>
 </section>;
}
