import {useCallback,useEffect,useMemo,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
type Partner={account_id?:string;name:string;percentage:number};
type Rule={id:string;method:string;shares:Partner[];effective_from:string};
type Allocation={account_id:string;code:string;name:string;percentage:number;own_fleet:number;twakkal:number;total:number};
type RecordStatus={id:string;status:'draft'|'approved'|'posted';own_fleet_profit:number;twakkal_profit:number;total_profit:number;source_note:string;source_net_profit:number|null;approved_by?:string;approved_at?:string;journal_entry_id?:string;posted_at?:string;created_by:string};
type Reversal={id:string;reversal_journal_entry_id:string;reversed_on:string;reason:string};
type MonthStatus={rule_id:string|null;method:string|null;record:RecordStatus|null;posted_net_profit:number;posted_source_lines:number;source_gl_account_id:string|null;allocations:Allocation[]|null;month_ended:boolean;posting_enabled:boolean;source_kind?:'historical_opening'|'posted_operations';source_account_name?:string};
const money=(n:number)=>Number(n??0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const validAmount=(value:string)=>/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim());
export default function TransportProfitMonthPosting({month,active,onPosted}:{month:string;active:Rule|null;onPosted?:()=>void}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const company=activeCompany?.company_id??'',bu=activeBusinessUnit?.business_unit_id??'';
 const [info,setInfo]=useState<MonthStatus|null>(null),[reversal,setReversal]=useState<Reversal|null>(null);
 const [correctionReason,setCorrectionReason]=useState('');
 const [own,setOwn]=useState('0'),[tw,setTw]=useState('0'),[evidence,setEvidence]=useState('');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{
  setInfo(null);setReversal(null);setError('');
  if(!company||!bu||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return;
  setLoading(true);
  try{
   const {data,error:e}=await supabase.rpc('transport_profit_month_status',{p_month:month+'-01'});
   if(e)throw e;
   const state=data as MonthStatus;
   setInfo(state);
   if(state?.record){setOwn(state.source_kind==='historical_opening'&&state.record.status==='draft'?String(state.posted_net_profit):String(state.record.own_fleet_profit));setTw(state.source_kind==='historical_opening'&&state.record.status==='draft'?'0':String(state.record.twakkal_profit));setEvidence(state.record.source_note);}
   else{setOwn(state.source_kind==='historical_opening'?String(state.posted_net_profit):'0');setTw('0');setEvidence('');}
   if(state?.record?.status==='posted'){
     const {data:rev,error:revError}=await supabase.rpc('transport_profit_month_reversal_info',{p_month:month+'-01'});
     if(revError)throw revError;
     setReversal((rev??null) as Reversal|null);
   }
  }catch(e){setError(e instanceof Error?e.message:'Could not load monthly posting status');}
  finally{setLoading(false);}
 },[company,bu,month]);
 useEffect(()=>{void load();},[load]);
 const record=info?.record;
 const historical=info?.source_kind==='historical_opening';
 const sourceName=info?.source_account_name??'Retained Earnings';
 const isFixed=active?.method==='fixed_percentage'&&info?.method==='fixed_percentage'&&info.rule_id===active?.id;
 const linked=active?.shares?.length>=2&&active.shares.every(s=>Boolean(s.account_id));
 const total=useMemo(()=>validAmount(own)&&validAmount(tw)?Number(own)+Number(tw):Number.NaN,[own,tw]);
 const allowed=Boolean(isFixed&&linked&&info?.posting_enabled&&info.month_ended&&info.source_gl_account_id);
 const couldApprove=allowed&&Number.isFinite(total)&&total>0&&total<=Number(info?.posted_net_profit??0)
   &&Number(info?.posted_source_lines??0)>0&&(!historical||total===Number(info?.posted_net_profit)&&Number(tw)===0);
 async function action(kind:'draft'|'approve'|'post'|'reopen'|'reverse'){
  if(busy||loading||!info)return;
  if(kind==='draft'&&(!couldApprove||evidence.trim().length<12)){setError('Reconcile both profit sources against posted P&L and provide an evidence reference (12+ characters).');return;}
  if((kind==='reopen'||kind==='reverse')&&correctionReason.trim().length<10){setError('Correction reason must be at least 10 characters.');return;}
  const prompt=kind==='post'
   ?'POST FINAL PROFIT JOURNAL? This will DEBIT '+sourceName+' and CREDIT partner Current Accounts for '+month+' (SAR '+money(Number(record?.total_profit??0))+'). The posted journal is immutable. Continue?'
   :kind==='reverse'?'POST A NEW CURRENT-DATE REVERSAL JOURNAL for '+month+'? Original posted journal remains immutable. Continue?'
   :kind==='reopen'?'Return approved but UNPOSTED profit to Draft, with an audit event?'
   :kind==='approve'?'Approve and lock these reviewed profit amounts for '+month+'? Posting will be a separate confirmation.'
   :'Save reviewed profit draft for '+month+'? No ledger will be posted.';
  if(!window.confirm(prompt))return;
  setBusy(true);setError('');setNotice('');
  try{
   const arg=kind==='draft'
     ?{p_month:month+'-01',p_own:Number(own),p_twakkal:Number(tw),p_source_note:evidence.trim()}
     :kind==='reopen'||kind==='reverse'
     ?{p_month:month+'-01',p_reason:correctionReason.trim()}
     :{p_month:month+'-01'};
   const rpc=kind==='draft'?'transport_profit_month_save_draft':kind==='approve'?'transport_profit_month_approve'
     :kind==='post'?'transport_profit_month_post':kind==='reopen'?'transport_profit_month_reopen_review':'transport_profit_month_reverse';
   const {data,error:e}=await supabase.rpc(rpc,arg);
   if(e)throw e;
   setNotice(kind==='draft'?'Draft saved; no posting.':kind==='approve'?'Reviewed profit APPROVED; not yet posted.'
     :kind==='reopen'?'Approval reopened for correction; original reviewed snapshot kept in audit trail.'
     :kind==='reverse'?'Original journal preserved; a separate reversal journal posted. '+(data as {journal_number?:string})?.journal_number
     :'Journal posted to canonical NAVILO accounting. '+(data as {journal_number?:string})?.journal_number);
   await load();
   if(kind==='post'||kind==='reverse')onPosted?.();
  }catch(e){setError(e instanceof Error?e.message:'Monthly posting step failed');}
  finally{setBusy(false);}
 }
 const status=record?.status??'not started';
 return <section className="space-y-3 rounded border border-slate-200 bg-white p-3 text-[13px]">
  <header className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-bold">Monthly Profit Closing & Posting</h2><p className="text-xs text-slate-600">{month} · Review net profit, approve, then transfer to partners</p></div><button className="btn btn-secondary text-xs" disabled={busy||loading} onClick={()=>void load()}>Refresh</button></header>
  <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">Enter net profit after expenses once. Review the partner allocation, approve, then post. Transfers preserve income, expense and vehicle history. The source account below is selected from posted evidence. Historical opening net profit is transferred from its existing equity account; it is never posted again as income.</div>
  {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-red-800">{error}</p>}
  {notice&&<p role="status" className="rounded border border-green-200 bg-green-50 p-2 text-green-900">{notice}</p>}
  <div className="grid gap-2 sm:grid-cols-4">
    <div className="rounded bg-slate-50 p-2"><span className="text-xs text-slate-500">Closing status</span><p className="font-semibold capitalize">{status}</p></div>
    <div className="rounded bg-slate-50 p-2"><span className="text-xs text-slate-500">{historical?'Historical fleet net profit':'Posted P&L available'}</span><p className="font-semibold tabular-nums">{money(Number(info?.posted_net_profit??0))}</p></div>
    <div className="rounded bg-slate-50 p-2"><span className="text-xs text-slate-500">Approved / proposed allocation</span><p className="font-semibold tabular-nums">{money(Number(record?.total_profit??(Number.isFinite(total)?total:0)))}</p></div>
    <div className="rounded bg-slate-50 p-2"><span className="text-xs text-slate-500">Source journal lines</span><p className="font-semibold tabular-nums">{info?.posted_source_lines??0}</p></div>
  </div>
  {info&&<p className="text-xs text-slate-600">Source account: <strong>{sourceName}</strong> · {historical?'Historical fleet opening after expenses':'Posted monthly operations'}. Undistributed for this review: <strong>{money(Number(info.posted_net_profit)-(status==='posted'&&!reversal?Number(record?.total_profit??0):0))}</strong>{historical&&' · Opening income and expenses must not be entered again.'}</p>}
  {!active?<p className="text-amber-700">Save a profit distribution rule effective for the selected month first.</p>:active.method==='custom_excel'
    ?<p className="rounded bg-slate-50 p-2 text-xs text-slate-700">Custom Excel method: partner GLs can be linked and existing ledgers reviewed, but profit calculation and posting are disabled until approved formula integration.</p>
    :!linked?<p className="rounded bg-amber-50 p-2 text-xs text-amber-800">The active Fixed Percentage rule must link every partner to a dedicated Current Account GL. No posting permitted yet.</p>:null}
  {info&&!historical&&Number(info.posted_source_lines)===0&&<p className="text-xs text-amber-800">No posted income/expense source for this month. Historical opening net profit remains in its original equity account; do not enter it again as new income.</p>}
  {!info?.month_ended&&<p className="text-xs text-amber-800">This month has not finished. Monthly profit cannot be approved or posted yet.</p>}
  {active?.method==='fixed_percentage'&&<div className="space-y-2">
   <div className="grid gap-3 md:grid-cols-2">
    <label className="grid gap-1 font-medium">Reviewed own-fleet net profit<input type="number" min="0" step="0.01" className="input" value={own} onChange={e=>setOwn(e.target.value)} disabled={historical||busy||loading||status!=='draft'&&status!=='not started'}/></label>
    <label className="grid gap-1 font-medium">Reviewed Twakkal net profit<input type="number" min="0" step="0.01" className="input" value={tw} onChange={e=>setTw(e.target.value)} disabled={historical||busy||loading||status!=='draft'&&status!=='not started'}/></label>
   </div>
   <label className="grid gap-1 font-medium">Reconciliation evidence / approval reference<textarea rows={2} className="input w-full" maxLength={2000} placeholder="Closing workbook, posted journal references, source reconciliation, reviewer notes..." value={evidence} onChange={e=>setEvidence(e.target.value)} disabled={busy||loading||status!=='draft'&&status!=='not started'}/></label>
   <p className="text-xs text-slate-600">Account treatment: Debit {sourceName}, credit partner Current GLs. This is an equity reclassification, not a second P&L expense. Posted journal is locked and audit-linked to the closing month.</p>
   {record&&info?.allocations&&<div className="overflow-x-auto"><table className="w-full text-right text-xs"><thead className="bg-slate-50"><tr><th className="p-2 text-left">Partner Current GL</th><th className="p-2">Share %</th><th className="p-2">Own fleet</th><th className="p-2">Twakkal</th><th className="p-2">Total credit</th></tr></thead><tbody>{info.allocations.map(a=><tr key={a.account_id} className="border-b"><td className="p-2 text-left">{a.code} — {a.name}</td><td className="p-2">{a.percentage}%</td><td className="p-2">{money(a.own_fleet)}</td><td className="p-2">{money(a.twakkal)}</td><td className="p-2 font-semibold">{money(a.total)}</td></tr>)}</tbody></table></div>}
   <div className="flex flex-wrap items-center justify-end gap-2">
    {(status==='draft'||status==='not started')&&<button className="btn btn-secondary" disabled={!couldApprove||busy||loading||evidence.trim().length<12} onClick={()=>void action('draft')}>{busy?'Working…':'1. Save / Update Draft'}</button>}
    {status==='draft'&&<button className="btn btn-secondary" disabled={!couldApprove||busy||loading} onClick={()=>void action('approve')}>2. Approve Reviewed Profit</button>}
    {status==='approved'&&<button className="btn btn-primary" disabled={!allowed||busy||loading} onClick={()=>void action('post')}>3. Post Final Journal</button>}
   </div>
   {status==='posted'&&<p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">Original distribution posted and locked. Journal ID: <code>{record?.journal_entry_id}</code>. {reversal?'A separate dated reversal journal has been posted.':'Any correction must use a separately dated reversal journal.'}</p>}
   {reversal&&<p className="rounded bg-slate-50 p-2 text-xs text-slate-700">Reversed on {reversal.reversed_on} · Reversal journal: {reversal.reversal_journal_entry_id} · {reversal.reason}</p>}
   {(status==='approved'||status==='posted'&&!reversal)&&<div className="mt-3 space-y-2 rounded border border-slate-200 p-2">
     <label className="grid gap-1 text-xs font-medium">Correction reason (required, audit logged)<textarea className="input w-full" rows={2} maxLength={2000} value={correctionReason} onChange={e=>setCorrectionReason(e.target.value)} placeholder="Explain why profit review needs reopening or posted allocation must be reversed..."/></label>
     <div className="flex justify-end">{status==='approved'
       ?<button className="btn btn-secondary" disabled={busy||loading||correctionReason.trim().length<10} onClick={()=>void action('reopen')}>Reopen Approval (No Posting)</button>
       :<button className="btn btn-secondary" disabled={busy||loading||correctionReason.trim().length<10} onClick={()=>void action('reverse')}>Post Dated Reversal Journal</button>}
     </div>
   </div>}
  </div>}
 </section>;
}
