import NaviloSearchableSelect from "@/components/SearchableSelect";
import NaviloDateInput from '@/components/NaviloDateInput';
import { formatNaviloDate, parseNaviloDate } from "@/lib/naviloDate";
import { useEffect,useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { canTransportAction } from "@/auth/permissions";
import useTransportMasterClient from "./useTransportMasterClient";
import { fetchAllPages } from "@/lib/fetchAllPages";

type Vehicle={id:string;vehicle_no:string;is_active:boolean};
type Supplier={id:string;name:string};
type Period={id:string;vehicle_id:string;owner_type:string;supplier_id:string|null;owner_name_snapshot:string|null;effective_from:string;effective_to:string|null};
export default function TransportVehicleOwnership(){
 const{activeCompany,activeBusinessUnit,isPlatformOwner}=useAuth();
 const supabase=useTransportMasterClient();
 const[busy,setBusy]=useState(false);
 const allowed=canTransportAction(activeBusinessUnit?.membership_role??activeCompany?.membership_role,{...activeCompany?.permissions,...activeBusinessUnit?.permissions,transport_actions:{...((activeCompany?.permissions?.transport_actions??{}) as Record<string,boolean>),...((activeBusinessUnit?.permissions?.transport_actions??{}) as Record<string,boolean>)}},"vehicle_owner_change",isPlatformOwner);
 const[vehicles,setVehicles]=useState<Vehicle[]>([]),[suppliers,setSuppliers]=useState<Supplier[]>([]),[periods,setPeriods]=useState<Period[]>([]);
 const[vehicle,setVehicle]=useState(""),[ownerType,setOwnerType]=useState("company"),[supplier,setSupplier]=useState(""),[start,setStart]=useState(""),[end,setEnd]=useState(""),[error,setError]=useState("");
 const load=async()=>{try{const[v,s,p]=await Promise.all([
 fetchAllPages<Vehicle>((start,end)=>supabase.from("transport_vehicles").select("id,vehicle_no,is_active").order("id").range(start,end)),
 fetchAllPages<Supplier>((start,end)=>supabase.from("suppliers").select("id,name").eq("is_active",true).order("id").range(start,end)),
 fetchAllPages<Period>((start,end)=>supabase.from("transport_vehicle_ownership").select("*").order("id").range(start,end))]);
 const vehicleById=new Map(v.map(item=>[item.id,item]));
 const ownershipKey=(row:Period)=>{
  const plate=vehicleById.get(row.vehicle_id)?.vehicle_no?.trim().toLocaleUpperCase()??row.vehicle_id;
  return [plate,row.owner_type,row.supplier_id??"",row.owner_name_snapshot??"",row.effective_from,row.effective_to??""].join("|");
 };
 const canonicalVehicleByPlate=new Map<string,Vehicle>();
 for(const item of v){
  const key=item.vehicle_no.trim().toLocaleUpperCase();
  if(!canonicalVehicleByPlate.has(key))canonicalVehicleByPlate.set(key,item);
 }
 const canonicalVehicleIdBySourceId=new Map<string,string>();
 for(const item of v){
  const key=item.vehicle_no.trim().toLocaleUpperCase();
  canonicalVehicleIdBySourceId.set(item.id,canonicalVehicleByPlate.get(key)?.id??item.id);
 }
 const normalizedPeriods=p.map(row=>({...row,vehicle_id:canonicalVehicleIdBySourceId.get(row.vehicle_id)??row.vehicle_id}));
 const seenOwnership=new Set<string>();
 const displayPeriods=normalizedPeriods.filter(row=>{const key=ownershipKey(row);if(seenOwnership.has(key))return false;seenOwnership.add(key);return true;});
 const displayVehicles=Array.from(canonicalVehicleByPlate.values());
 setVehicles(displayVehicles);setSuppliers(s);setPeriods(displayPeriods);setError("");
 }catch(failure:any){setVehicles([]);setSuppliers([]);setPeriods([]);setError(failure.message??"Unable to load ownership history.")}};
 useEffect(()=>{void load()},[activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);
 const save=async(e:React.FormEvent)=>{e.preventDefault();if(busy||!allowed||!vehicle||!start||ownerType==="third_party"&&!supplier)return;
 if(end&&end<start)return setError("Effective Through cannot be before Effective From.");
 setBusy(true);setError("");
 const selected=suppliers.find(x=>x.id===supplier);
 const {error:failure}=await supabase.from("transport_vehicle_ownership").insert({company_id:activeCompany?.company_id,business_unit_id:activeBusinessUnit?.business_unit_id,vehicle_id:vehicle,owner_type:ownerType,supplier_id:ownerType==="third_party"?supplier:null,owner_name_snapshot:ownerType==="third_party"?selected?.name??null:activeCompany?.company_name??null,effective_from:start,effective_to:end||null});
 setBusy(false);if(failure)setError(failure.message);else{setError("");setStart("");setEnd("");window.dispatchEvent(new Event("navilo-master-data-changed"));await load()};};
 const closePeriod=async(row:Period)=>{if(busy||!allowed)return;const entered=window.prompt("Last effective date (dd-mmm-yy)",row.effective_to?formatNaviloDate(row.effective_to):"");if(entered===null)return;const date=parseNaviloDate(entered);const reason=window.prompt("Reason for ending ownership period");if(!reason?.trim())return;
 if(!date||date<row.effective_from)return setError("Enter a valid last effective date on or after Effective From.");
 setBusy(true);
 const{error:failure}=await supabase.from("transport_vehicle_ownership").update({effective_to:date,change_reason:reason.trim()}).eq("id",row.id).select("id").single();
 setBusy(false);if(failure)setError(failure.message);else{setError("");window.dispatchEvent(new Event("navilo-master-data-changed"));await load();}};
 return <section className="space-y-4 rounded-xl border bg-white p-4"><h1 className="text-xl font-bold">Vehicle Ownership History</h1><p className="text-xs text-slate-600">Enter actual effective dates. End the old period with a reason, then add the next period. Current ownership is projected from dated history; historical Trips retain their saved ownership.</p>{error&&<p role="alert" className="text-red-700">{error}</p>}
 {allowed&&<form onSubmit={save} className="flex flex-wrap items-end gap-2"><label className="text-xs">Vehicle<NaviloSearchableSelect nativeCompatibility preserveLabel required className="input block" value={vehicle} onChange={e=>setVehicle(e.target.value)}><option value="">Select</option>{vehicles.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.vehicle_no}</option>)}</NaviloSearchableSelect></label><label className="text-xs">Ownership<NaviloSearchableSelect nativeCompatibility preserveLabel className="input block" value={ownerType} onChange={e=>setOwnerType(e.target.value)}><option value="company">Company Owned</option><option value="third_party">Supplier Owned</option></NaviloSearchableSelect></label>{ownerType==="third_party"&&<label className="text-xs">Supplier<NaviloSearchableSelect nativeCompatibility preserveLabel required className="input block" value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">Select</option>{suppliers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</NaviloSearchableSelect></label>}<label className="text-xs">From<NaviloDateInput required className="input block" type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label className="text-xs">Through (optional)<NaviloDateInput className="input block" type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><button disabled={busy} className="btn-primary">Add Period</button></form>}
 <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr>{["Vehicle","Owner","From","Through","Action"].map(h=><th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{periods.map(x=><tr key={x.id} className="border-t"><td className="p-2">{vehicles.find(v=>v.id===x.vehicle_id)?.vehicle_no}</td><td className="p-2">{x.owner_name_snapshot||x.owner_type}</td><td className="p-2">{formatNaviloDate(x.effective_from)}</td><td className="p-2">{x.effective_to?formatNaviloDate(x.effective_to):"Current"}</td><td className="p-2">{allowed&&!x.effective_to&&<button className="btn-secondary" onClick={()=>void closePeriod(x)}>End Period</button>}</td></tr>)}</tbody></table></div></section>;
}
