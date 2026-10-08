import {useCallback,useEffect,useMemo,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {calculateFixedDistribution,effectiveRule,validateDistributionPartners,type DistributionPartner,type DistributionMethod} from './profitDistribution';
type Rule={id:string;company_id:string;business_unit_id:string;effective_from:string;method:DistributionMethod;shares:DistributionPartner[];status:'configured'|'awaiting_excel';created_at:string};
const monthNow=()=>new Date().toISOString().slice(0,7);
const initialPartners:DistributionPartner[]=[{key:'partner_1',name:'Partner A',percentage:50},{key:'partner_2',name:'Partner B',percentage:50}];
const currency=(value:number)=>value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export default function ProfitDistributionSettings(){
 const {activeCompany,activeBusinessUnit,isPlatformOwner}=useAuth();
 const company=activeCompany?.company_id??'',unit=activeBusinessUnit?.business_unit_id??'';
 const isTransport=activeBusinessUnit?.business_unit_type==='transport';
 const role=activeBusinessUnit?.membership_role??activeCompany?.membership_role;
 const canManage=isPlatformOwner||role==='company_owner'||role==='admin';
 const [method,setMethod]=useState<DistributionMethod>('fixed_percentage');
 const [effectiveMonth,setEffectiveMonth]=useState(monthNow),[closingMonth,setClosingMonth]=useState(monthNow);
 const [partners,setPartners]=useState<DistributionPartner[]>(initialPartners);
 const [own,setOwn]=useState('0'),[twakkal,setTwakkal]=useState('0');
 const [rules,setRules]=useState<Rule[]>([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{
  if(!company||!unit||!isTransport){setRules([]);return;}
  setLoading(true);setError('');
  try{
   const {data,error:e}=await supabase.from('transport_profit_distribution_rules').select('id,company_id,business_unit_id,method,effective_from,shares,status,created_at').eq('company_id',company).eq('business_unit_id',unit).order('effective_from',{ascending:false});
   if(e)throw e;setRules((data??[]) as Rule[]);
  }catch(e){setError(e instanceof Error?e.message:'Could not load saved rules');}finally{setLoading(false);}
 },[company,unit,isTransport]);
 useEffect(()=>{setRules([]);setMethod('fixed_percentage');setPartners(initialPartners);setNotice('');void load();},[load]);
 const active=useMemo(()=>{try{return effectiveRule(rules,closingMonth+'-01');}catch{return null;}},[rules,closingMonth]);
 const preview=useMemo(()=>{
  if(!active||active.method!=='fixed_percentage')return null;
  try{return{values:calculateFixedDistribution(active.shares,[{key:'own_fleet',label:'Own fleet',amount:Number(own)},{key:'twakkal',label:'Twakkal',amount:Number(twakkal)}]),error:''};}
  catch(e){return{values:null,error:e instanceof Error?e.message:'Invalid preview amount'};}
 },[active,own,twakkal]);
 const percentSum=partners.reduce((n,p)=>n+(Number(p.percentage)||0),0);
 function changePartner(i:number,patch:Partial<DistributionPartner>){setPartners(old=>old.map((p,j)=>j===i?{...p,...patch}:p));}
 async function save(){
  if(!canManage||!company||!unit||!isTransport)return;
  setError('');setNotice('');
  let shares:DistributionPartner[]=[];
  try{
   if(method==='fixed_percentage')shares=validateDistributionPartners(partners);
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveMonth))throw new Error('Choose a valid effective month.');
   if(rules.some(x=>x.effective_from===effectiveMonth+'-01'))throw new Error('Rule already exists for this month. Choose a different effective month.');
  }catch(e){setError(e instanceof Error?e.message:'Invalid rule');return;}
  if(!window.confirm('Save profit rule for '+activeBusinessUnit?.business_unit_name+' from '+effectiveMonth+'? This does not post any journal.'))return;
  setBusy(true);
  try{
   const {error:e}=await supabase.rpc('transport_profit_distribution_save_rule',{p_method:method,p_effective_from:effectiveMonth+'-01',p_shares:shares});
   if(e)throw e;await load();setNotice('Profit rule saved. No journal or Current Account posting occurred.');
  }catch(e){setError(e instanceof Error?e.message:'Could not save rule');}finally{setBusy(false);}
 }
 if(!isTransport)return <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">Profit Distribution is available only in Transport business units.</div>;
 return <div className="space-y-3 p-3 text-[13px] text-slate-800">
  <header className="flex items-center justify-between gap-2"><div><h1 className="text-lg font-bold">Profit Distribution Rules</h1><p className="text-xs text-slate-600">{activeCompany?.company_name} · {activeBusinessUnit?.business_unit_name} · Independent business rules</p></div><button className="btn btn-secondary text-xs" onClick={()=>void load()} disabled={loading||busy}>Refresh</button></header>
  <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><strong>Configuration &amp; manual preview only.</strong> Actual own-fleet / Twakkal profits must first reconcile to NAVILO posted books. No automatic source pull, journal posting, Current Account transfers or month lock in this release. Supplier vehicles are not included as owned-fleet profit.</p>
  {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-red-800">{error}</p>}
  {notice&&<p role="status" className="rounded border border-green-200 bg-green-50 p-2 text-green-800">{notice}</p>}
  <section className="rounded border bg-white p-3"><h2 className="font-semibold">New effective-dated rule</h2><p className="text-xs text-slate-500">Owner / Admin only · Append-only history</p>
   <div className="mt-2 grid gap-3 md:grid-cols-2"><label className="grid gap-1">Method<select className="input" value={method} disabled={!canManage||busy} onChange={e=>setMethod(e.target.value as DistributionMethod)}><option value="fixed_percentage">Fixed Percentage</option><option value="custom_excel">Custom Excel Formula (later)</option></select></label><label className="grid gap-1">Effective from month<input className="input" type="month" value={effectiveMonth} disabled={!canManage||busy} onChange={e=>setEffectiveMonth(e.target.value)}/></label></div>
   {method==='fixed_percentage'?<div className="mt-3 space-y-2"><div className="flex items-center justify-between"><strong>Partner shares</strong><span className={Math.abs(percentSum-100)<0.000001?'text-emerald-700':'text-red-700'}>Total {percentSum.toFixed(2)}% / 100%</span></div>
    {partners.map((p,i)=><div key={p.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,120px)_auto] items-center gap-2"><input className="input" aria-label={'Partner '+(i+1)+' name'} value={p.name} maxLength={120} disabled={!canManage||busy} onChange={e=>changePartner(i,{name:e.target.value})}/><input className="input" aria-label={'Partner '+(i+1)+' percentage'} type="number" min="0" max="100" step="0.01" value={p.percentage} disabled={!canManage||busy} onChange={e=>changePartner(i,{percentage:Number(e.target.value)})}/><button className="btn btn-secondary" aria-label={'Remove partner '+(i+1)} disabled={!canManage||busy||partners.length<=2} onClick={()=>setPartners(a=>a.filter((_,j)=>j!==i))}>×</button></div>)}
    <button className="btn btn-secondary text-xs" disabled={!canManage||busy||partners.length>=20} onClick={()=>setPartners(a=>[...a,{key:'partner_'+(Math.max(0,...a.map(p=>Number(p.key.replace('partner_',''))||0))+1),name:'Partner '+(a.length+1),percentage:0}])}>+ Partner</button>
   </div>:<p className="mt-3 rounded border border-blue-200 bg-blue-50 p-3 text-xs">Custom Excel setup can be saved as <strong>Awaiting Excel</strong>. Formula calculation, distribution preview and posting remain disabled until the original workbook is reviewed and approved.</p>}
   <div className="mt-3 text-right"><button className="btn btn-primary" disabled={!canManage||busy} onClick={()=>void save()}>{busy?'Saving…':'Save New Rule'}</button></div>
   {!canManage&&<p className="text-xs text-amber-700">Company Owner / Administrator access required to save.</p>}
  </section>
  <section className="rounded border bg-white p-3"><h2 className="font-semibold">Saved business rules</h2>{loading?<p>Loading…</p>:rules.length===0?<p className="text-xs text-slate-500">No rule configured for this business unit yet.</p>:<div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b bg-slate-50"><th className="p-2">Effective month</th><th className="p-2">Method</th><th className="p-2">Shares</th><th className="p-2">Status</th></tr></thead><tbody>{rules.map(r=><tr key={r.id} className="border-b"><td className="p-2">{r.effective_from.slice(0,7)}</td><td className="p-2">{r.method==='fixed_percentage'?'Fixed Percentage':'Custom Excel'}</td><td className="p-2">{r.method==='fixed_percentage'?r.shares.map(p=>p.name+': '+p.percentage+'%').join(' · '):'Formula pending'}</td><td className="p-2">{r.status==='configured'?'Configured':'Awaiting Excel'}</td></tr>)}</tbody></table></div>}</section>
  <section className="rounded border bg-white p-3"><h2 className="font-semibold">Monthly distribution preview <span className="font-normal text-xs">(no posting)</span></h2><p className="text-xs text-slate-500">Only manual, independently verified net amounts. Not connected to General Ledger.</p>
   <div className="mt-2 grid gap-3 md:grid-cols-3"><label className="grid gap-1">Closing month<input className="input" type="month" value={closingMonth} onChange={e=>setClosingMonth(e.target.value)}/></label><label className="grid gap-1">Own-fleet net profit<input className="input" type="number" min="0" step="0.01" value={own} onChange={e=>setOwn(e.target.value)}/></label><label className="grid gap-1">Twakkal net profit<input className="input" type="number" min="0" step="0.01" value={twakkal} onChange={e=>setTwakkal(e.target.value)}/></label></div>
   {!active?<p className="mt-2 text-amber-800">No rule effective for this month.</p>:active.method==='custom_excel'?<p className="mt-2 text-amber-800">Custom Excel awaiting workbook; calculation and posting blocked.</p>:preview?.error?<p role="alert" className="mt-2 text-red-700">{preview.error}</p>:preview?.values?<div className="mt-2 overflow-x-auto"><p className="text-xs text-slate-600">Rule: {active.effective_from.slice(0,7)}</p><table className="w-full text-right text-xs"><thead><tr className="border-b bg-slate-50"><th className="p-2 text-left">Partner</th><th className="p-2">Own Fleet</th><th className="p-2">Twakkal</th><th className="p-2">Total</th></tr></thead><tbody>{preview.values.lines.map(l=><tr key={l.key} className="border-b"><td className="p-2 text-left">{l.name}</td><td className="p-2">{currency(l.own_fleet)}</td><td className="p-2">{currency(l.twakkal)}</td><td className="p-2 font-semibold">{currency(l.total)}</td></tr>)}<tr className="bg-slate-50 font-bold"><td className="p-2 text-left">Total</td><td className="p-2">{currency(preview.values.poolTotals.own_fleet)}</td><td className="p-2">{currency(preview.values.poolTotals.twakkal)}</td><td className="p-2">{currency(preview.values.total)}</td></tr></tbody></table></div>:null}
  </section>
 </div>;
}
