import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useAuth} from '@/auth/AuthContext';
import NaviloDateInput from '@/components/NaviloDateInput';

type Props={onClose:()=>void;onChanged:()=>Promise<void>};
type Master={id:string;name:string;is_active?:boolean};
type Charge={id:string;code:string;name:string;is_active:boolean};
const money=(v:unknown)=>Number(v??0).toFixed(2);

export default function TransportRateList({onClose,onChanged}:Props){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const [customers,setCustomers]=useState<Master[]>([]),[trucks,setTrucks]=useState<Master[]>([]),[locations,setLocations]=useState<Master[]>([]);
 const [charges,setCharges]=useState<Charge[]>([]),[routeRates,setRouteRates]=useState<any[]>([]),[chargeRates,setChargeRates]=useState<any[]>([]);
 const [customer,setCustomer]=useState(''),[truck,setTruck]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[routeAmount,setRouteAmount]=useState('');
 const year=new Date().getFullYear();const [effectiveFrom,setEffectiveFrom]=useState(`${year}-01-01`),[effectiveTo,setEffectiveTo]=useState(`${year}-12-31`);
 const [code,setCode]=useState(''),[chargeName,setChargeName]=useState(''),[chargeType,setChargeType]=useState(''),[chargeAmount,setChargeAmount]=useState(''),[chargeStatus,setChargeStatus]=useState<'agreed'|'pending'>('agreed');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const scope=`${activeCompany?.company_id}/${activeBusinessUnit?.business_unit_id}`;

 async function load(){
  const c=activeCompany?.company_id,b=activeBusinessUnit?.business_unit_id;if(!c||!b)return;
  const [cu,tr,lo,ch,rr,cr]=await Promise.all([
   supabase.from('customers').select('id,name,is_active').eq('company_id',c).eq('is_active',true).order('name'),
   supabase.from('transport_truck_types').select('id,name,is_active').eq('company_id',c).eq('business_unit_id',b).eq('is_active',true).order('name'),
   supabase.from('transport_locations').select('id,name,is_active').eq('company_id',c).eq('business_unit_id',b).eq('is_active',true).order('name'),
   supabase.from('transport_charge_types').select('*').eq('company_id',c).eq('business_unit_id',b).order('code'),
   supabase.from('transport_customer_rates').select('*,customers(name),transport_truck_types(name),from:transport_locations!transport_customer_rates_company_id_business_unit_id_from__fkey(name),to:transport_locations!transport_customer_rates_company_id_business_unit_id_to_lo_fkey(name)').eq('company_id',c).eq('business_unit_id',b).order('effective_from',{ascending:false}).limit(500),
   supabase.from('transport_customer_charge_rates').select('*,customers(name),transport_charge_types!transport_customer_charge_rates_charge_type_id_fkey(code,name)').eq('company_id',c).eq('business_unit_id',b).order('effective_from',{ascending:false}).limit(500)
  ]);
  for(const r of [cu,tr,lo,ch,rr,cr])if(r.error)throw r.error;
  setCustomers(cu.data??[]);setTrucks(tr.data??[]);setLocations(lo.data??[]);setCharges(ch.data??[]);setRouteRates(rr.data??[]);setChargeRates(cr.data??[]);
 }
 useEffect(()=>{setError('');void load().catch(e=>setError(e.message))},[scope]);
 const filteredRoutes=useMemo(()=>routeRates.filter(r=>!customer||r.customer_id===customer),[routeRates,customer]);
 const filteredCharges=useMemo(()=>chargeRates.filter(r=>!customer||r.customer_id===customer),[chargeRates,customer]);

 async function addRoute(){
  if(!customer||!truck||!from||!to||routeAmount===''||Number(routeAmount)<0||!effectiveFrom)return;
  setBusy(true);setError('');setMessage('');
  try{const r=await supabase.from('transport_customer_rates').insert({company_id:activeCompany?.company_id,business_unit_id:activeBusinessUnit?.business_unit_id,customer_id:customer,truck_type_id:truck,from_location_id:from,to_location_id:to,amount:Number(routeAmount),effective_from:effectiveFrom,effective_to:effectiveTo||null,is_active:true});if(r.error)throw r.error;setMessage('Base route rate added.');setRouteAmount('');await load();await onChanged();}catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function addChargeType(){
  if(!code.trim()||!chargeName.trim())return;setBusy(true);setError('');setMessage('');
  try{const r=await supabase.rpc('transport_save_charge_type',{p_id:null,p_code:code.trim(),p_name:chargeName.trim(),p_active:true});if(r.error)throw r.error;setCode('');setChargeName('');setMessage('Charge type added.');await load();}catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function addChargeRate(){
  if(!customer||!chargeType||!effectiveFrom||(chargeStatus==='agreed'&&(chargeAmount===''||Number(chargeAmount)<0)))return;setBusy(true);setError('');setMessage('');
  try{const r=await supabase.rpc('transport_save_customer_charge_rate',{p_id:null,p_customer_id:customer,p_charge_type_id:chargeType,p_effective_from:effectiveFrom,p_effective_to:effectiveTo||null,p_amount:chargeStatus==='agreed'?Number(chargeAmount):null,p_status:chargeStatus,p_active:true});if(r.error)throw r.error;setChargeAmount('');setMessage('Customer charge rate added.');await load();await onChanged();}catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-3">
  <section role="dialog" aria-modal="true" className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white text-xs shadow-2xl">
   <header className="flex items-center justify-between border-b bg-slate-900 px-3 py-2 text-white"><div><h2 className="text-sm font-bold">Customer Rate List / Quotation</h2><p className="text-[10px] text-slate-300">Annual route rates + company-specific additional charges. Old periods remain historical.</p></div><button className="btn h-7" disabled={busy} onClick={onClose}>Close</button></header>
   {error&&<p role="alert" className="mx-3 mt-2 rounded bg-red-50 p-2 text-red-700">{error}</p>}{message&&<p role="status" className="mx-3 mt-2 rounded bg-emerald-50 p-2 text-emerald-700">{message}</p>}
   <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto p-3 lg:grid-cols-2">
    <section className="rounded border p-2"><h3 className="mb-2 font-bold">Base Route Rates</h3>
     <div className="grid grid-cols-2 gap-1">
      <label>Company<select className="input h-8" value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">Select company</option>{customers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label>Truck Type<select className="input h-8" value={truck} onChange={e=>setTruck(e.target.value)}><option value="">Select truck</option>{trucks.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label>From<select className="input h-8" value={from} onChange={e=>setFrom(e.target.value)}><option value="">From</option>{locations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label>To<select className="input h-8" value={to} onChange={e=>setTo(e.target.value)}><option value="">To</option>{locations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label>Rate<input className="input h-8" type="number" min="0" step="0.01" value={routeAmount} onChange={e=>setRouteAmount(e.target.value)}/></label>
      <div className="grid grid-cols-2 gap-1"><label>From<NaviloDateInput className="input h-8" type="date" value={effectiveFrom} onChange={e=>setEffectiveFrom(e.target.value)}/></label><label>To<NaviloDateInput className="input h-8" type="date" value={effectiveTo} onChange={e=>setEffectiveTo(e.target.value)}/></label></div>
     </div><button className="btn-primary mt-2 h-8" disabled={busy||!customer||!truck||!from||!to||routeAmount===''} onClick={()=>void addRoute()}>Add Route Rate</button>
     <div className="mt-2 max-h-64 overflow-auto border"><table className="w-full text-[10px]"><thead className="sticky top-0 bg-slate-100"><tr><th>Company</th><th>Truck</th><th>Route</th><th>Rate</th><th>Valid</th></tr></thead><tbody>{filteredRoutes.map(r=><tr key={r.id} className="border-t"><td>{r.customers?.name}</td><td>{r.transport_truck_types?.name}</td><td>{r.from?.name} → {r.to?.name}</td><td className="text-right">{money(r.amount)}</td><td>{r.effective_from} → {r.effective_to||'Open'}</td></tr>)}</tbody></table></div>
    </section>
    <section className="rounded border p-2"><h3 className="mb-2 font-bold">Additional Charges</h3>
     <div className="rounded bg-slate-50 p-2"><div className="grid grid-cols-[90px_1fr_auto] gap-1"><input className="input h-8" placeholder="Code e.g. W" value={code} onChange={e=>setCode(e.target.value.toUpperCase())}/><input className="input h-8" placeholder="Waiting / Cancellation" value={chargeName} onChange={e=>setChargeName(e.target.value)}/><button className="btn h-8" disabled={busy||!code.trim()||!chargeName.trim()} onClick={()=>void addChargeType()}>+ Charge</button></div></div>
     <div className="mt-2 grid grid-cols-2 gap-1">
      <label>Company<select className="input h-8" value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">Select company</option>{customers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label>Charge<select className="input h-8" value={chargeType} onChange={e=>setChargeType(e.target.value)}><option value="">Select charge</option>{charges.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></label>
      <label>Status<select className="input h-8" value={chargeStatus} onChange={e=>setChargeStatus(e.target.value as any)}><option value="agreed">Agreed</option><option value="pending">Pending</option></select></label>
      <label>Amount<input className="input h-8" type="number" min="0" step="0.01" disabled={chargeStatus==='pending'} value={chargeAmount} onChange={e=>setChargeAmount(e.target.value)} placeholder={chargeStatus==='pending'?'Pending':'0.00'}/></label>
     </div><button className="btn-primary mt-2 h-8" disabled={busy||!customer||!chargeType||(chargeStatus==='agreed'&&chargeAmount==='')} onClick={()=>void addChargeRate()}>Add Charge Rate</button>
     <div className="mt-2 max-h-64 overflow-auto border"><table className="w-full text-[10px]"><thead className="sticky top-0 bg-slate-100"><tr><th>Company</th><th>Charge</th><th>Status</th><th>Amount</th><th>Valid</th></tr></thead><tbody>{filteredCharges.map(r=><tr key={r.id} className="border-t"><td>{r.customers?.name}</td><td>{r.transport_charge_types?.code} · {r.transport_charge_types?.name}</td><td>{r.status}</td><td className="text-right">{r.amount==null?'Pending':money(r.amount)}</td><td>{r.effective_from} → {r.effective_to||'Open'}</td></tr>)}</tbody></table></div>
    </section>
   </div>
  </section>
 </div>;
}
