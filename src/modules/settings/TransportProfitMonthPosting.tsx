import {useCallback,useEffect,useMemo,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
type Partner={account_id?:string;name:string;percentage:number};
type Rule={id:string;method:string;shares:Partner[];effective_from:string};
type Allocation={account_id:string;code:string;name:string;percentage:number;own_fleet:number;twakkal:number;total:number};
type RecordStatus={id:string;status:'draft'|'approved'|'posted';own_fleet_profit:number;twakkal_profit:number;total_profit:number;source_note:string;source_net_profit:number|null;approved_by?:string;approved_at?:string;journal_entry_id?:string;posted_at?:string;created_by:string};
type MonthStatus={rule_id:string|null;method:string|null;record:RecordStatus|null;posted_net_profit:number;posted_source_lines:number;source_gl_account_id:string|null;allocations:Allocation[]|null;month_ended:boolean;posting_enabled:boolean};
const money=(n:number)=>Number(n??0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const validAmount=(value:string)=>/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim());
export default function TransportProfitMonthPosting({month,active,onPosted}:{month:string;active:Rule|null;onPosted?:()=>void}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const company=activeCompany?.company_id??'',bu=activeBusinessUnit?.business_unit_id??'';
 const [info,setInfo]=useState<MonthStatus|null>(null);
 const [own,setOwn]=useState('0'),[tw,setTw]=useState('0'),[evidence,setEvidence]=useState('');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{
  setInfo(null);setError('');
  if(!company||!bu||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return;
  setLoading(true);
  try{
   const {data,error:e}=await supabase.rpc('transport_profit_month_status',{p_month:month+'-01'});
   if(e)throw e;
   const state=data as MonthStatus;
   setInfo(state);
   if(state?.record){setOwn(String(state.record.own_fleet_profit));setTw(String(state.record.twakkal_profit));setEvidence(state.record.source_note);}
   else{setOwn('0');setTw('0');setEvidence('');}
  }catch(e){setError(e instanceof Error?e.message:'Could not load monthly posting status');}
  finally{setLoading(false);}
 },[company,bu,month]);
 useEffect(()=>{void load();},[load]);
 const record=info?.record;
 const isFixed=active?.method==='fixed_percentage'&&info?.method==='fixed_percentage'&&info.rule_id===active?.id;
 const linked=active?.shares?.length>=2&&active.shares.every(s=>Boolean(s.account_id));
 const total=useMemo(()=>validAmount(own)&&validAmount(tw)?Number(own)+Number(tw):Number.NaN,[own,tw]);
 const allowed=Boolean(isFixed&&linked&&info?.month_ended&&info.source_gl_account_id);
 const couldApprove=allowed&&Number.isFinite(total)&&total>0&&total<=Number(info?.posted_net_profit??0)
   &&Number(info?.posted_source_lines??0)>0;
 async function action(kind:'draft'|'approve'|'post'){
  if(busy||loading||!info)return;
  if(kind==='draft'&&(!couldApprove||evidence.trim().length<12)){setError('Reconcile both profit sources against posted P&L and provide an evidence reference (12+ characters).');return;}
  const prompt=kind==='post'
   ?'POST FINAL PROFIT JOURNAL? This will DEBIT Retained Earnings and CREDIT partner Current Accounts for '+month+' (SAR '+money(Number(record?.total_profit??0))+'). The posted journal is immutable. Continue?'
   :kind==='approve'?'Approve and lock these reviewed profit amounts for '+month+'? Posting will be a separate confirmation.':'Save reviewed profit draft for '+month+'? No ledger will be posted.';
  if(!window.confirm(prompt))return;
  setBusy(true);setError('');setNotice('');
  try{
   const arg=kind==='draft'
     ?{p_month:month+'-01',p_own:Number(own),p_twakkal:Number(tw),p_source_note:evidence.trim()}
     :{p_month:month+'-01'};
   const rpc=kind==='draft'?'transport_profit_month_save_draft':kind==='approve'?'transport_profit_month_approve':'transport_profit_month_post';
   const {data,error:e}=await supabase.rpc(rpc,arg);
   if(e)throw e;
   setNotice(kind==='draft'?'Draft saved; no posting.':kind==='approve'?'Reviewed profit APPROVED; not yet posted.':'Journal posted to canonical NAVILO accounting. '+(data as {journal_number?:string})?.journal_number);
   await load();
   if(kind==='post')onPosted?.();
  }catch(e){setError(e instanceof Error?e.message:'Monthly posting step failed');}
  finally{setBusy(false);}
 }
 const status=record?.status??'not started';
 return <section className="space-y-3 rounded border border-slate-200 bg-white p-3 text-[13px]">
  <header className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-bold">Monthly Profit Closing & Posting</h2><p className="text-xs text-slate-600">Fixed Percentage only · {month} · Canonical NAVILO journal and GL ledgers</p></div><button className="btn btn-secondary text-xs" disabled={busy||loading} onClick={()=>void load()}>Refresh</button></header>
  <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">Financial safeguard: own-fleet and Twakkal monthly net profits must be independently reconciled. Manual values are NOT auto-calculated from trips. Posting requires approved monthly P&L, dedicated partner Current GLs, and a completed accounting month. Custom Excel posting remains blocked.</div>
  {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-red-800">{error}</p>}
  {notice&&<p role="status" className="rounded border border-green-200 bg-green-50 p-2 text-green-900">{notice}</p>}
  <div className="grid gap-2 sm:grid-cols-4">
    <div className="rounded bg-slate-50 p-2"><span className="text-xs text-slate-500">Closing status</span><p className="font-semibold capitalize">{status}</p></div>
    <div className="rounded bg-slate-50 p-2"><span className="text-xs text-slate-500">Posted P&L available</span><p className="font-semibold tabular-nums">{money(Number(info?.posted_net_profit??0))}</p></div>
    <div className="rounded bg-slate-50 p-2"><span className="text-xs text-slate-500">Approved / proposed allocation</span><p className="font-semibold tabular-nums">{money(Number(record?.total_profit??(Number.isFinite(total)?total:0)))}</p></div>
    <div className="rounded bg-slate-50 p-2"><span className="text-xs text-slate-500">Posted P&L journal lines</span><p className="font-semibold tabular-nums">{info?.posted_source_lines??0}</p></div>
  </div>
  {!active?<p className="text-amber-700">Save a profit distribution rule effective for the selected month first.</p>:active.method==='custom_excel'
    ?<p className="rounded bg-slate-50 p-2 text-xs text-slate-700">Custom Excel method: partner GLs can be linked and existing ledgers reviewed, but profit calculation and posting are disabled until approved formula integration.</p>
    :!linked?<p className="rounded bg-amber-50 p-2 text-xs text-amber-800">The active Fixed Percentage rule must link every partner to a dedicated Current Account GL. No posting permitted yet.</p>:null}
  {!info?.month_ended&&<p className="text-xs text-amber-800">This month has not finished. Monthly profit cannot be approved or posted yet.</p>}
  {active?.method==='fixed_percentage'&&<div className="space-y-2">
   <div className="grid gap-3 md:grid-cols-2">
    <label className="grid gap-1 font-medium">Reviewed own-fleet net profit<input type="number" min="0" step="0.01" className="input" value={own} onChange={e=>setOwn(e.target.value)} disabled={busy||loading||status!=='draft'&&status!=='not started'}/></label>
    <label className="grid gap-1 font-medium">Reviewed Twakkal net profit<input type="number" min="0" step="0.01" className="input" value={tw} onChange={e=>setTw(e.target.value)} disabled={busy||loading||status!=='draft'&&status!=='not started'}/></label>
   </div>
   <label className="grid gap-1 font-medium">Reconciliation evidence / approval reference<textarea rows={2} className="input w-full" maxLength={2000} placeholder="Closing workbook, posted journal references, source reconciliation, reviewer notes..." value={evidence} onChange={e=>setEvidence(e.target.value)} disabled={busy||loading||status!=='draft'&&status!=='not started'}/></label>
   <p className="text-xs text-slate-600">Account treatment: Debit approved Retained Earnings GL, credit partner Current GLs. This is an equity reclassification, not a second P&L expense. Posted journal is locked and audit-linked to the closing month.</p>
   {record&&info?.allocations&&<div className="overflow-x-auto"><table className="w-full text-right text-xs"><thead className="bg-slate-50"><tr><th className="p-2 text-left">Partner Current GL</th><th className="p-2">Share %</th><th className="p-2">Own fleet</th><th className="p-2">Twakkal</th><th className="p-2">Total credit</th></tr></thead><tbody>{info.allocations.map(a=><tr key={a.account_id} className="border-b"><td className="p-2 text-left">{a.code} — {a.name}</td><td className="p-2">{a.percentage}%</td><td className="p-2">{money(a.own_fleet)}</td><td className="p-2">{money(a.twakkal)}</td><td className="p-2 font-semibold">{money(a.total)}</td></tr>)}</tbody></table></div>}
   <div className="flex flex-wrap items-center justify-end gap-2">
    {(status==='draft'||status==='not started')&&<button className="btn btn-secondary" disabled={!couldApprove||busy||loading||evidence.trim().length<12} onClick={()=>void action('draft')}>{busy?'Working…':'1. Save / Update Draft'}</button>}
    {status==='draft'&&<button className="btn btn-secondary" disabled={!couldApprove||busy||loading} onClick={()=>void action('approve')}>2. Approve Reviewed Profit</button>}
    {status==='approved'&&<button className="btn btn-primary" disabled={!allowed||busy||loading} onClick={()=>void action('post')}>3. Post Final Journal</button>}
   </div>
   {status==='posted'&&<p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">Posted and locked. Journal ID: <code>{record?.journal_entry_id}</code>. Partner Current Account posted ledgers reflect this journal. Corrections require a separate authorized reversal workflow.</p>}
  </div>}
 </section>;
}
