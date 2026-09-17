import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";

const roles = ["company_owner", "admin", "accounts", "sales", "purchase", "store", "production", "viewer"];
type Unit = { id: string; name: string; code: string };
type Location = { id: string; business_unit_id: string | null; name: string; code: string; location_type: string };

export default function BusinessWorkspaceLoginControl({ companyId }: { companyId: string }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [unitId, setUnitId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("viewer");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [unitResult, locationResult] = await Promise.all([
      supabase.from("business_units").select("id,name,code").eq("company_id", companyId).eq("is_active", true).order("is_default", { ascending: false }),
      supabase.from("operating_locations").select("id,business_unit_id,name,code,location_type").eq("company_id", companyId).eq("is_active", true).order("name"),
    ]);
    setError(unitResult.error?.message || locationResult.error?.message || "");
    const nextUnits = (unitResult.data ?? []) as Unit[];
    setUnits(nextUnits);
    setLocations((locationResult.data ?? []) as Location[]);
    setUnitId(current => nextUnits.some(unit => unit.id === current) ? current : (nextUnits[0]?.id ?? ""));
    setLoading(false);
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (locationId && !locations.some(location => location.id === locationId && location.business_unit_id === unitId)) setLocationId("");
  }, [unitId, locationId, locations]);

  const branchOptions = locations.filter(location => location.business_unit_id === unitId);

  const create = async () => {
    if (!unitId || !email.trim() || password.length < 8) {
      setError("Business workspace, email and minimum 8 character password are required.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      await invokeEdgeFunction("platform-admin", {
        action: "create_user",
        company_id: companyId,
        business_unit_id: unitId,
        operating_location_id: locationId || null,
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        role,
      });

      const unit = units.find(item => item.id === unitId);
      const branch = locations.find(item => item.id === locationId);
      setMessage(`${unit?.name ?? "Business"}${branch ? ` / ${branch.name}` : ""} dedicated login created and locked.`);
      setFullName("");
      setEmail("");
      setPassword("");
      setRole("viewer");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create workspace login.");
    } finally {
      setSaving(false);
    }
  };

  return <section className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
    <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-blue-700"/><div><h2 className="font-semibold text-slate-900">Dedicated Business / Branch Login IDs</h2><p className="text-xs text-slate-500">Create a login locked to a whole business, or select a branch to lock it further to that branch.</p></div></div>
    {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    {message && <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}
    {loading ? <div className="mt-4 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin"/>Loading...</div> : <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <SearchableSelect className="input" value={unitId} onChange={event => setUnitId(event.target.value)}>{units.map(unit => <option key={unit.id} value={unit.id} data-search={unit.code}>{unit.name}</option>)}</SearchableSelect>
        <SearchableSelect className="input" value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">Whole business</option>{branchOptions.map(location => <option key={location.id} value={location.id} data-search={location.code}>{location.name}</option>)}</SearchableSelect>
        <input className="input" placeholder="Full name" value={fullName} onChange={event => setFullName(event.target.value)}/>
        <input className="input" type="email" placeholder="Login email" value={email} onChange={event => setEmail(event.target.value)}/>
        <input className="input" type="password" placeholder="Temporary password" value={password} onChange={event => setPassword(event.target.value)}/>
        <SearchableSelect className="input" value={role} onChange={event => setRole(event.target.value)}>{roles.map(item => <option key={item} value={item}>{item}</option>)}</SearchableSelect>
      </div>
      <button className="btn-primary mt-3" disabled={saving || !unitId} onClick={() => void create()}>{saving ? <Loader2 className="h-4 w-4 animate-spin"/> : <KeyRound className="h-4 w-4"/>}Create Dedicated Login</button>
      <div className="mt-2 text-xs text-slate-500">Branch list comes from Operating Locations. Create each branch under its Business first.</div>
    </>}
  </section>;
}
