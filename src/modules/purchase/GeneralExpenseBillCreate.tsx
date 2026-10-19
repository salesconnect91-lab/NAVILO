import {useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import SearchableSelect from '@/components/SearchableSelect';
import NaviloDateInput from '@/components/NaviloDateInput';
import {fixedTaxRateOn} from '@/lib/effectiveTaxRate';

type Option={id:string;name:string};
type Line={description:string;amount:string};
const blank=():Line=>({description:'',amount:''});
const today=()=>new Date().toISOString().slice(0,10);
export default function GeneralExpenseBillCreate(){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const company=activeCompany?.company_id,bu=activeBusinessUnit?.business_unit_id;
 const [suppliers,setSuppliers]=useState<Option[]>([]),[accounts,setAccounts]=useState<Option[]>([]);
 const [supplier,setSupplier]=useState(''),[account,setAccount]=useState(''),[original,setOriginal]=useState('');
 const [date,setDate]=useState(today()),[vat,setVat]=useState(false),[taxRate,setTaxRate]=useState(0);
 const [lines,setLines]=useState<Line[]>([blank()]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[done,setDone]=useState<{document_id:string;invoice_no:string;gross:number;status:string}|null>(null);
 useEffect(()=>{let active=true;setSuppliers([]);setAccounts([]);setSupplier('');setAccount('');setDone(null);setError('');setLoading(true);
   if(!company||!bu){setError('Select active company and business unit.');setLoading(false);return;}
   void Promise.all([
     supabase.from('suppliers').select('id,name').eq('company_id',company).eq('is_active',true).order('name'),
     supabase.from('chart_of_accounts').select('id,name').eq('company_id',company).eq('type','expense').eq('is_active',true).eq('is_group',false).order('name')
   ]).then(([s,a])=>{if(!active)return;if(s.error)throw s.error;if(a.error)throw a.error;
     setSuppliers(s.data??[]);setAccounts(a.data??[]);}).catch(e=>{if(active)setError(e.message||'Master data unavailable');})
   .finally(()=>{if(active)setLoading(false)});
   return()=>{active=false};
 },[company,bu]);
 useEffect(()=>{let live=true;void fixedTaxRateOn(date,'purchase').then(r=>{if(live)setTaxRate(Number(r)||0)}).catch(()=>{if(live)setTaxRate(0)});
  return()=>{live=false};
 },[date,company]);
 const subtotal=useMemo(()=>lines.reduce((sum,l)=>sum+(Number(l.amount)||0),0),[lines]);
 const total=subtotal*(1+(vat?taxRate:0)/100);
 const invalid=lines.length<1||lines.length>100||lines.some(l=>!l.description.trim()||l.description.length>1000||!/^[0-9]{1,12}(\.[0-9]{1,2})?$/.test(l.amount)||Number(l.amount)<=0);
 const ready=!loading&&!busy&&!done&&!!supplier&&!!account&&!!date&&!!original.trim()&&(!vat||taxRate>0)&&!invalid;
 const setLine=(i:number,key:keyof Line,value:string)=>setLines(old=>old.map((l,n)=>n===i?{...l,[key]:value}:l));
 async function save(post:boolean){
  if(!ready)return;setBusy(true);setError('');
  try{
   const r=await supabase.rpc('general_expense_bill_create',{
    p_supplier:supplier,p_date:date,p_supplier_invoice_no:original.trim(),p_account:account,
    p_lines:lines.map(x=>({description:x.description.trim(),amount:x.amount.trim()})),
    p_vat:vat,p_post:post,p_reference:null
   });
   if(r.error)throw r.error;
   setDone(r.data);
  }catch(e:any){setError(e?.message||'Expense invoice rejected; no accounting posted.')}
  finally{setBusy(false)}
 }
 return <section className="mx-auto max-w-6xl space-y-3 p-3 text-sm" aria-label="Non-inventory Expense Invoice">
  <div className="flex items-center justify-between"><div><h1 className="text-lg font-bold">Expense Invoice</h1><p className="text-slate-600 text-xs">Non-inventory supplier expense • one Purchase Bill → Expense, Input VAT and Payables • no stock movement</p></div><Link className="text-blue-700 underline text-xs" to="/purchase">Purchase List</Link></div>
  {error&&<p role="alert" className="rounded bg-red-50 p-2 text-red-700">{error}</p>}
  {loading&&<p role="status">Loading company suppliers and Expense accounts…</p>}
  {done&&<div role="status" className="rounded border p-3"><strong>Expense Invoice {done.status}: {done.invoice_no}</strong> · SAR {Number(done.gross).toFixed(2)} <Link className="text-blue-700 underline ml-3" to={`/purchase/${done.document_id}`}>Open Invoice</Link><button className="btn ml-3" onClick={()=>{setDone(null);setOriginal('');setLines([blank()])}}>New Expense Invoice</button></div>}
  <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-3" disabled={loading||busy||!!done}>
   <label className="text-xs font-semibold">Supplier *<SearchableSelect nativeCompatibility preserveLabel className="input mt-1 w-full" aria-label="Expense invoice supplier" value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">Select Supplier Master</option>{suppliers.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</SearchableSelect></label>
   <label className="text-xs font-semibold">Original Supplier Invoice No. *<input aria-label="Expense supplier invoice number" className="input mt-1 w-full" maxLength={80} value={original} onChange={e=>setOriginal(e.target.value)} placeholder="Supplier's invoice reference"/></label>
   <label className="text-xs font-semibold">Invoice Date *<NaviloDateInput type="date" className="input mt-1 w-full" value={date} onChange={e=>setDate(e.target.value)}/></label>
   <label className="text-xs font-semibold">Expense Account *<SearchableSelect nativeCompatibility preserveLabel className="input mt-1 w-full" aria-label="Expense invoice account" value={account} onChange={e=>setAccount(e.target.value)}><option value="">Select Expense GL</option>{accounts.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</SearchableSelect></label>
   <label className="text-xs font-semibold">VAT Treatment<SearchableSelect nativeCompatibility className="input mt-1 w-full" aria-label="Expense invoice VAT treatment" value={vat?'yes':'no'} onChange={e=>setVat(e.target.value==='yes')}><option value="no">Without VAT</option><option value="yes">With VAT (effective company rate)</option></SearchableSelect></label>
   <div className="rounded border p-2 text-xs"><div>Effective VAT rate: <strong>{taxRate}%</strong></div><div className="mt-1 text-slate-600">For Transport suppliers, existing Cash/Credit Master VAT rules must match your selection.</div></div>
  </fieldset>
  <div className="rounded border bg-white p-3 space-y-2">
   <div className="flex justify-between"><h2 className="font-semibold">Expense descriptions</h2><button className="btn" type="button" disabled={loading||busy||!!done||lines.length>=100} onClick={()=>setLines(v=>[...v,blank()])}>+ Add Row</button></div>
   {lines.map((l,i)=><div className="grid grid-cols-[minmax(0,1fr)_140px_35px] gap-2" key={i}>
    <input className="input" aria-label={`Expense description ${i+1}`} placeholder="Fuel, repairs, rent, utilities..." maxLength={1000} disabled={busy||!!done} value={l.description} onChange={e=>setLine(i,'description',e.target.value)}/>
    <input className="input text-right" aria-label={`Expense amount ${i+1}`} placeholder="Net SAR" inputMode="decimal" disabled={busy||!!done} value={l.amount} onChange={e=>setLine(i,'amount',e.target.value)}/>
    <button className="btn" type="button" aria-label={`Remove expense ${i+1}`} disabled={busy||!!done||lines.length===1} onClick={()=>setLines(v=>v.filter((_,j)=>j!==i))}>×</button>
   </div>)}
  </div>
  <div className="flex flex-wrap items-center justify-between gap-3 rounded border p-3">
   <div className="text-xs">Net: <strong>SAR {subtotal.toFixed(2)}</strong> · VAT: <strong>SAR {(total-subtotal).toFixed(2)}</strong> · Gross: <strong>SAR {total.toFixed(2)}</strong></div>
   <div className="flex gap-2"><button className="btn" disabled={!ready} onClick={()=>void save(false)}>{busy?'Saving…':'Save Draft'}</button><button className="btn-primary" disabled={!ready} onClick={()=>void save(true)}>{busy?'Posting…':'Post Expense Invoice'}</button></div>
  </div>
  <p className="text-xs text-slate-500">Supplier payment is recorded separately against the payable. For company-owned vehicle allocation, use <Link to="/transport/vehicle-expenses" className="text-blue-700 underline">Vehicle Expense Bills</Link> in Transport until vehicle allocation is supported here.</p>
 </section>;
}