import {useEffect,useMemo,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {hasPermission} from '@/auth/permissions';
import {supabase} from '@/lib/supabase';

type Mode='Cash'|'Credit';
type Rule={id:string;name:string;mode:Mode|null;cash_invoices:number;credit_invoices:number};

export default function TransportCustomerBillingModes(){
 const {activeCompany,activeBusinessUnit,isPlatformOwner}=useAuth();
 const scope=`${activeCompany?.company_id??''}/${activeBusinessUnit?.business_unit_id??''}`;
 const role=activeBusinessUnit?.membership_role??activeCompany?.membership_role;
 const permissions=activeBusinessUnit?.permissions??activeCompany?.permissions;
 const canEdit=Boolean(isPlatformOwner||hasPermission(role,'sales','edit',permissions,false));
 const [enabled,setEnabled]=useState(false),[rows,setRows]=useState<Rule[]>([]);
 const [filter,setFilter]=useState(''),[busy,setBusy]=useState<string|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const [reload,setReload]=useState(0);
 useEffect(()=>{
  let active=true;
  setLoading(true);setError('');setRows([]);setEnabled(false);
  if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setLoading(false);return;}
  void supabase.rpc('transport_get_customer_billing_modes').then(({data,error:rpcError})=>{
   if(!active)return;
   if(rpcError)throw rpcError;
   setEnabled(Boolean(data?.enabled));setRows((data?.rows??[]) as Rule[]);
  }).catch((e:Error)=>{if(active)setError(e.message||'Cannot load customer modes.')})
  .finally(()=>{if(active)setLoading(false)});
  return ()=>{active=false;};
 },[scope,reload]);
 const filtered=useMemo(()=>rows.filter(r=>r.name.toLowerCase().includes(filter.trim().toLowerCase())),[rows,filter]);
 async function save(id:string,mode:Mode){
  if(busy||!canEdit)return;
  setBusy(id);setError('');setSuccess('');
  try{
   const {error:rpcError}=await supabase.rpc('transport_set_customer_billing_mode',{p_customer_id:id,p_mode:mode});
   if(rpcError)throw rpcError;
   setRows(previous=>previous.map(r=>r.id===id?{...r,mode}:r));
   setSuccess('Customer billing mode saved. The opposite mode will be blocked for new invoices.');
  }catch(e:any){setError(e.message||'Unable to save customer mode.')}
  finally{setBusy(null);}
 }
 if(loading)return <p className="text-xs text-slate-500">Loading customer Cash/Credit rules…</p>;
 if(!enabled&&!error)return null;
 return <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-2 space-y-2">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <div><h3 className="text-xs font-bold text-slate-900">Customer Cash/Credit Lock · Orbit</h3>
    <p className="text-[11px] text-slate-600">Set the allowed mode per customer before importing. Unassigned customers and mismatched Cash/Credit invoices are rejected. Existing invoices are not changed.</p></div>
   <div className="flex gap-2 items-center"><input className="input h-8 text-xs w-44" aria-label="Find billing customer" placeholder="Search customers" value={filter} onChange={e=>setFilter(e.target.value)}/><button className="btn h-8" disabled={busy!==null} onClick={()=>setReload(x=>x+1)}>Refresh</button></div>
  </div>
  {error&&<p className="text-xs text-red-700" role="alert">{error}</p>}
  {success&&<p className="text-xs text-emerald-700" role="status">{success}</p>}
  <p className="text-[11px] text-slate-600">{rows.filter(r=>r.mode).length}/{rows.length} customer modes configured. Cash and Credit invoice counts reflect existing records, including drafts.</p>
  <div className="max-h-52 overflow-y-auto rounded border bg-white">
   <table className="w-full text-left text-[11px]">
    <thead className="sticky top-0 bg-slate-100"><tr><th className="p-1">Customer</th><th className="p-1">Mode</th><th className="p-1">Existing Cash / Credit</th><th className="p-1">Allowed mode</th></tr></thead>
    <tbody>{filtered.map(r=><tr key={r.id} className="border-t"><td className="p-1 font-medium">{r.name}</td><td className="p-1">{r.mode?r.mode+' Only':'Not configured'}</td><td className="p-1 tabular-nums">{r.cash_invoices} / {r.credit_invoices}{r.cash_invoices>0&&r.credit_invoices>0?' · mixed history':''}</td>
     <td className="p-1"><select aria-label={`Billing mode for ${r.name}`} className="input h-7 min-w-28 py-0 text-[11px]" value={r.mode??''} disabled={!canEdit||busy!==null} onChange={e=>{if(e.target.value==='Cash'||e.target.value==='Credit')void save(r.id,e.target.value as Mode)}}>
      <option value="">Select mode</option><option value="Cash">Cash Only</option><option value="Credit">Credit Only</option></select></td></tr>)}</tbody>
   </table>
  </div>
  {!canEdit&&<p className="text-[11px] text-amber-700">Sales Edit permission is required to configure billing modes.</p>}
 </section>;
}
