import { useEffect,useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { canTransportAction } from "@/auth/permissions";
import { supabase } from "@/lib/supabase";

type Vehicle={id:string;vehicle_no:string};
type Supplier={id:string;name:string};
type Period={id:string;vehicle_id:string;owner_type:string;supplier_id:string|null;owner_name_snapshot:string|null;effective_from:string;effective_to:string|null};
export default function TransportVehicleOwnership(){
 const{activeCompany,activeBusinessUnit,isPlatformOwner}=useAuth();
 const allowed=canTransportAction(activeBusinessUnit?.membership_role??activeCompany?.membership_role,activeBusinessUnit?.permissions??activeCompany?.permissions,"vehicle_owner_change",isPlatformOwner);
 const[vehicles,setVehicles]=useState<Vehicle[]>([]),[suppliers,setSuppliers]=useState<Supplier[]>([]),[periods,setPeriods]=useState<Period[]>([]);
 const[vehicle,setVehicle]=useState(""),[ownerType,setOwnerType]=useState("company"),[supplier,setSupplier]=useState(""),[start,setStart]=useState(""),[end,setEnd]=useState(""),[error,setError]=useState("");
 const load=async()=>{const[v,s,p]=await Promise.all([supabase.from("transport_vehicles").select("id,vehicle_no").order("vehicle_no"),supabase.from("suppliers").select("id,name").order("name"),supabase.from("transport_vehicle_ownership").select("*").order("effective_from",{ascending:false})]);
 const first=[v.error,s.error,p.error].find(Boolean);if(first)setError(first.message);else{setVehicles((v.data??[]) as Vehicle[]);setSuppliers((s.data??[]) as Supplier[]);setPeriods((p.data??[]) as Period[])} };
 useEffect(()=>{void load()},[activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);
 const save=async(e:React.FormEvent)=>{e.preventDefault();if(!allowed||!vehicle||!start||ownerType==="third_party"&&!supplier)return;
 const selected=suppliers.find(x=>x.id===supplier);
 const {error:failure}=await supabase.from("transport_vehicle_ownership").insert({company_id:activeCompany?.company_id,business_unit_id:activeBusinessUnit?.business_unit_id,vehicle_id:vehicle,owner_type:ownerType,supplier_id:ownerType==="third_party"?supplier:null,owner_name_snapshot:ownerType==="third_party"?selected?.name??null:activeCompany?.company_name??null,effective_from:start,effective_to:end||null});
 if(failure)setError(failure.message);else{setError("");setStart("");setEnd("");await load()};};
 const closePeriod=async(row:Period)=>{if(!allowed)return;const date=window.prompt("Last effective date (YYYY-MM-DD)",row.effective_to||"");if(date===null)return;const reason=window.prompt("Reason for ending ownership period");if(!date||!reason?.trim())return;
 const{error:failure}=await supabase.from("transport_vehicle_ownership").update({effective_to:date,change_reason:reason.trim()}).eq("id",row.id);
 if(failure)setError(failure.message);else{setError("");await load();}};
 return <section className="space-y-4 rounded-xl border bg-white p-4"><h1 className="text-xl font-bold">Vehicle Ownership History</h1><p className="text-xs text-slate-600">Enter actual effective dates. Existing vehicle owner fields remain available for historical compatibility.</p>{error&&<p role="alert" className="text-red-700">{error}</p>}
 {allowed&&<form onSubmit={save} className="flex flex-wrap items-end gap-2"><label className="text-xs">Vehicle<select required className="input block" value={vehicle} onChange={e=>setVehicle(e.target.value)}><option value="">Select</option>{vehicles.map(x=><option key={x.id} value={x.id}>{x.vehicle_no}</option>)}</select></label><label className="text-xs">Ownership<select className="input block" value={ownerType} onChange={e=>setOwnerType(e.target.value)}><option value="company">Company Owned</option><option value="third_party">Third-Party</option></select></label>{ownerType==="third_party"&&<label className="text-xs">Supplier<select required className="input block" value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">Select</option>{suppliers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}<label className="text-xs">From<input required className="input block" type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label className="text-xs">Through (optional)<input className="input block" type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><button className="btn-primary">Add Period</button></form>}
 <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr>{["Vehicle","Owner","From","Through","Action"].map(h=><th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{periods.map(x=><tr key={x.id} className="border-t"><td className="p-2">{vehicles.find(v=>v.id===x.vehicle_id)?.vehicle_no}</td><td className="p-2">{x.owner_name_snapshot||x.owner_type}</td><td className="p-2">{x.effective_from}</td><td className="p-2">{x.effective_to||"Current"}</td><td className="p-2">{allowed&&!x.effective_to&&<button className="btn-secondary" onClick={()=>void closePeriod(x)}>End Period</button>}</td></tr>)}</tbody></table></div></section>;
}
