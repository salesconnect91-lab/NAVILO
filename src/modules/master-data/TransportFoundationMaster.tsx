import { Modal } from "@/components/ui";
import type { MasterQuickCreate } from "./MasterQuickCreate";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import useTransportMasterClient from "./useTransportMasterClient";
import { fetchAllPages } from "@/lib/fetchAllPages";
import { canTransportAction } from "@/auth/permissions";

type Kind = "truck_types" | "locations" | "vehicle_expense_types";
type Row = { id: string; name: string; city_area?: string | null; expense_scope?: string | null; is_active: boolean };
const names: Record<Kind, string> = { truck_types: "Truck Types", locations: "Locations", vehicle_expense_types: "Vehicle Expense Types" };

export default function TransportFoundationMaster({ kind, quickCreate }: { kind: Kind; quickCreate?: MasterQuickCreate }) {
  const { activeCompany, activeBusinessUnit, isPlatformOwner } = useAuth();
  const supabase = useTransportMasterClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState(quickCreate?.initialName ?? "");
  const [city, setCity] = useState("");
  const [expenseScope, setExpenseScope] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const createdRecord=useRef<any>(null);
  const submitting=useRef(false);
  const table = `transport_${kind}` as "transport_truck_types" | "transport_locations" | "transport_vehicle_expense_types";
  const role = activeBusinessUnit?.membership_role ?? activeCompany?.membership_role;
  const permissions = {...activeCompany?.permissions,...activeBusinessUnit?.permissions,transport_actions:{...((activeCompany?.permissions?.transport_actions??{}) as Record<string,boolean>),...((activeBusinessUnit?.permissions?.transport_actions??{}) as Record<string,boolean>)}};
  const allowed = canTransportAction(role, permissions, "master_manage", isPlatformOwner);

  const load = async () => {
    try {
      const data = await fetchAllPages<Row>((start, end) => supabase.from(table).select("*").order("id").range(start, end));
      setRows(data); setError("");
    } catch (failure: any) { setRows([]); setError(failure.message ?? "Unable to load masters."); }
  };
  useEffect(() => { void load(); }, [kind, activeCompany?.company_id, activeBusinessUnit?.business_unit_id]);
  const reset = () => { setEditing(null); setName(""); setCity(""); setExpenseScope(""); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();if(submitting.current)return;
    if (!allowed || !activeCompany?.company_id || !activeBusinessUnit?.business_unit_id) return;
    if (!name.trim()) return setError("Name is required.");
    if (kind === "vehicle_expense_types" && !expenseScope) return setError("Select Expense Scope.");
    submitting.current=true;setBusy(true); setError("");
    try {
    const fields = { name: name.trim(), ...(kind === "locations" ? { city_area: city.trim() || null } : {}), ...(kind === "vehicle_expense_types" ? { expense_scope: expenseScope } : {}) };
    const result = createdRecord.current ? {data:createdRecord.current,error:null} : editing
      ? await supabase.from(table).update(fields).eq("id", editing).select("id").single()
      : await (()=>{const query=supabase.from(table).insert({ ...fields, company_id: activeCompany.company_id, business_unit_id: activeBusinessUnit.business_unit_id });return quickCreate?query.select("*").single():query})();
    if(result.error)throw result.error;
    if(quickCreate){
      if(!result.data?.id)throw new Error("Master creation returned no record ID.");
      createdRecord.current=result.data;window.dispatchEvent(new Event("navilo-master-data-changed"));
      await quickCreate.onCreated({id:result.data.id,name:result.data.name ?? fields.name});quickCreate.onClose();return;
    }
    reset();window.dispatchEvent(new Event("navilo-master-data-changed"));await load();
    }catch(failure:any){setError(failure.message||"Unable to save master.");}
    finally{submitting.current=false;setBusy(false);}
  };
  const toggle = async (row: Row) => {
    if (!allowed) return;
    const result = await supabase.from(table).update({ is_active: !row.is_active }).eq("id", row.id).select("id").single();
    if (result.error) setError(result.error.message); else { window.dispatchEvent(new Event("navilo-master-data-changed")); await load(); }
  };
  const editor = <form className="flex flex-wrap items-end gap-2" onSubmit={save}>
      <label className="text-xs font-semibold">Name<input className="input mt-1 block" required value={name} onChange={e => setName(e.target.value)} /></label>
      {kind === "locations" && <label className="text-xs font-semibold">City / Area<input className="input mt-1 block" value={city} onChange={e => setCity(e.target.value)} /></label>}
      {kind === "vehicle_expense_types" && <label className="text-xs font-semibold">Expense Scope<select required className="input mt-1 block" value={expenseScope} onChange={e => setExpenseScope(e.target.value)}><option value="">Select scope</option><option value="trip">Trip</option><option value="vehicle">Vehicle</option><option value="both">Both</option></select></label>}
      <button className="btn-primary" disabled={busy}>{editing ? "Save Changes" : "Add"}</button>
      {editing && <button type="button" className="btn-secondary" onClick={reset}>Cancel</button>}
    </form>;
  if(quickCreate)return <Modal englishOnly={Boolean(quickCreate)} open title={kind==="locations"?"Add Location":"Add Truck Type"} onClose={quickCreate.onClose}>{error&&<p role="alert" className="text-red-700">{error}</p>}{allowed?editor:<p role="alert">Master permission required.</p>}</Modal>;
  return <section className="space-y-4 rounded-xl border bg-white p-4">
    <h1 className="text-xl font-bold">{names[kind]}</h1>
    {kind === "vehicle_expense_types" && <p className="text-xs text-slate-600">Trip costs affect Trip profitability. Vehicle costs belong to Vehicle accounts. Both allows either context; record each cost once. Existing unclassified types require review.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {allowed && editor}
    <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr><th className="p-2 text-left">Name</th>{kind === "locations" && <th className="p-2 text-left">City / Area</th>}{kind === "vehicle_expense_types" && <th className="p-2 text-left">Expense Scope</th>}<th className="p-2 text-left">Status</th><th className="p-2 text-left">Actions</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id} className="border-t"><td className="p-2">{row.name}</td>{kind === "locations" && <td className="p-2">{row.city_area || "—"}</td>}{kind === "vehicle_expense_types" && <td className="p-2">{row.expense_scope ? row.expense_scope[0].toUpperCase() + row.expense_scope.slice(1) : "Legacy / not classified"}</td>}<td className="p-2">{row.is_active ? "Active" : "Inactive"}</td><td className="p-2">{allowed && <div className="flex gap-2"><button className="btn-secondary" onClick={() => { setEditing(row.id); setName(row.name); setCity(row.city_area ?? ""); setExpenseScope(row.expense_scope ?? ""); }}>Edit</button><button className="btn-secondary" onClick={() => void toggle(row)}>{row.is_active ? "Deactivate" : "Activate"}</button></div>}</td></tr>)}
    </tbody></table></div>
  </section>;
}
