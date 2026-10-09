import {useCallback,useEffect,useMemo,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import SearchableSelect from '@/components/SearchableSelect';
import TransportPartnerCurrentLedger from './TransportPartnerCurrentLedger';
import TransportProfitMonthPosting from './TransportProfitMonthPosting';
import {supabase} from '@/lib/supabase';
import {effectiveRule,validateDistributionPartners,type DistributionPartner,type DistributionMethod} from './profitDistribution';
type LinkedPartner=DistributionPartner & {account_id:string;account_code?:string};
type EligibleGL={id:string;code:string;name:string};
type Rule={id:string;company_id:string;business_unit_id:string;effective_from:string;method:DistributionMethod;shares:LinkedPartner[];status:'configured'|'awaiting_excel';created_at:string};
const monthNow=()=>new Date().toISOString().slice(0,7);
const initialPartners:LinkedPartner[]=[{key:'partner_1',name:'',percentage:50,account_id:''},{key:'partner_2',name:'',percentage:50,account_id:''}];
export default function ProfitDistributionSettings(){
 const {activeCompany,activeBusinessUnit,isPlatformOwner}=useAuth();
 const company=activeCompany?.company_id??'',unit=activeBusinessUnit?.business_unit_id??'';
 const isTransport=activeBusinessUnit?.business_unit_type==='transport';
 const role=activeBusinessUnit?.membership_role??activeCompany?.membership_role;
 const canManage=isPlatformOwner||role==='company_owner'||role==='admin';
 const [method,setMethod]=useState<DistributionMethod>('fixed_percentage');
 const [effectiveMonth,setEffectiveMonth]=useState(monthNow),[closingMonth,setClosingMonth]=useState(monthNow);
 const [partners,setPartners]=useState<LinkedPartner[]>(initialPartners);
 const [eligibleAccounts,setEligibleAccounts]=useState<EligibleGL[]>([]);
 const [rules,setRules]=useState<Rule[]>([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [postedVersion,setPostedVersion]=useState(0);
 const loadAccounts=useCallback(async()=>{
  if(!company||!unit||!isTransport){setEligibleAccounts([]);return;}
  const {data,error:e}=await supabase.rpc('transport_profit_distribution_eligible_accounts');
  if(e){setError(e.message);setEligibleAccounts([]);}else setEligibleAccounts((data??[]) as EligibleGL[]);
 },[company,unit,isTransport]);
 const load=useCallback(async()=>{
  if(!company||!unit||!isTransport){setRules([]);return;}
  setLoading(true);setError('');
  try{
   const {data,error:e}=await supabase.from('transport_profit_distribution_rules').select('id,company_id,business_unit_id,method,effective_from,shares,status,created_at').eq('company_id',company).eq('business_unit_id',unit).order('effective_from',{ascending:false});
   if(e)throw e;setRules((data??[]) as Rule[]);
  }catch(e){setError(e instanceof Error?e.message:'Could not load saved rules');}finally{setLoading(false);}
 },[company,unit,isTransport]);
 useEffect(()=>{setRules([]);setEligibleAccounts([]);setMethod('fixed_percentage');setPartners(initialPartners);setNotice('');void load();void loadAccounts();},[load,loadAccounts]);
 const active=useMemo(()=>{try{return effectiveRule(rules,closingMonth+'-01');}catch{return null;}},[rules,closingMonth]);
 const percentSum=partners.reduce((n,p)=>n+(Number(p.percentage)||0),0);
 function changePartner(i:number,patch:Partial<LinkedPartner>){setPartners(old=>old.map((p,j)=>j===i?{...p,...patch}:p));}
 async function save(){
  if(!canManage||!company||!unit||!isTransport)return;
  setError('');setNotice('');
  let shares:LinkedPartner[]=[];
  try{
   {
    const linked=partners.map(p=>{const gl=eligibleAccounts.find(a=>a.id===p.account_id);
      if(!gl)throw new Error('Choose an eligible Owner Current Account GL for every partner. Permanent Capital accounts are excluded.');
      return {...p,name:gl.name,account_code:gl.code};});
    if(new Set(linked.map(p=>p.account_id)).size!==linked.length)throw new Error('Each partner must have a different Current Account GL.');
    if(method==='fixed_percentage'){validateDistributionPartners(linked);shares=linked;}
    else shares=linked.map(p=>({...p,percentage:0}));
   }
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
  <header className="flex items-center justify-between gap-2"><div><h1 className="text-lg font-bold">Profit Distribution Rules</h1><p className="text-xs text-slate-600">{activeCompany?.company_name} · {activeBusinessUnit?.business_unit_name} · Independent business rules</p></div><button className="btn btn-secondary text-xs" onClick={()=>{void load();void loadAccounts();}} disabled={loading||busy}>Refresh</button></header>
  <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><strong>Monthly profit distribution.</strong> Set partner Current Accounts and shares, review net profit after expenses, then save, approve and post once. Partner transfers preserve the monthly P&amp;L and vehicle history. Lock the accounting period separately after reconciliation.</p>
  {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-red-800">{error}</p>}
  {notice&&<p role="status" className="rounded border border-green-200 bg-green-50 p-2 text-green-800">{notice}</p>}
  <section className="rounded border bg-white p-3"><h2 className="font-semibold">New effective-dated rule</h2><p className="text-xs text-slate-500">Owner / Admin only · Append-only history</p>
   <div className="mt-2 grid gap-3 md:grid-cols-2"><label className="grid gap-1">Method<select className="input" value={method} disabled={!canManage||busy} onChange={e=>setMethod(e.target.value as DistributionMethod)}><option value="fixed_percentage">Fixed Percentage</option><option value="custom_excel">Custom Excel Formula (later)</option></select></label><label className="grid gap-1">Effective from month<input className="input" type="month" value={effectiveMonth} disabled={!canManage||busy} onChange={e=>setEffectiveMonth(e.target.value)}/></label></div>
   <div className="mt-3 space-y-2"><p className="text-xs text-slate-600">Select a dedicated Current Account GL for each partner. Names come from the GL, not free text. <a className="font-semibold text-blue-700 underline" href="/accounting/accounts">Chart of Accounts</a></p>{eligibleAccounts.length===0&&<p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">No eligible accounts. First create separate Equity / Owner's Equity posting GLs (e.g. Usman Current Account, PK Current Account), then Refresh. Permanent Capital accounts are excluded.</p>}<div className="flex items-center justify-between"><strong>Partner Current GL links</strong>{method==='fixed_percentage'?<span className={Math.abs(percentSum-100)<0.000001?'text-emerald-700':'text-red-700'}>Total {percentSum.toFixed(2)}% / 100%</span>:<span className="text-amber-700">Ratio pending Excel</span>}</div>{method==='custom_excel'&&<p className="rounded border border-blue-200 bg-blue-50 p-2 text-xs">You can link partner GL ledgers now. The Excel formula, monthly allocation preview and financial posting remain disabled.</p>}
    {partners.map((p,i)=><div key={p.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,120px)_auto] items-center gap-2">
     <SearchableSelect className="input" preserveLabel searchPlaceholder="Search GL code or name..." aria-label={'Partner '+(i+1)+' Current Account GL'} value={p.account_id} disabled={!canManage||busy}
      onChange={e=>{const gl=eligibleAccounts.find(a=>a.id===e.target.value);changePartner(i,{account_id:e.target.value,name:gl?.name??'',account_code:gl?.code??''});}}>
      <option value="">Select Current Account GL</option>{eligibleAccounts.map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
     </SearchableSelect>
     {method==='fixed_percentage'?<input className="input" aria-label={'Partner '+(i+1)+' percentage'} type="number" min="0" max="100" step="0.01" value={p.percentage} disabled={!canManage||busy} onChange={e=>changePartner(i,{percentage:Number(e.target.value)})}/>:<span className="rounded bg-slate-50 p-2 text-xs text-slate-600">Pending</span>}
     <button className="btn btn-secondary" aria-label={'Remove partner '+(i+1)} disabled={!canManage||busy||partners.length<=2} onClick={()=>setPartners(a=>a.filter((_,j)=>j!==i))}>×</button>
    </div>)}
    <button className="btn btn-secondary text-xs" disabled={!canManage||busy||partners.length>=20} onClick={()=>setPartners(a=>[...a,{key:'partner_'+(Math.max(0,...a.map(p=>Number(p.key.replace('partner_',''))||0))+1),name:'',percentage:0,account_id:''}])}>+ Partner</button>
   </div>
   <div className="mt-3 text-right"><button className="btn btn-primary" disabled={!canManage||busy} onClick={()=>void save()}>{busy?'Saving…':'Save New Rule'}</button></div>
   {!canManage&&<p className="text-xs text-amber-700">Company Owner / Administrator access required to save.</p>}
  </section>
  <section className="rounded border bg-white p-3"><h2 className="font-semibold">Saved business rules</h2>{loading?<p>Loading…</p>:rules.length===0?<p className="text-xs text-slate-500">No rule configured for this business unit yet.</p>:<div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b bg-slate-50"><th className="p-2">Effective month</th><th className="p-2">Method</th><th className="p-2">Shares</th><th className="p-2">Status</th></tr></thead><tbody>{rules.map(r=><tr key={r.id} className="border-b"><td className="p-2">{r.effective_from.slice(0,7)}</td><td className="p-2">{r.method==='fixed_percentage'?'Fixed Percentage':'Custom Excel'}</td><td className="p-2">{r.method==='fixed_percentage'?r.shares.map(p=>(p.account_code?p.account_code+' — ':'')+p.name+': '+p.percentage+'%').join(' · '):'Formula pending'}</td><td className="p-2">{r.status==='configured'?'Configured':'Awaiting Excel'}</td></tr>)}</tbody></table></div>}</section>
  <label className="grid max-w-xs gap-1 text-sm font-medium">Distribution month<input className="input" type="month" value={closingMonth} onChange={e=>setClosingMonth(e.target.value)}/></label>
   <TransportProfitMonthPosting month={closingMonth} active={active} onPosted={()=>setPostedVersion(x=>x+1)} />
   {active&&active.shares.some(p=>p.account_id)&&<TransportPartnerCurrentLedger key={closingMonth+'-'+postedVersion} month={closingMonth} accounts={active.shares.filter(p=>p.account_id).map(p=>({id:p.account_id,code:p.account_code??'',name:p.name}))} />}
 </div>;
}
