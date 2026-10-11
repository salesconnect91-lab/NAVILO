import {useEffect,useMemo,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {hasPermission} from '@/auth/permissions';
import {supabase} from '@/lib/supabase';

type Mode='Cash'|'Credit';
type Rule={id:string;name:string;mode:Mode|null;cash_invoices:number;credit_invoices:number};
type ModeFilter='all'|'unset'|'Cash'|'Credit';

export default function TransportCustomerBillingModes({side='customer'}:{side?:'customer'|'supplier'}={}){
 const {activeCompany,activeBusinessUnit,isPlatformOwner}=useAuth();
 const isTransport=activeBusinessUnit?.business_unit_type==='transport';
 const label=side==='customer'?'Customer':'Supplier';
 const scope=`${side}:${activeCompany?.company_id??''}/${activeBusinessUnit?.business_unit_id??''}`;
 const role=activeBusinessUnit?.membership_role??activeCompany?.membership_role;
 const permissions=activeBusinessUnit?.permissions??activeCompany?.permissions;
 const canEdit=Boolean(isPlatformOwner||hasPermission(role,side==='customer'?'sales':'purchase','edit',permissions,false));
 const [enabled,setEnabled]=useState(false),[rows,setRows]=useState<Rule[]>([]);
 const [search,setSearch]=useState(''),[modeFilter,setModeFilter]=useState<ModeFilter>('all');
 const [busy,setBusy]=useState<string|null>(null),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[success,setSuccess]=useState('');
 const [reload,setReload]=useState(0);

 useEffect(()=>{
  let active=true;
  setLoading(true);setError('');setSuccess('');setRows([]);setEnabled(false);setSearch('');setModeFilter('all');
  if(!isTransport||!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){
   setLoading(false);return()=>{active=false};
  }
  void Promise.resolve(side==='customer'?supabase.rpc('transport_get_customer_billing_modes'):supabase.rpc('transport_billing_modes',{p_side:side}))
   .then(({data,error:rpcError})=>{
    if(!active)return;
    if(rpcError)throw rpcError;
    setEnabled(Boolean(data?.enabled));
    setRows((data?.rows??[]) as Rule[]);
   }).catch((e:Error)=>{if(active)setError(e.message||'Cannot load billing rules.')})
    .finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[scope,reload,isTransport]);

 const filtered=useMemo(()=>rows.filter(r=>{
  const matchesText=r.name.toLowerCase().includes(search.trim().toLowerCase());
  const matchesMode=modeFilter==='all'||(modeFilter==='unset'?!r.mode:r.mode===modeFilter);
  return matchesText&&matchesMode;
 }),[rows,search,modeFilter]);
 const configured=rows.filter(r=>r.mode).length;
 async function save(id:string,mode:Mode){
  if(busy||!canEdit||!isTransport)return;
  setBusy(id);setError('');setSuccess('');
  try{
   const {error:rpcError}=await (side==='customer'?supabase.rpc('transport_set_customer_billing_mode',{p_customer_id:id,p_mode:mode}):supabase.rpc('transport_set_party_billing_mode',{p_side:side,p_party_id:id,p_mode:mode}));
   if(rpcError)throw rpcError;
   setRows(previous=>previous.map(r=>r.id===id?{...r,mode}:r));
   const customer=rows.find(r=>r.id===id)?.name||'Customer';
   setSuccess(`${customer}: ${mode==='Cash'?'Cash · Without VAT':'Credit · With VAT'} saved. Unposted records updated; posted history preserved.`);
  }catch(e:any){setError(e.message||'Unable to save customer billing rule.')}
  finally{setBusy(null);}
 }

 if(!isTransport)return null;
 if(loading)return <p role="status" className="text-xs text-slate-500">Loading Transport billing rules…</p>;
 if(!enabled&&!error)return <p className="text-xs text-slate-600">Billing rules are not available for this Transport business.</p>;
 return <section aria-label="Transport Customer Billing Rules" className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
  <div className="flex flex-wrap items-start justify-between gap-2">
   <div>
    <h2 className="text-sm font-bold text-slate-900">{label} Billing Rules · Transport</h2>
    <p className="mt-0.5 text-[11px] text-slate-600">Cash means without VAT; Credit applies the invoice date’s VAT rate automatically. Payments are recorded separately. Changing a rule updates unposted records; posted history stays unchanged.</p>
   </div>
   <button type="button" className="btn h-8 text-xs" disabled={busy!==null} onClick={()=>setReload(n=>n+1)}>Refresh</button>
  </div>
  <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Billing rule counts">
   <span className="rounded-md bg-slate-100 px-2 py-1 font-semibold text-slate-700">Configured {configured} / {rows.length}</span>
   <span className="rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-800">Not configured {rows.length-configured}</span>
   <span className="text-[11px] text-slate-500">A billing mode is required before new Transport invoices can be posted.</span>
  </div>
  {error&&<p role="alert" className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p>}
  {success&&<p role="status" className="rounded-md bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">{success}</p>}
  <div className="flex flex-wrap items-center gap-2">
   <input aria-label="Find billing customer" className="input h-9 min-w-[180px] flex-1 text-xs" placeholder="Search parties..." value={search} onChange={e=>setSearch(e.target.value)}/>
   <select aria-label="Filter customer billing modes" className="input h-9 min-w-[150px] text-xs" value={modeFilter} onChange={e=>setModeFilter(e.target.value as ModeFilter)}>
    <option value="all">All {side==='customer'?'customers':'suppliers'}</option><option value="unset">Not configured</option><option value="Cash">Cash · Without VAT</option><option value="Credit">Credit · With VAT</option>
   </select>
  </div>
  <div className="max-h-[350px] overflow-auto rounded-md border border-slate-200">
   <table className="w-full text-left text-[11px]">
    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600"><tr>
     <th scope="col" className="px-2 py-2">{label}</th>
     <th scope="col" className="whitespace-nowrap px-2 py-2">Existing invoices (Cash / Credit)</th>
     <th scope="col" className="w-[190px] px-2 py-2">Billing mode</th>
    </tr></thead>
    <tbody>{filtered.map(r=><tr key={r.id} className="border-t border-slate-100">
     <td className="px-2 py-1.5 font-semibold text-slate-800">{r.name}</td>
     <td className="px-2 py-1.5 tabular-nums text-slate-600">{r.cash_invoices} / {r.credit_invoices}{r.cash_invoices>0&&r.credit_invoices>0?<span className="ml-1 text-amber-700">Mixed history</span>:null}</td>
     <td className="px-2 py-1"><select aria-label={`Billing mode for ${r.name}`} className="input h-8 w-full min-w-[145px] py-0 text-[11px]" value={r.mode??''} disabled={!canEdit||busy!==null} onChange={e=>{if(e.target.value==='Cash'||e.target.value==='Credit')void save(r.id,e.target.value as Mode)}}>
      <option value="">Not configured</option><option value="Cash">Cash · Without VAT</option><option value="Credit">Credit · With VAT</option>
     </select></td>
    </tr>)}</tbody>
   </table>
   {filtered.length===0&&<p className="p-4 text-center text-xs text-slate-500">No customers match your search or filter.</p>}
  </div>
  <p className="text-[11px] text-slate-500">Invoice counts are existing records, not balances. A selected mode saves automatically. Unposted records are recalculated. Posted invoices and other businesses are not modified.</p>
  {!canEdit&&<p className="text-[11px] font-medium text-amber-700">{side==='customer'?'Sales':'Purchase'} Edit permission is required to change billing modes.</p>}
 </section>;
}
