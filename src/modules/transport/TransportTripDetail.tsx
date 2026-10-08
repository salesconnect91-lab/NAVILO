import NaviloSearchableSelect from "@/components/SearchableSelect";
import NaviloDateInput from '@/components/NaviloDateInput';
import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { canTransportAction, type TransportAction } from "@/auth/permissions";
import { supabase } from "@/lib/supabase";

type Trip = { id:string; trip_no:string; po_do_job_no:string|null; job_status:string; lifecycle_status:string; rent_state:string;
  ppr_status:string; ppr_received_by_employee_id:string|null; ppr_received_date:string|null; customer_rate:number;
  customer_rate_state:string; owner_rent:number; vehicle_id:string|null; driver_id:string|null };
type Person = { id:string; name:string };
type Simple = { id:string; vehicle_no?:string; driver_name?:string };
type Rent = { id:string; supplier_name_snapshot:string; amount:number; state:string };
type Audit = { id:number; action:string; occurred_at:string; reason:string|null; old_value:unknown; new_value:unknown };

export default function TransportTripDetail({tripId,onClose,onSaved}:{tripId:string;onClose:()=>void;onSaved:()=>void}){
  const {activeCompany,activeBusinessUnit,isPlatformOwner}=useAuth();
  const role=activeBusinessUnit?.membership_role??activeCompany?.membership_role;
  const permissions={...activeCompany?.permissions,...activeBusinessUnit?.permissions,transport_actions:{...((activeCompany?.permissions?.transport_actions??{}) as Record<string,boolean>),...((activeBusinessUnit?.permissions?.transport_actions??{}) as Record<string,boolean>)}};
  const can=(action:TransportAction)=>canTransportAction(role,permissions,action,isPlatformOwner);
  const [trip,setTrip]=useState<Trip|null>(null),[rents,setRents]=useState<Rent[]>([]),[audit,setAudit]=useState<Audit[]>([]);
  const [employees,setEmployees]=useState<Person[]>([]),[suppliers,setSuppliers]=useState<Person[]>([]);
  const [vehicles,setVehicles]=useState<Simple[]>([]),[drivers,setDrivers]=useState<Simple[]>([]);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [job,setJob]=useState(""),[employee,setEmployee]=useState(""),[date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [rate,setRate]=useState(""),[rateReason,setRateReason]=useState(""),[rent,setRent]=useState(""),[rentReason,setRentReason]=useState("");
  const [supplier,setSupplier]=useState(""),[supplierAmount,setSupplierAmount]=useState(""),[vehicle,setVehicle]=useState(""),[driver,setDriver]=useState(""),[replacementReason,setReplacementReason]=useState("");
  const load=async()=>{
    const [t,r,a,e,s,v,d]=await Promise.all([
      supabase.from("transport_trips").select("*").eq("id",tripId).single(),
      supabase.from("transport_trip_supplier_rents").select("id,supplier_name_snapshot,amount,state").eq("trip_id",tripId),
      supabase.from("transport_trip_audit").select("id,action,occurred_at,reason,old_value,new_value").eq("trip_id",tripId).order("occurred_at",{ascending:false}),
      supabase.from("employees").select("id,name").eq("is_active",true),
      supabase.from("suppliers").select("id,name"),
      supabase.from("transport_vehicles").select("id,vehicle_no").eq("is_active",true),
      supabase.from("transport_drivers").select("id,driver_name").eq("is_active",true)
    ]);
    const first=[t.error,r.error,a.error,e.error,s.error,v.error,d.error].find(Boolean);
    if(first){setError(first.message);return;}
    const next=t.data as Trip;
    setTrip(next);setJob(next.po_do_job_no??"");setRate(String(next.customer_rate));setRent(String(next.owner_rent));
    setRents((r.data??[]) as Rent[]);setAudit((a.data??[]) as Audit[]);setEmployees((e.data??[]) as Person[]);
    setSuppliers((s.data??[]) as Person[]);setVehicles((v.data??[]) as Simple[]);setDrivers((d.data??[]) as Simple[]);
    setVehicle(next.vehicle_id??"");setDriver(next.driver_id??"");
  };
  useEffect(()=>{void load()},[tripId]);
  const run=async(action:()=>PromiseLike<{error:{message:string}|null}>)=>{
    setBusy(true);setError("");const result=await action();setBusy(false);
    if(result.error)setError(result.error.message);else {await load();onSaved();}
  };
  if(!trip)return <div className="rounded-xl border bg-white p-4">{error||"Loading Trip…"}<button className="btn-secondary ml-3" onClick={onClose}>Close</button></div>;
  return <section className="space-y-4 rounded-xl border border-blue-200 bg-white p-4" aria-label="Trip detail">
    <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Trip {trip.trip_no}</h2><p className="text-xs text-slate-600">{trip.lifecycle_status.replaceAll("_"," ")} · Job {trip.job_status} · Rent {trip.rent_state} · PPR {trip.ppr_status}</p></div><button className="btn-secondary" onClick={onClose}>Close</button></div>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border p-3"><h3 className="font-semibold">Job and PPR</h3>
        {can("trip_edit")&&<div className="mt-2 flex gap-2"><input className="input flex-1" aria-label="PO DO Job number" value={job} onChange={e=>setJob(e.target.value)}/><button className="btn-secondary" disabled={busy} onClick={()=>void run(()=>supabase.rpc("transport_update_operational_trip",{p_trip_id:tripId,p_changes:{po_do_job_no:job.trim()||null}}))}>Save Job</button></div>}
        {can("ppr_receive")&&can("trip_edit")&&<div className="mt-3 flex flex-wrap gap-2"><NaviloSearchableSelect nativeCompatibility preserveLabel className="input" aria-label="PPR received by" value={employee} onChange={e=>setEmployee(e.target.value)}><option value="">Employee</option>{employees.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</NaviloSearchableSelect><NaviloDateInput className="input" aria-label="PPR received date" type="date" value={date} onChange={e=>setDate(e.target.value)}/><button className="btn-secondary" disabled={busy||!employee} onClick={()=>void run(()=>supabase.rpc("transport_update_operational_trip",{p_trip_id:tripId,p_changes:{ppr_status:"received",ppr_received_by_employee_id:employee,ppr_received_date:date}}))}>Mark Received</button></div>}
      </div>
      <div className="rounded-lg border p-3"><h3 className="font-semibold">Customer Rate</h3><p className="text-xs">{trip.customer_rate_state} · {trip.customer_rate}</p>
        {can(trip.customer_rate_state==="finalized"?"customer_rate_override":"customer_rate_finalize")&&<div className="mt-2 flex flex-wrap gap-2"><input className="input w-32" type="number" min="0" step="0.01" aria-label="Customer rate" value={rate} onChange={e=>setRate(e.target.value)}/><input className="input flex-1" placeholder="Correction reason if finalized" value={rateReason} onChange={e=>setRateReason(e.target.value)}/><button className="btn-secondary" disabled={busy} onClick={()=>void run(()=>supabase.rpc("transport_finalize_customer_rate",{p_trip_id:tripId,p_amount:Number(rate),p_source:"manual",p_reason:rateReason||null}))}>Finalize Rate</button></div>}
      </div>
      <div className="rounded-lg border p-3"><h3 className="font-semibold">Owner / Supplier Rents</h3>
        <p className="text-xs">Legacy owner rent {trip.owner_rent}; supplier lines are separately recorded. Financial register remains on its legacy formula.</p>
        {rents.map(x=><div key={x.id} className="flex justify-between border-b py-1 text-sm"><span>{x.supplier_name_snapshot} · {x.amount} · {x.state}</span>{can(x.state==="finalized"?"rent_correct":"rent_finalize")&&<button className="btn-secondary" disabled={busy} onClick={()=>{const amount=window.prompt("Final rent amount",String(x.amount));const reason=x.state==="finalized"?window.prompt("Correction reason") : null;if(amount!==null&&(x.state!=="finalized"||reason))void run(()=>supabase.rpc("transport_finalize_supplier_rent",{p_rent_id:x.id,p_amount:Number(amount),p_reason:reason}));}}>Finalize / Correct</button>}</div>)}
        {can("rent_finalize")&&trip.rent_state==="pending"&&<div className="mt-2 flex flex-wrap gap-2"><NaviloSearchableSelect nativeCompatibility preserveLabel className="input" aria-label="Supplier" value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">Supplier</option>{suppliers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</NaviloSearchableSelect><input className="input w-28" type="number" min="0" step="0.01" aria-label="Supplier rent" value={supplierAmount} onChange={e=>setSupplierAmount(e.target.value)}/><button className="btn-secondary" disabled={busy||!supplier} onClick={()=>void run(()=>supabase.from("transport_trip_supplier_rents").insert({company_id:activeCompany?.company_id,business_unit_id:activeBusinessUnit?.business_unit_id,trip_id:tripId,supplier_id:supplier,amount:Number(supplierAmount),supplier_name_snapshot:"Pending"}))}>Add Rent</button></div>}
        {can(trip.rent_state==="finalized"?"rent_correct":"rent_finalize")&&<div className="mt-2 flex flex-wrap gap-2"><input className="input w-28" type="number" min="0" step="0.01" aria-label="Legacy owner rent" value={rent} onChange={e=>setRent(e.target.value)}/><input className="input flex-1" placeholder="Correction reason" value={rentReason} onChange={e=>setRentReason(e.target.value)}/><button className="btn-secondary" disabled={busy} onClick={()=>void run(()=>trip.rent_state==="finalized"?supabase.rpc("transport_correct_trip_rent",{p_trip_id:tripId,p_owner_rent:Number(rent),p_reason:rentReason}):supabase.rpc("transport_finalize_trip_rent",{p_trip_id:tripId,p_reason:null}))}>{trip.rent_state==="finalized"?"Correct Rent":"Complete Trip"}</button></div>}
      </div>
      <div className="rounded-lg border p-3"><h3 className="font-semibold">Vehicle / Driver Replacement</h3>
        {can("assignment_replace")&&<div className="mt-2 flex flex-wrap gap-2"><NaviloSearchableSelect nativeCompatibility preserveLabel className="input" aria-label="Replacement vehicle" value={vehicle} onChange={e=>setVehicle(e.target.value)}><option value="">No vehicle</option>{vehicles.map(x=><option key={x.id} value={x.id}>{x.vehicle_no}</option>)}</NaviloSearchableSelect><NaviloSearchableSelect nativeCompatibility preserveLabel className="input" aria-label="Replacement driver" value={driver} onChange={e=>setDriver(e.target.value)}><option value="">No driver</option>{drivers.map(x=><option key={x.id} value={x.id}>{x.driver_name}</option>)}</NaviloSearchableSelect><input className="input" placeholder="Required reason" value={replacementReason} onChange={e=>setReplacementReason(e.target.value)}/><button className="btn-secondary" disabled={busy||!replacementReason.trim()} onClick={()=>void run(()=>supabase.rpc("transport_replace_trip_assignment",{p_trip_id:tripId,p_vehicle_id:vehicle||null,p_driver_id:driver||null,p_reason:replacementReason}))}>Replace</button></div>}
      </div>
    </div>
    <div className="rounded-lg border p-3"><h3 className="font-semibold">Trip Audit / Change History</h3>{audit.map(x=><div key={x.id} className="border-t py-2 text-xs"><strong>{x.action}</strong> · {new Date(x.occurred_at).toLocaleString()} · {x.reason||"—"}<div className="break-all text-slate-500">{JSON.stringify(x.old_value)} → {JSON.stringify(x.new_value)}</div></div>)}</div>
  </section>;
}
