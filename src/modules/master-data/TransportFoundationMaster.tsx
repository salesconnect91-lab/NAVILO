import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { canTransportAction } from "@/auth/permissions";

type Kind = "truck_types" | "locations" | "vehicle_expense_types";
type Row = { id: string; name: string; city_area?: string | null; is_active: boolean };
const names: Record<Kind, string> = { truck_types: "Truck Types", locations: "Locations", vehicle_expense_types: "Vehicle Expense Types" };

export default function TransportFoundationMaster({ kind }: { kind: Kind }) {
  const { activeCompany, activeBusinessUnit, isPlatformOwner } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const table = `transport_${kind}` as "transport_truck_types" | "transport_locations" | "transport_vehicle_expense_types";
  const role = activeBusinessUnit?.membership_role ?? activeCompany?.membership_role;
  const permissions = activeBusinessUnit?.permissions ?? activeCompany?.permissions;
  const allowed = canTransportAction(role, permissions, "master_manage", isPlatformOwner);

  const load = async () => {
    const result = await supabase.from(table).select("*")
      .order("name");
    if (result.error) setError(result.error.message);
    else setRows((result.data ?? []) as Row[]);
  };
  useEffect(() => { void load(); }, [kind, activeCompany?.company_id, activeBusinessUnit?.business_unit_id]);
  const reset = () => { setEditing(null); setName(""); setCity(""); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!allowed || !activeCompany?.company_id || !activeBusinessUnit?.business_unit_id) return;
    setBusy(true); setError("");
    const fields = { name: name.trim(), ...(kind === "locations" ? { city_area: city.trim() || null } : {}) };
    const result = editing
      ? await supabase.from(table).update(fields).eq("id", editing)
      : await supabase.from(table).insert({ ...fields, company_id: activeCompany.company_id, business_unit_id: activeBusinessUnit.business_unit_id });
    setBusy(false);
    if (result.error) setError(result.error.message);
    else { reset(); await load(); }
  };
  const toggle = async (row: Row) => {
    if (!allowed) return;
    const result = await supabase.from(table).update({ is_active: !row.is_active }).eq("id", row.id);
    if (result.error) setError(result.error.message); else await load();
  };
  return <section className="space-y-4 rounded-xl border bg-white p-4">
    <h1 className="text-xl font-bold">{names[kind]}</h1>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {allowed && <form className="flex flex-wrap items-end gap-2" onSubmit={save}>
      <label className="text-xs font-semibold">Name<input className="input mt-1 block" required value={name} onChange={e => setName(e.target.value)} /></label>
      {kind === "locations" && <label className="text-xs font-semibold">City / Area<input className="input mt-1 block" value={city} onChange={e => setCity(e.target.value)} /></label>}
      <button className="btn-primary" disabled={busy}>{editing ? "Save Changes" : "Add"}</button>
      {editing && <button type="button" className="btn-secondary" onClick={reset}>Cancel</button>}
    </form>}
    <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr><th className="p-2 text-left">Name</th>{kind === "locations" && <th className="p-2 text-left">City / Area</th>}<th className="p-2 text-left">Status</th><th className="p-2 text-left">Actions</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id} className="border-t"><td className="p-2">{row.name}</td>{kind === "locations" && <td className="p-2">{row.city_area || "—"}</td>}<td className="p-2">{row.is_active ? "Active" : "Inactive"}</td><td className="p-2">{allowed && <div className="flex gap-2"><button className="btn-secondary" onClick={() => { setEditing(row.id); setName(row.name); setCity(row.city_area ?? ""); }}>Edit</button><button className="btn-secondary" onClick={() => void toggle(row)}>{row.is_active ? "Disable" : "Enable"}</button></div>}</td></tr>)}
    </tbody></table></div>
  </section>;
}
