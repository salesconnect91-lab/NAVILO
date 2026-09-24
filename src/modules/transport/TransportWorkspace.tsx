import { useEffect, useMemo, useState } from "react";
import { Calculator, Plus, Search, Truck } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";

type TripRow={
  id:string; trip_no:string; trip_date:string; status:string; ppr_status:string; po_do_job_no:string|null;
  customer_name:string|null; vehicle_no:string|null; truck_type:string|null; driver_name:string|null; owner_name:string|null;
  from_location:string|null; to_location:string|null; service_period:string|null; customer_rate:number; total_cost:number; trip_profit:number;
};
type Vehicle={id:string;vehicle_no:string;truck_type:string|null;owner_name:string|null};
type Driver={id:string;driver_name:string;owner_name:string|null};
type Customer={id:string;name:string};

const money=(v:number|null|undefined)=>Number(v??0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});

export default function TransportWorkspace(){
  const{activeCompany,activeBusinessUnit}=useAuth();
  const[trips,setTrips]=useState<TripRow[]>([]),[vehicles,setVehicles]=useState<Vehicle[]>([]),[drivers,setDrivers]=useState<Driver[]>([]),[customers,setCustomers]=useState<Customer[]>([]);
  const[query,setQuery]=useState(""),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[showNew,setShowNew]=useState(false);
  const[form,setForm]=useState({trip_no:"",trip_date:new Date().toISOString().slice(0,10),customer_id:"",vehicle_id:"",driver_id:"",po_do_job_no:"",from_location:"",to_location:"",service_period:"",customer_rate:"",driver_pay:"",owner_rent:"",fuel_cost:"",toll_cost:"",other_cost:"",ppr_status:"pending",status:"draft"});

  const load=async()=>{
    setLoading(true);setError(null);
    const [t,v,d,c]=await Promise.all([
      supabase.from("transport_trip_register").select("*").order("trip_date",{ascending:false}).order("trip_no",{ascending:false}).limit(500),
      supabase.from("transport_vehicles").select("id,vehicle_no,truck_type,owner_name").eq("is_active",true).order("vehicle_no"),
      supabase.from("transport_drivers").select("id,driver_name,owner_name").eq("is_active",true).order("driver_name"),
      supabase.from("customers").select("id,name").order("name").limit(1000),
    ]);
    const first=[t.error,v.error,d.error,c.error].find(Boolean);
    if(first)setError(first?.message??"Transport data could not be loaded.");
    setTrips((t.data??[]) as TripRow[]);setVehicles((v.data??[]) as Vehicle[]);setDrivers((d.data??[]) as Driver[]);setCustomers((c.data??[]) as Customer[]);setLoading(false);
  };
  useEffect(()=>{void load();},[activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);

  const filtered=useMemo(()=>{const q=query.trim().toLowerCase();if(!q)return trips;return trips.filter(t=>[t.trip_no,t.customer_name,t.vehicle_no,t.truck_type,t.driver_name,t.owner_name,t.po_do_job_no,t.from_location,t.to_location,t.service_period,t.status,t.ppr_status].some(v=>String(v??"").toLowerCase().includes(q)));},[trips,query]);
  const totals=useMemo(()=>filtered.reduce((a,t)=>({revenue:a.revenue+Number(t.customer_rate||0),cost:a.cost+Number(t.total_cost||0),profit:a.profit+Number(t.trip_profit||0)}),{revenue:0,cost:0,profit:0}),[filtered]);

  const saveTrip=async(e:React.FormEvent)=>{
    e.preventDefault();setError(null);
    if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)return setError("Select an active Transport business unit.");
    if(!form.trip_no.trim())return setError("Trip number is required.");
    const vehicle=vehicles.find(x=>x.id===form.vehicle_id),driver=drivers.find(x=>x.id===form.driver_id),customer=customers.find(x=>x.id===form.customer_id);
    const payload={company_id:activeCompany.company_id,business_unit_id:activeBusinessUnit.business_unit_id,trip_no:form.trip_no.trim(),trip_date:form.trip_date,
      customer_id:form.customer_id||null,customer_name_snapshot:customer?.name??null,vehicle_id:form.vehicle_id||null,driver_id:form.driver_id||null,
      owner_name_snapshot:vehicle?.owner_name??driver?.owner_name??null,truck_type:vehicle?.truck_type??null,po_do_job_no:form.po_do_job_no||null,
      from_location:form.from_location||null,to_location:form.to_location||null,service_period:form.service_period||null,ppr_status:form.ppr_status,status:form.status,
      customer_rate:Number(form.customer_rate||0),driver_pay:Number(form.driver_pay||0),owner_rent:Number(form.owner_rent||0),fuel_cost:Number(form.fuel_cost||0),
      toll_cost:Number(form.toll_cost||0),other_cost:Number(form.other_cost||0)};
    const{error:saveError}=await supabase.from("transport_trips").insert(payload);
    if(saveError)return setError(saveError.message);
    setShowNew(false);setForm(f=>({...f,trip_no:"",customer_id:"",vehicle_id:"",driver_id:"",po_do_job_no:"",from_location:"",to_location:"",service_period:"",customer_rate:"",driver_pay:"",owner_rent:"",fuel_cost:"",toll_cost:"",other_cost:"",ppr_status:"pending",status:"draft"}));await load();
  };

  return <div className="space-y-4">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Truck className="h-6 w-6 text-blue-700"/><h1 className="text-xl font-black text-slate-900">Transport Operations</h1></div><p className="mt-1 text-sm text-slate-500">{activeCompany?.company_name??"Company"} · {activeBusinessUnit?.business_unit_name??"Transport"}</p><p className="mt-2 text-sm text-slate-600">Trip-first workspace. Existing NAVILO accounting and Sales Invoice remain the financial source of truth.</p></div><div className="flex gap-2"><Link className="btn-secondary" to="/accounting"><Calculator className="h-4 w-4"/>Accounting</Link><button className="btn-primary" onClick={()=>setShowNew(v=>!v)}><Plus className="h-4 w-4"/>New Trip</button></div></div>
    </section>
    {error&&<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <section className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border bg-white p-4"><div className="text-xs font-bold uppercase text-slate-500">Visible Trips</div><div className="mt-1 text-2xl font-black">{filtered.length}</div></div><div className="rounded-xl border bg-white p-4"><div className="text-xs font-bold uppercase text-slate-500">Revenue</div><div className="mt-1 text-2xl font-black">SAR {money(totals.revenue)}</div></div><div className="rounded-xl border bg-white p-4"><div className="text-xs font-bold uppercase text-slate-500">Trip Profit</div><div className="mt-1 text-2xl font-black">SAR {money(totals.profit)}</div></div></section>
    {showNew&&<form onSubmit={saveTrip} className="rounded-2xl border border-blue-200 bg-white p-4 shadow-sm"><h2 className="font-black">New Trip</h2><div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
      <label className="text-xs font-bold">Trip No<input className="input mt-1 w-full" value={form.trip_no} onChange={e=>setForm({...form,trip_no:e.target.value})}/></label>
      <label className="text-xs font-bold">Date<input type="date" className="input mt-1 w-full" value={form.trip_date} onChange={e=>setForm({...form,trip_date:e.target.value})}/></label>
      <label className="text-xs font-bold">Customer<select className="input mt-1 w-full" value={form.customer_id} onChange={e=>setForm({...form,customer_id:e.target.value})}><option value="">Select</option>{customers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label className="text-xs font-bold">Vehicle<select className="input mt-1 w-full" value={form.vehicle_id} onChange={e=>setForm({...form,vehicle_id:e.target.value})}><option value="">Select</option>{vehicles.map(x=><option key={x.id} value={x.id}>{x.vehicle_no}</option>)}</select></label>
      <label className="text-xs font-bold">Driver<select className="input mt-1 w-full" value={form.driver_id} onChange={e=>setForm({...form,driver_id:e.target.value})}><option value="">Select</option>{drivers.map(x=><option key={x.id} value={x.id}>{x.driver_name}</option>)}</select></label>
      <label className="text-xs font-bold">PO / DO / Job<input className="input mt-1 w-full" value={form.po_do_job_no} onChange={e=>setForm({...form,po_do_job_no:e.target.value})}/></label>
      <label className="text-xs font-bold">From<input className="input mt-1 w-full" value={form.from_location} onChange={e=>setForm({...form,from_location:e.target.value})}/></label>
      <label className="text-xs font-bold">To<input className="input mt-1 w-full" value={form.to_location} onChange={e=>setForm({...form,to_location:e.target.value})}/></label>
      <label className="text-xs font-bold">Service Period<input className="input mt-1 w-full" placeholder="e.g. August 2026" value={form.service_period} onChange={e=>setForm({...form,service_period:e.target.value})}/></label>
      <label className="text-xs font-bold">Customer Rate<input type="number" step="0.01" className="input mt-1 w-full" value={form.customer_rate} onChange={e=>setForm({...form,customer_rate:e.target.value})}/></label>
      <label className="text-xs font-bold">Driver Pay<input type="number" step="0.01" className="input mt-1 w-full" value={form.driver_pay} onChange={e=>setForm({...form,driver_pay:e.target.value})}/></label>
      <label className="text-xs font-bold">Owner Rent<input type="number" step="0.01" className="input mt-1 w-full" value={form.owner_rent} onChange={e=>setForm({...form,owner_rent:e.target.value})}/></label>
      <label className="text-xs font-bold">Fuel<input type="number" step="0.01" className="input mt-1 w-full" value={form.fuel_cost} onChange={e=>setForm({...form,fuel_cost:e.target.value})}/></label>
      <label className="text-xs font-bold">Toll<input type="number" step="0.01" className="input mt-1 w-full" value={form.toll_cost} onChange={e=>setForm({...form,toll_cost:e.target.value})}/></label>
      <label className="text-xs font-bold">Other Cost<input type="number" step="0.01" className="input mt-1 w-full" value={form.other_cost} onChange={e=>setForm({...form,other_cost:e.target.value})}/></label>
      <label className="text-xs font-bold">PPR<select className="input mt-1 w-full" value={form.ppr_status} onChange={e=>setForm({...form,ppr_status:e.target.value})}><option value="pending">Pending</option><option value="received">Received</option><option value="not_required">Not Required</option></select></label>
      <label className="text-xs font-bold">Status<select className="input mt-1 w-full" value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="draft">Draft</option><option value="running">Running</option><option value="completed">Completed</option><option value="ready_to_invoice">Ready to Invoice</option></select></label>
    </div><div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={()=>setShowNew(false)}>Cancel</button><button className="btn-primary" type="submit">Save Trip</button></div></form>}
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b p-4"><div className="relative max-w-3xl"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><input className="input w-full pl-9" placeholder="Search trip, customer, vehicle, driver, owner, PO/job, location, period or status…" value={query} onChange={e=>setQuery(e.target.value)}/></div></div>
      <div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="bg-slate-50 text-left text-slate-600"><tr>{["Trip","Date","Customer","Vehicle","Driver","Owner","From","To / Period","PO / Job","PPR","Status","Revenue","Cost","Profit"].map(h=><th key={h} className="whitespace-nowrap px-3 py-2 font-bold">{h}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={14} className="p-6 text-center text-slate-500">Loading transport register…</td></tr>:filtered.length===0?<tr><td colSpan={14} className="p-6 text-center text-slate-500">No matching trips.</td></tr>:filtered.map(t=><tr key={t.id} className="border-t hover:bg-slate-50"><td className="px-3 py-2 font-black text-blue-700">{t.trip_no}</td><td className="whitespace-nowrap px-3 py-2">{t.trip_date}</td><td className="px-3 py-2">{t.customer_name||"—"}</td><td className="px-3 py-2">{t.vehicle_no||"—"}</td><td className="px-3 py-2">{t.driver_name||"—"}</td><td className="px-3 py-2">{t.owner_name||"—"}</td><td className="px-3 py-2">{t.from_location||"—"}</td><td className="px-3 py-2">{t.to_location||t.service_period||"—"}</td><td className="px-3 py-2">{t.po_do_job_no||"—"}</td><td className="px-3 py-2">{t.ppr_status}</td><td className="px-3 py-2">{t.status.replaceAll("_"," ")}</td><td className="px-3 py-2 text-right">{money(t.customer_rate)}</td><td className="px-3 py-2 text-right">{money(t.total_cost)}</td><td className="px-3 py-2 text-right font-bold">{money(t.trip_profit)}</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
