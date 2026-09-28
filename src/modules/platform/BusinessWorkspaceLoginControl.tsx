import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";

const roles = ["company_owner", "admin", "accounts", "sales", "purchase", "store", "production", "viewer"];
type Unit = { id: string; name: string; code: string; is_active: boolean };
type Location = { id: string; business_unit_id: string | null; name: string; code: string; location_type: string };
type Profile = { id: string; full_name: string | null; email: string | null; locked_business_unit_id: string | null; locked_operating_location_id: string | null };
type Membership = { id: string; user_id: string; role: string; is_active: boolean };

export default function BusinessWorkspaceLoginControl({ companyId }: { companyId: string }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
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
    const [unitResult, locationResult, membershipResult] = await Promise.all([
      supabase.from("business_units").select("id,name,code,is_active").eq("company_id", companyId).order("is_default", { ascending: false }),
      supabase.from("operating_locations").select("id,business_unit_id,name,code,location_type").eq("company_id", companyId).eq("is_active", true).order("name"),
      supabase.from("company_memberships").select("id,user_id,role,is_active").eq("company_id", companyId),
    ]);
    const loadError = unitResult.error || locationResult.error || membershipResult.error;
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    const nextMemberships = (membershipResult.data ?? []) as Membership[];
    const userIds = nextMemberships.map(item => item.user_id);
    const profileResult = userIds.length
      ? await supabase.from("user_profiles").select("id,full_name,email,locked_business_unit_id,locked_operating_location_id").in("id", userIds)
      : { data: [], error: null };
    setError(profileResult.error?.message || "");
    const nextUnits = (unitResult.data ?? []) as Unit[];
    setUnits(nextUnits);
    setLocations((locationResult.data ?? []) as Location[]);
    setMemberships(nextMemberships);
    setProfiles((profileResult.data ?? []) as Profile[]);
    const activeUnits = nextUnits.filter(unit => unit.is_active);
    setUnitId(current => activeUnits.some(unit => unit.id === current) ? current : (activeUnits[0]?.id ?? ""));
    setLoading(false);
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (locationId && !locations.some(location => location.id === locationId && location.business_unit_id === unitId)) setLocationId("");
  }, [unitId, locationId, locations]);

  const branchOptions = locations.filter(location => location.business_unit_id === unitId);
  const profileMap = useMemo(() => new Map(profiles.map(profile => [profile.id, profile])), [profiles]);
  const companyUnitIds = useMemo(() => new Set(units.map(unit => unit.id)), [units]);
  const dedicated = memberships.filter(item => {
    const profile = profileMap.get(item.user_id);
    return Boolean(
      profile?.locked_business_unit_id &&
      companyUnitIds.has(profile.locked_business_unit_id)
    );
  });

  const create = async () => {
    if (!unitId || !email.trim() || password.length < 8) {
      setError("Business workspace, email and minimum 8 character password are required.");
      return;
    }
    setSaving(true); setError(""); setMessage("");
    try {
      await invokeEdgeFunction("platform-admin", {
        action: "create_user", company_id: companyId, business_unit_id: unitId,
        operating_location_id: locationId || null, full_name: fullName.trim(),
        email: email.trim(), password, role,
      });
      const unit = units.find(item => item.id === unitId);
      const branch = locations.find(item => item.id === locationId);
      setMessage(`${unit?.name ?? "Business"}${branch ? ` / ${branch.name}` : ""} dedicated login created and locked.`);
      setFullName(""); setEmail(""); setPassword(""); setRole("viewer");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create workspace login."); }
    finally { setSaving(false); }
  };

  const toggle = async (membership: Membership) => {
    setSaving(true); setError(""); setMessage("");
    try {
      await invokeEdgeFunction("platform-admin", { action: "update_membership", membership_id: membership.id, is_active: !membership.is_active });
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update workspace login."); }
    finally { setSaving(false); }
  };

  const remove = async (membership: Membership) => {
    const profile = profileMap.get(membership.user_id);
    if (!confirm(`Remove dedicated access for ${profile?.full_name || profile?.email || membership.user_id}? The global NAVILO login/profile will be preserved.`)) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await invokeEdgeFunction("platform-admin", { action: "remove_dedicated_workspace_login", company_id: companyId, user_id: membership.user_id });
      setMessage("Dedicated company access removed. Global NAVILO login/profile preserved.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not remove workspace login."); }
    finally { setSaving(false); }
  };

  return <section className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
    <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-blue-700"/><div><h2 className="font-semibold text-slate-900">Dedicated Business / Branch Login IDs</h2><p className="text-xs text-slate-500">Create and manage logins locked to a whole business or a single branch.</p></div></div>
    {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    {message && <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}
    {loading ? <div className="mt-4 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin"/>Loading...</div> : <>
      {dedicated.length > 0 && <div className="mt-4 space-y-2">
        {dedicated.map(item => {
          const profile = profileMap.get(item.user_id)!;
          const unit = units.find(value => value.id === profile.locked_business_unit_id);
          const branch = locations.find(value => value.id === profile.locked_operating_location_id);
          return <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2">
            <div><div className="text-sm font-medium">{profile.full_name || profile.email || item.user_id}</div><div className="text-xs text-slate-500">{profile.email || "No email"} Â· {unit?.name || "Locked business"}{branch ? ` / ${branch.name}` : " / Whole business"} Â· {item.role} Â· {item.is_active ? "Active" : "Disabled"}</div></div>
            <div className="flex gap-2"><button className="btn-secondary h-8" disabled={saving} onClick={() => void toggle(item)}>{item.is_active ? "Disable" : "Enable"}</button><button className="btn-secondary h-8" disabled={saving} onClick={() => void remove(item)}>Remove</button></div>
          </div>;
        })}
      </div>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <SearchableSelect className="input" value={unitId} onChange={event => setUnitId(event.target.value)}>{units.filter(unit => unit.is_active).map(unit => <option key={unit.id} value={unit.id} data-search={unit.code}>{unit.name}</option>)}</SearchableSelect>
        <SearchableSelect className="input" value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">Whole business</option>{branchOptions.map(location => <option key={location.id} value={location.id} data-search={location.code}>{location.name}</option>)}</SearchableSelect>
        <input className="input" placeholder="Full name" value={fullName} onChange={event => setFullName(event.target.value)}/>
        <input className="input" type="email" autoComplete="off" placeholder="Login email" value={email} onChange={event => setEmail(event.target.value)}/>
        <input className="input" type="password" autoComplete="new-password" placeholder="Temporary password" value={password} onChange={event => setPassword(event.target.value)}/>
        <SearchableSelect className="input" value={role} onChange={event => setRole(event.target.value)}>{roles.map(item => <option key={item} value={item}>{item}</option>)}</SearchableSelect>
      </div>
      <button className="btn-primary mt-3" disabled={saving || !unitId} onClick={() => void create()}>{saving ? <Loader2 className="h-4 w-4 animate-spin"/> : <KeyRound className="h-4 w-4"/>}Create Dedicated Login</button>
      <div className="mt-2 text-xs text-slate-500">Remove clears only this companyâ€™s dedicated access and lock scope; the global NAVILO login/profile is preserved.</div>
    </>}
  </section>;
}


