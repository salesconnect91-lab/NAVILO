import {useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import NaviloDateInput from '@/components/NaviloDateInput';
import NaviloSearchableSelect from '@/components/SearchableSelect';

type Side='customer'|'supplier';
type Party={id:string;name:string};
type Account={id:string;name:string;code?:string};
type Line={description:string;amount:string;vehicle_id?:string};
const empty=():Line=>({description:'',amount:''});
const today=()=>new Date().toISOString().slice(0,10);

export function validateNormalInvoiceLines(lines:Line[]):string|null{
 if(!lines.length||lines.length>50)return 'Enter 1–50 description lines.';
 for(const [index,line] of lines.entries()){
  if(!line.description.trim()||line.description.length>1000)return `Line ${index+1}: enter a description (up to 1,000 characters).`;
  if(!/^[0-9]{1,12}(\.[0-9]{1,2})?$/.test(line.amount.trim())||Number(line.amount)<=0)
   return `Line ${index+1}: enter a positive amount with at most 2 decimals.`;
 }
 return null;
}

export default function TransportNormalInvoiceCreate({side}:{side:Side}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const company=activeCompany?.company_id,bu=activeBusinessUnit?.business_unit_id,scope=`${company}/${bu}`;
 const [parties,setParties]=useState<Party[]>([]),[accounts,setAccounts]=useState<Account[]>([]);
 const [party,setParty]=useState(''),[account,setAccount]=useState(''),[date,setDate]=useState(today());
 const [number,setNumber]=useState(''),[reference,setReference]=useState(''),[vatChoice,setVatChoice]=useState<'master'|'with_vat'|'without_vat'>('master'),[lines,setLines]=useState<Line[]>([empty()]);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[done,setDone]=useState<{document_id:string;invoice_no:string;status:string;gross:number}|null>(null);
 const [loadedScope,setLoadedScope]=useState('');
 const [vehicles,setVehicles]=useState<{id:string;vehicle_no:string;revenue_account_id:string|null}[]>([]);
 const [ownership,setOwnership]=useState<{vehicle_id:string;owner_type:string;effective_from:string;effective_to:string|null}[]>([]);
 useEffect(()=>{
  let live=true;setVehicles([]);setOwnership([]);setLines([empty()]);
  if(!company||!bu)return;
  void (async()=>{
   const v:typeof vehicles=[];const o:typeof ownership=[];
   for(let offset=0;;offset+=500){const r=await supabase.from('transport_vehicles').select('id,vehicle_no,revenue_account_id').eq('company_id',company).eq('business_unit_id',bu).eq('is_active',true).order('id').range(offset,offset+499);if(r.error)throw r.error;v.push(...r.data??[]);if((r.data??[]).length<500)break;}
   for(let offset=0;;offset+=500){const r=await supabase.from('transport_vehicle_ownership').select('vehicle_id,owner_type,effective_from,effective_to').eq('company_id',company).eq('business_unit_id',bu).order('id').range(offset,offset+499);if(r.error)throw r.error;o.push(...r.data??[]);if((r.data??[]).length<500)break;}
   if(live){setVehicles(v);setOwnership(o);}
  })().catch(e=>{if(live)setError(e.message||'Vehicle Master unavailable');});return()=>{live=false};
 },[company,bu]);
 const eligibleVehicles=vehicles.filter(v=>ownership.some(o=>o.vehicle_id===v.id&&o.owner_type==='company'&&o.effective_from<=date&&(!o.effective_to||o.effective_to>=date)));

 useEffect(()=>{
  let cancelled=false;setParty('');setAccount('');setParties([]);setAccounts([]);setError('');setDone(null);setLoadedScope('');setLoading(true);
  if(!company||!bu){setError('Select an active Transport workspace.');setLoading(false);return;}
  const table=side==='customer'?'customers':'suppliers';
  const accountType=side==='customer'?'revenue':'expense';
  const mapping=side==='customer'?'sales_revenue':'cogs';
  void Promise.all([
   supabase.from(table).select('id,name').eq('company_id',company).eq('is_active',true).order('name'),
   supabase.from('chart_of_accounts').select('id,code,name').eq('company_id',company).eq('type',accountType).eq('is_active',true).eq('is_group',false).order('name'),
   supabase.from('account_mappings').select('account_id').eq('company_id',company).eq('mapping_key',mapping).limit(1).maybeSingle(),
  ]).then(([people,coa,m])=>{
   if(cancelled)return;
   if(people.error)throw people.error;if(coa.error)throw coa.error;if(m.error)throw m.error;
   const options=coa.data??[];
   setParties(people.data??[]);setAccounts(options);
   const mapped=m.data?.account_id;
   setAccount(mapped&&options.some(a=>a.id===mapped)?mapped:'');
   setLoadedScope(scope);
  }).catch(e=>{if(!cancelled)setError(e.message||'Unable to load active master data.')})
    .finally(()=>{if(!cancelled)setLoading(false)});
  return()=>{cancelled=true};
 },[company,bu,scope,side]);
 const amount=useMemo(()=>lines.reduce((total,l)=>total+(Number(l.amount)||0),0),[lines]);
 const lineError=validateNormalInvoiceLines(lines)
  ||(lines.some(l=>l.vehicle_id&&!eligibleVehicles.some(v=>v.id===l.vehicle_id))?'Select a company-owned vehicle valid on invoice date.':null);
 const available=loadedScope===scope&&!loading&&!saving&&!done&&Boolean(party&&account&&date)&&!lineError;
 const update=(index:number,k:keyof Line,value:string)=>setLines(old=>old.map((line,i)=>i===index?{...line,[k]:value}:line));
 async function save(post:boolean){
  if(!available)return;setSaving(true);setError('');
  try{
   const result=await supabase.rpc('transport_normal_invoice_create_vat',{ 
    p_side:side,p_party:party,p_date:date,
    p_lines:lines.map(l=>({description:l.description.trim(),amount:l.amount.trim(),...(l.vehicle_id?{vehicle_id:l.vehicle_id}:{})})),
    p_account:account,p_invoice_no:number.trim()||null,p_reference:reference.trim()||null,p_post:post,p_vat_choice:vatChoice,
   });
   if(result.error)throw result.error;
   setDone(result.data as {document_id:string;invoice_no:string;status:string;gross:number});
  }catch(e:any){setError(e?.message||'Unable to create invoice. No Trip was modified.')}
  finally{setSaving(false)}
 }
 const sideName=side==='customer'?'Sale':'Purchase';
 return <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-xs" aria-label={`${sideName} Invoice`}>
  <div className="flex flex-wrap items-start justify-between gap-2">
   <div><h2 className="text-base font-bold">{sideName} Invoice — No Trips</h2>
    <p className="text-slate-600">Description-only service document. Uses {side==='customer'?'Customer':'Supplier'} Master, canonical {side==='customer'?'AR':'AP'}, VAT, ledgers and financial reports. No stock or Trip records. {side==='customer'&&'Vehicle is a reporting dimension; selected Sales Revenue stays unchanged with no duplicate journal.'}</p>
   </div>
   <Link className="text-blue-700 underline" to="/settings/imports">Bulk import in Import Center</Link>
  </div>
  {loading&&<p role="status">Loading {sideName} masters…</p>}
  {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-red-700">{error}</p>}
  {done&&<div role="status" className="rounded border border-emerald-200 bg-emerald-50 p-2">
    <strong>{sideName} invoice {done.status}: {done.invoice_no}</strong> · Amount {Number(done.gross).toLocaleString('en-US',{minimumFractionDigits:2})}.
    <p>Posted invoices update canonical {side==='customer'?'receivables':'payables'} and accounting. Record actual payments separately.</p>
    <div className="mt-2 flex gap-2"><Link to={`/${side==='customer'?'sales':'purchase'}/${done.document_id}`} className="btn">View Invoice</Link>
     <button className="btn-primary" onClick={()=>{setDone(null);setParty('');setNumber('');setReference('');setVatChoice('master');setLines([empty()]);}}>Create Another</button></div>
   </div>}
  <fieldset disabled={loading||saving||!!done||loadedScope!==scope} className="grid gap-2 md:grid-cols-4">
   <label className="block font-semibold">{side==='customer'?'Customer Master':'Supplier Master'} *
    <NaviloSearchableSelect nativeCompatibility preserveLabel aria-label={side==='customer'?'Normal invoice customer':'Normal invoice supplier'} className="input mt-1 w-full" value={party} onChange={e=>setParty(e.target.value)}>
     <option value="">Select {side==='customer'?'Customer':'Supplier'}</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
    </NaviloSearchableSelect>
   </label>
   <label className="block font-semibold">Invoice Date *<NaviloDateInput type="date" className="input mt-1 w-full" value={date} onChange={e=>setDate(e.target.value)}/></label>
   <label className="block font-semibold">Invoice Number
    <input className="input mt-1 w-full" maxLength={80} aria-label="Normal invoice number" value={number} onChange={e=>setNumber(e.target.value)} placeholder="Original number required for Credit Sales"/>
   </label>
   <label className="block font-semibold">Reference (optional)
    <input className="input mt-1 w-full" value={reference} maxLength={120} onChange={e=>setReference(e.target.value)}/>
   </label>
   <label className="block font-semibold">VAT Treatment<NaviloSearchableSelect nativeCompatibility aria-label="Normal invoice VAT treatment" className="input mt-1 w-full" value={vatChoice} onChange={e=>setVatChoice(e.target.value as 'master'|'with_vat'|'without_vat')}><option value="master">Auto (Master Cash/Credit)</option><option value="with_vat">With VAT</option><option value="without_vat">Without VAT</option></NaviloSearchableSelect></label>
   <label className="block font-semibold md:col-span-3">{side==='customer'?'General / Shared Revenue COA':'Expense Account'} *
    <NaviloSearchableSelect nativeCompatibility preserveLabel aria-label="Normal invoice ledger account" className="input mt-1 w-full" value={account} onChange={e=>setAccount(e.target.value)}>
     <option value="">Select active company account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
    </NaviloSearchableSelect>
   </label>
  </fieldset>
  <div className="space-y-1">
   <div className="flex items-center justify-between"><h3 className="font-bold">Description lines (excluding VAT)</h3><button type="button" disabled={saving||!!done||lines.length>=50} className="btn" onClick={()=>setLines(v=>[...v,empty()])}>+ Description Line</button></div>
   {lines.map((line,i)=><div key={i} className="grid grid-cols-[minmax(0,1fr)_190px_130px_45px] gap-2">
    <input aria-label={`Description ${i+1}`} className="input" placeholder="Description (no Trip)" value={line.description} maxLength={1000} disabled={saving||!!done} onChange={e=>update(i,'description',e.target.value)}/>
    <NaviloSearchableSelect nativeCompatibility aria-label={`Vehicle ${i+1}`} className="input" value={line.vehicle_id??''} disabled={saving||!!done} onChange={e=>update(i,'vehicle_id',e.target.value)}><option value="">General / Shared</option>{eligibleVehicles.map(v=><option key={v.id} value={v.id}>{v.vehicle_no}</option>)}</NaviloSearchableSelect>
    <input aria-label={`Amount ${i+1}`} className="input text-right" inputMode="decimal" placeholder="Amount SAR" value={line.amount} disabled={saving||!!done} onChange={e=>update(i,'amount',e.target.value)}/>
    <button type="button" aria-label={`Remove line ${i+1}`} className="btn" disabled={saving||!!done||lines.length<=1} onClick={()=>setLines(v=>v.filter((_,index)=>index!==i))}>×</button>
   </div>)}
  </div>
  <div className="flex flex-wrap items-center justify-between border-t pt-2 gap-2">
   <span><strong>Net: SAR {amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong> · Selected VAT must match the effective Customer/Supplier Master billing rule.</span>
   <div className="flex gap-2"><button type="button" className="btn" disabled={!available} onClick={()=>void save(false)}>{saving?'Saving…':'Save Draft'}</button>
    <button type="button" className="btn-primary" disabled={!available} onClick={()=>void save(true)}>{saving?'Posting…':`Post ${sideName} Invoice`}</button></div>
  </div>
  {side==='customer'&&<p className="text-slate-500">Each vehicle line posts to its linked Income COA in <Link to="/master-data/vehicles" className="text-blue-700 underline">Vehicle Master</Link>; the General / Shared account applies only to lines without a vehicle.</p>}
  {lineError&&<p role="status" className="text-amber-800">{lineError}</p>}
 </section>;
}
