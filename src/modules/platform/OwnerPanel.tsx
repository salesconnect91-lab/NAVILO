import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { AlertTriangle, Building2, CalendarDays, FileSpreadsheet, Loader2, Plus, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { PageHeader, ErrorBanner } from "@/components/ui";
import PlatformBrandingControl from "./PlatformBrandingControl";
import SubscriptionControl from "./SubscriptionControl";
import TransactionResetControl from "./TransactionResetControl";
import BusinessUnitControl from "./BusinessUnitControl";
import BusinessWorkspaceLoginControl from "./BusinessWorkspaceLoginControl";
import CompanyDeleteControl from "./CompanyDeleteControl";
import CoreAccountingControl from "./CoreAccountingControl";
import OwnerOrderBookMigration from "./OwnerOrderBookMigration";
import OwnerLanguageControl from "./OwnerLanguageControl";
import CustomerOnboardingWizard from "./CustomerOnboardingWizard";
import BillingLedgerControl from "./BillingLedgerControl";

type Company = {
  id: string; name: string; code: string; status: string; subscription_expires_at: string | null; max_users: number;
  contact_email: string | null; contact_phone: string | null; address: string | null; notes: string | null;
};
type Membership = { id: string; company_id: string; user_id: string; role: string; is_active: boolean };
type Profile = { id: string; email: string | null; full_name: string | null };
type BusinessUnit = { id: string; company_id: string; is_active: boolean };
type CompanyModule = { company_id: string; module_key: string; enabled: boolean };
type Subscription = { company_id: string; status: string; expires_at: string | null };
const roles = ["company_owner", "admin", "accounts", "sales", "purchase", "store", "production", "viewer"];
const roleLabel=(role:string)=>({company_owner:"Company Owner",admin:"Administrator",accounts:"Accounts",sales:"Sales",purchase:"Purchase",store:"Store / Inventory",production:"Production",viewer:"Viewer"}[role]||role.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()));
const statusLabel=(status:string)=>status.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
const formatDate=(value:string|null)=>value?new Date(value).toLocaleDateString():"No expiry";

export default function OwnerPanel() {
  const { isPlatformOwner, refreshAccess } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [companyModules, setCompanyModules] = useState<CompanyModule[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [company, setCompany] = useState({ name: "", code: "", contact_email: "", contact_phone: "", address: "", notes: "", subscription_expires_at: "", max_users: "10" });
  const [user, setUser] = useState({ full_name: "", email: "", password: "", role: "viewer" });

  const load = useCallback(async () => {
    if (!isPlatformOwner) { setLoading(false); return; }
    setLoading(true);
    const [companyResult, membershipResult, profileResult, unitResult, moduleResult, subscriptionResult] = await Promise.all([
      supabase.from("companies").select("*").order("created_at", { ascending: false }),
      supabase.from("company_memberships").select("*").order("created_at", { ascending: false }),
      supabase.from("user_profiles").select("id,email,full_name").order("email"),
      supabase.from("business_units").select("id,company_id,is_active"),
      supabase.from("company_modules").select("company_id,module_key,enabled"),
      supabase.from("company_subscriptions").select("company_id,status,expires_at").in("status",["trial","active","past_due","suspended"]).order("created_at",{ascending:false}),
    ]);
    const firstError = companyResult.error || membershipResult.error || profileResult.error || unitResult.error || moduleResult.error || subscriptionResult.error;
    setError(firstError?.message || "");
    const nextCompanies = (companyResult.data ?? []) as Company[];
    setCompanies(nextCompanies);
    setMemberships((membershipResult.data ?? []) as Membership[]);
    setProfiles((profileResult.data ?? []) as Profile[]);
    setBusinessUnits((unitResult.data ?? []) as BusinessUnit[]);
    setCompanyModules((moduleResult.data ?? []) as CompanyModule[]);
    setSubscriptions((subscriptionResult.data ?? []) as Subscription[]);
    setSelectedCompanyId(current => nextCompanies.some(item => item.id === current) ? current : (nextCompanies[0]?.id || ""));
    setLoading(false);
  }, [isPlatformOwner]);

  useEffect(() => { void load(); }, [load]);
  const selected = companies.find(item => item.id === selectedCompanyId);
  const profileMap = useMemo(() => new Map(profiles.map(profile => [profile.id, profile])), [profiles]);
  const selectedUsers = memberships.filter(m=>m.company_id===selectedCompanyId && m.is_active).length;
  const selectedUnits = businessUnits.filter(u=>u.company_id===selectedCompanyId && u.is_active).length;
  const selectedModules = companyModules.filter(m=>m.company_id===selectedCompanyId && m.enabled).length;
  const selectedSubscription = subscriptions.find(s=>s.company_id===selectedCompanyId) ?? null;
  const activeCompanies = companies.filter(c=>c.status==="active").length;
  const activeUsers = memberships.filter(m=>m.is_active).length;
  if (!isPlatformOwner) return <Navigate to="/" replace />;

  const createCompany = async () => {
    if (!company.name.trim() || !company.code.trim()) { setError("Company name and code are required."); return; }
    setSaving(true); setError("");
    try {
      await invokeEdgeFunction("platform-admin", { action: "create_company", ...company, name: company.name.trim(), code: company.code.trim().toUpperCase(), max_users: Math.max(1, Number(company.max_users) || 10), subscription_expires_at: company.subscription_expires_at ? new Date(company.subscription_expires_at).toISOString() : null });
      setCompany({ name: "", code: "", contact_email: "", contact_phone: "", address: "", notes: "", subscription_expires_at: "", max_users: "10" });
      await load(); await refreshAccess();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create company."); } finally { setSaving(false); }
  };

  const patchCompanyStatus = async (target: Company, status: string) => {
    setSaving(true); setError("");
    try { await invokeEdgeFunction("platform-admin", { action: "set_company_status", company_id: target.id, status }); await load(); await refreshAccess(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Update failed."); } finally { setSaving(false); }
  };

  const createUser = async () => {
    if (!selectedCompanyId || !user.email.trim() || user.password.length < 8) { setError("Select company, enter email and minimum 8 character temporary password."); return; }
    setSaving(true); setError("");
    try { await invokeEdgeFunction("platform-admin", { action: "create_user", company_id: selectedCompanyId, ...user }); setUser({ full_name: "", email: "", password: "", role: "viewer" }); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create user."); } finally { setSaving(false); }
  };

  const updateMember = async (membership: Membership, patch: Record<string, unknown>) => {
    setSaving(true); setError("");
    try { await invokeEdgeFunction("platform-admin", { action: "update_membership", membership_id: membership.id, ...patch }); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Access update failed."); } finally { setSaving(false); }
  };

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="mr-2 h-5 w-5 animate-spin"/>Loading owner controls...</div>;

  return <div className="space-y-6">
    <PageHeader title="Owner Control" subtitle="NAVILO identity, companies, subscriptions, users, business units, accounting governance and lifecycle controls"/>
    {error && <ErrorBanner message={error}/>}

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Companies</div><div className="mt-1 text-2xl font-bold text-slate-900">{companies.length}</div><div className="text-xs text-slate-500">{activeCompanies} active</div></div>
      <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active Users</div><div className="mt-1 text-2xl font-bold text-slate-900">{activeUsers}</div><div className="text-xs text-slate-500">Across all companies</div></div>
      <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Business Units</div><div className="mt-1 text-2xl font-bold text-slate-900">{businessUnits.filter(u=>u.is_active).length}</div><div className="text-xs text-slate-500">Active workspaces</div></div>
      <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Owner Scope</div><div className="mt-1 text-lg font-bold text-slate-900">Platform</div><div className="text-xs text-slate-500">Owner-only controls</div></div>
    </section>

    <PlatformBrandingControl />

    <CustomerOnboardingWizard onComplete={async()=>{await load();await refreshAccess();}} />

    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2"><Building2 className="h-5 w-5"/><div><h2 className="font-semibold">Company Management</h2><p className="text-xs text-slate-500">Create a tenant company and define its initial contact, expiry and user allowance.</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-semibold text-slate-700">Company Name<input className="input mt-1 w-full" placeholder="e.g. AMK Steels Private Limited" value={company.name} onChange={event => setCompany({ ...company, name: event.target.value })}/></label>
        <label className="text-xs font-semibold text-slate-700">Company Code<input className="input mt-1 w-full" placeholder="e.g. AMK" value={company.code} onChange={event => setCompany({ ...company, code: event.target.value })}/></label>
        <label className="text-xs font-semibold text-slate-700">Subscription Expiry<input className="input mt-1 w-full" type="date" value={company.subscription_expires_at} onChange={event => setCompany({ ...company, subscription_expires_at: event.target.value })}/></label>
        <label className="text-xs font-semibold text-slate-700">Max Users<input className="input mt-1 w-full" type="number" min="1" value={company.max_users} onChange={event => setCompany({ ...company, max_users: event.target.value })}/></label>
        <label className="text-xs font-semibold text-slate-700">Contact Email<input className="input mt-1 w-full" type="email" placeholder="accounts@company.com" value={company.contact_email} onChange={event => setCompany({ ...company, contact_email: event.target.value })}/></label>
        <label className="text-xs font-semibold text-slate-700">Contact Phone<input className="input mt-1 w-full" placeholder="Phone" value={company.contact_phone} onChange={event => setCompany({ ...company, contact_phone: event.target.value })}/></label>
        <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Address<input className="input mt-1 w-full" placeholder="Company address" value={company.address} onChange={event => setCompany({ ...company, address: event.target.value })}/></label>
      </div>
      <label className="mt-3 block text-xs font-semibold text-slate-700">Internal Notes<textarea className="input mt-1 min-h-20 w-full" placeholder="Owner-only notes about onboarding, contract or support" value={company.notes} onChange={event => setCompany({ ...company, notes: event.target.value })}/></label>
      <button className="btn-primary mt-3" disabled={saving} onClick={() => void createCompany()}><Plus className="h-4 w-4"/>Create Company</button>
    </section>

    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2"><Users className="h-5 w-5"/><div><h2 className="font-semibold">Companies & User Access</h2><p className="text-xs text-slate-500">Review company status, seat usage and company-level users. Suspend instead of deleting for normal lifecycle management.</p></div></div>
      <div className="grid gap-4 lg:grid-cols-2">
        {companies.map(target => {
          const targetMemberships = memberships.filter(membership => membership.company_id === target.id);
          const usedSeats=targetMemberships.filter(m=>m.is_active).length;
          return <div key={target.id} className={`rounded-xl border p-4 ${selectedCompanyId===target.id?"border-blue-300 ring-1 ring-blue-100":"border-slate-200"}`}>
            <div className="flex flex-wrap justify-between gap-3"><button type="button" className="text-left" onClick={()=>setSelectedCompanyId(target.id)}><div className="font-semibold text-slate-900">{target.name}</div><div className="text-xs text-slate-500">{statusLabel(target.status)} · {usedSeats}/{target.max_users} users · Expires {formatDate(target.subscription_expires_at)}</div></button><div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={saving} onClick={() => void patchCompanyStatus(target, target.status === "suspended" ? "active" : "suspended")}>{target.status === "suspended" ? "Activate" : "Suspend"}</button></div></div>
            <div className="mt-4 space-y-2">{targetMemberships.map(membership => { const profile = profileMap.get(membership.user_id); return <div key={membership.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2"><div className="min-w-0"><div className="truncate text-sm font-medium">{profile?.full_name || profile?.email || membership.user_id}</div>{profile?.email&&profile.full_name&&<div className="truncate text-xs text-slate-500">{profile.email}</div>}</div><div className="flex gap-2"><SearchableSelect className="input h-8 py-1 text-xs" value={membership.role} onChange={event => void updateMember(membership, { role: event.target.value })}>{roles.map(role => <option key={role} value={role}>{roleLabel(role)}</option>)}</SearchableSelect><button className="btn-secondary h-8" onClick={() => void updateMember(membership, { is_active: !membership.is_active })}>{membership.is_active ? "Disable" : "Enable"}</button></div></div>; })}{targetMemberships.length === 0 && <div className="text-xs text-slate-400">No company users assigned yet.</div>}</div>
          </div>;
        })}
      </div>
    </section>

    <section className="rounded-xl border border-blue-200 bg-blue-50/30 p-4 shadow-sm"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="font-semibold text-slate-900">Selected Company Workspace</h2><p className="mt-1 text-xs text-slate-500">All controls below apply only to the selected company.</p><SearchableSelect className="input mt-3 w-full sm:w-96" value={selectedCompanyId} onChange={event => setSelectedCompanyId(event.target.value)}>{companies.map(target => <option key={target.id} value={target.id} data-search={target.code}>{target.name}</option>)}</SearchableSelect></div>{selected&&<div className="grid min-w-[320px] grid-cols-2 gap-2 text-xs sm:grid-cols-4"><div className="rounded-lg border bg-white p-2"><div className="text-slate-500">Status</div><div className="font-semibold">{statusLabel(selectedSubscription?.status||selected.status)}</div></div><div className="rounded-lg border bg-white p-2"><div className="text-slate-500">Users</div><div className="font-semibold">{selectedUsers}/{selected.max_users}</div></div><div className="rounded-lg border bg-white p-2"><div className="text-slate-500">Business Units</div><div className="font-semibold">{selectedUnits}</div></div><div className="rounded-lg border bg-white p-2"><div className="text-slate-500">Modules</div><div className="font-semibold">{selectedModules}</div></div></div>}</div></section>

    {selectedCompanyId && <BusinessUnitControl companyId={selectedCompanyId} onSaved={refreshAccess}/>}
    {selectedCompanyId && <BusinessWorkspaceLoginControl companyId={selectedCompanyId}/>}
    {selectedCompanyId && <SubscriptionControl companyId={selectedCompanyId} onSaved={async () => { await load(); await refreshAccess(); }}/>}
    {selectedCompanyId && <BillingLedgerControl companyId={selectedCompanyId}/>}
    {selectedCompanyId && <OwnerLanguageControl companyId={selectedCompanyId}/>}
    {selectedCompanyId && <CoreAccountingControl companyId={selectedCompanyId}/>}

    <section className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5"/><div><h2 className="font-semibold">Create Company / Group User</h2><p className="text-xs text-slate-500">Use for users who may access more than one assigned business unit. Dedicated single-business logins are managed above.</p></div></div><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-semibold text-slate-700">Full Name<input className="input mt-1 w-full" value={user.full_name} onChange={event => setUser({ ...user, full_name: event.target.value })}/></label><label className="text-xs font-semibold text-slate-700">Email / Login ID<input className="input mt-1 w-full" type="email" value={user.email} onChange={event => setUser({ ...user, email: event.target.value })}/></label><label className="text-xs font-semibold text-slate-700">Temporary Password<input className="input mt-1 w-full" type="password" value={user.password} onChange={event => setUser({ ...user, password: event.target.value })}/></label><label className="text-xs font-semibold text-slate-700">Company Role<SearchableSelect className="input mt-1 w-full" value={user.role} onChange={event => setUser({ ...user, role: event.target.value })}>{roles.map(role => <option key={role} value={role}>{roleLabel(role)}</option>)}</SearchableSelect></label></div><p className="mt-2 text-xs text-slate-500">Use a temporary password only for onboarding; the user should change it through the account password flow after first access.</p><button className="btn-primary mt-3" disabled={saving || !selectedCompanyId} onClick={() => void createUser()}>Create Group User</button></section>

    <section className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Migration & Onboarding</h2><p className="mt-1 text-xs text-slate-500">Controlled tools for bringing opening balances and legacy operational data into NAVILO.</p></div><Link className="btn-secondary" to="/owner/opening-balances"><FileSpreadsheet className="h-4 w-4"/>Opening Balance Migration</Link></div></section>
    {selected && <OwnerOrderBookMigration companyId={selected.id} companyName={selected.name}/>}

    <section className="rounded-xl border border-red-200 bg-red-50/40 p-4"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-5 w-5 text-red-700"/><div><h2 className="font-semibold text-red-900">Danger Zone</h2><p className="text-xs text-red-700">Destructive lifecycle actions belong here. Use Suspend for normal company access control. Permanent deletion and transaction reset require deliberate confirmation.</p></div></div>{selected&&<div className="mt-4"><CompanyDeleteControl companyId={selected.id} companyName={selected.name} companyCode={selected.code} onDeleted={async () => { await load(); await refreshAccess(); }}/></div>}</section>
    {selected && <TransactionResetControl companyId={selected.id} companyName={selected.name} companyCode={selected.code}/>}
  </div>;
}
