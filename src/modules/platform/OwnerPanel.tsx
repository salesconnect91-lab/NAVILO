import {formatNaviloDate} from '@/lib/naviloDate';
import NaviloDateInput from '@/components/NaviloDateInput';
import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { AlertTriangle, Building2, CreditCard, FileSpreadsheet, LayoutDashboard, Loader2, Plus, Settings2, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { PageHeader, ErrorBanner } from "@/components/ui";
import PlatformBrandingControl from "./PlatformBrandingControl";
import SubscriptionControl from "./SubscriptionControl";
import PlanManagementControl from "./PlanManagementControl";
import TransactionResetControl from "./TransactionResetControl";
import BusinessUnitControl from "./BusinessUnitControl";
import BusinessWorkspaceLoginControl from "./BusinessWorkspaceLoginControl";
import CompanyDeleteControl from "./CompanyDeleteControl";
import CoreAccountingControl from "./CoreAccountingControl";
import OwnerOrderBookMigration from "./OwnerOrderBookMigration";
import OwnerLanguageControl from "./OwnerLanguageControl";
import OwnerFeatureControl from "./OwnerFeatureControl";
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
const formatDate=(value:string|null)=>value?formatNaviloDate(value):"No expiry";

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
  const [ownerView, setOwnerView] = useState<"overview"|"customers"|"access"|"commercial"|"advanced">("overview");
  const [company, setCompany] = useState({ name: "", code: "", contact_email: "", contact_phone: "", address: "", notes: "", subscription_expires_at: "", max_users: "10" });
  const [user, setUser] = useState({ full_name: "", email: "", password: "", role: "viewer" });
  const [showNewCompanyUser, setShowNewCompanyUser] = useState(false);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userEdit, setUserEdit] = useState({ full_name: "", email: "" });
  const [companyEdit, setCompanyEdit] = useState({ name: "", code: "", contact_email: "", contact_phone: "", address: "", notes: "" });

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
  const selectedActiveOwnerCount = memberships.filter(m=>m.company_id===selectedCompanyId && m.is_active && m.role==="company_owner").length;
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

  const beginCompanyEdit = (target: Company) => {
    setSelectedCompanyId(target.id);
    setEditingCompanyId(target.id);
    setCompanyEdit({
      name: target.name,
      code: target.code,
      contact_email: target.contact_email || "",
      contact_phone: target.contact_phone || "",
      address: target.address || "",
      notes: target.notes || "",
    });
    setError("");
  };

  const saveCompanyEdit = async (target: Company) => {
    if (!companyEdit.name.trim() || !companyEdit.code.trim()) { setError("Company name and code are required."); return; }
    setSaving(true); setError("");
    try {
      await invokeEdgeFunction("platform-admin", {
        action: "update_company_details",
        company_id: target.id,
        ...companyEdit,
        name: companyEdit.name.trim(),
        code: companyEdit.code.trim().toUpperCase(),
      });
      setEditingCompanyId(null);
      await load();
      await refreshAccess();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update company details."); }
    finally { setSaving(false); }
  };

  const createUser = async () => {
    if (!selectedCompanyId || !user.email.trim() || user.password.length < 8) { setError("Select company, enter email and minimum 8 character temporary password."); return; }
    setSaving(true); setError("");
    try { await invokeEdgeFunction("platform-admin", { action: "create_user", company_id: selectedCompanyId, ...user }); setUser({ full_name: "", email: "", password: "", role: "viewer" }); setShowNewCompanyUser(false); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create user."); } finally { setSaving(false); }
  };

  const beginUserEdit = (membership: Membership) => {
    const profile = profileMap.get(membership.user_id);
    setEditingUserId(membership.user_id);
    setUserEdit({ full_name: profile?.full_name || "", email: profile?.email || "" });
    setError("");
  };

  const saveUserEdit = async (membership: Membership) => {
    if (!userEdit.full_name.trim() || !userEdit.email.trim()) { setError("Full name and login email are required."); return; }
    setSaving(true); setError("");
    try {
      await invokeEdgeFunction("platform-admin", {
        action: "update_user_identity",
        company_id: membership.company_id,
        user_id: membership.user_id,
        full_name: userEdit.full_name.trim(),
        email: userEdit.email.trim().toLowerCase(),
      });
      setEditingUserId(null);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update user details."); }
    finally { setSaving(false); }
  };

  const removeCompanyUser = async (membership: Membership) => {
    const profile = profileMap.get(membership.user_id);
    const label = profile?.full_name || profile?.email || membership.user_id;
    if (!window.confirm(`Remove ${label} from this company? Their global NAVILO login will be preserved.`)) return;
    setSaving(true); setError("");
    try {
      await invokeEdgeFunction("platform-admin", {
        action: "remove_company_user",
        company_id: membership.company_id,
        membership_id: membership.id,
      });
      if (editingUserId === membership.user_id) setEditingUserId(null);
      await load();
      await refreshAccess();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove company user.");
    } finally { setSaving(false); }
  };

  const updateMember = async (membership: Membership, patch: Record<string, unknown>) => {
    setSaving(true); setError("");
    try { await invokeEdgeFunction("platform-admin", { action: "update_membership", membership_id: membership.id, ...patch }); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Access update failed."); } finally { setSaving(false); }
  };

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="mr-2 h-5 w-5 animate-spin"/>Loading owner controls...</div>;

  return <div className="space-y-6">
    <PageHeader title="Owner Control" subtitle="NAVILO platform customers, access, subscriptions, governance and lifecycle controls"/>
    {error && <ErrorBanner message={error}/>}

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customers</div><div className="mt-1 text-2xl font-bold text-slate-900">{companies.length}</div><div className="text-xs text-slate-500">{activeCompanies} active</div></div>
      <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active Users</div><div className="mt-1 text-2xl font-bold text-slate-900">{activeUsers}</div><div className="text-xs text-slate-500">Across all companies</div></div>
      <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Business Units</div><div className="mt-1 text-2xl font-bold text-slate-900">{businessUnits.filter(u=>u.is_active).length}</div><div className="text-xs text-slate-500">Active workspaces</div></div>
      <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Owner Scope</div><div className="mt-1 text-lg font-bold text-slate-900">Platform</div><div className="text-xs text-slate-500">Owner-only controls</div></div>
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {([
          ["overview","Overview",LayoutDashboard,"Platform snapshot and branding"],
          ["customers","Customers",Building2,"Onboard and manage customers"],
          ["access","Users & Access",Users,"Users, businesses and branches"],
          ["commercial","Plans & Billing",CreditCard,"Licence, limits and billing"],
          ["advanced","Advanced",Settings2,"Governance, migration and lifecycle"],
        ] as const).map(([key,label,Icon,help])=><button key={key} type="button" onClick={()=>setOwnerView(key)} className={`rounded-lg border px-3 py-2 text-left transition ${ownerView===key?"border-blue-300 bg-blue-50 text-blue-900":"border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}><div className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4"/>{label}</div><div className="mt-0.5 text-[11px] text-slate-500">{help}</div></button>)}
      </div>
    </section>

    {ownerView==="overview"&&<PlatformBrandingControl />}

    {ownerView==="customers"&&<>
      <CustomerOnboardingWizard onComplete={async()=>{await load();await refreshAccess();}} />
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2"><Users className="h-5 w-5"/><div><h2 className="font-semibold">Customers</h2><p className="text-xs text-slate-500">Select an existing customer to review status, seat usage and company-level users. Use Suspend for normal lifecycle access control.</p></div></div>
        <div className="grid gap-4 lg:grid-cols-2">
          {companies.map(target => {
            const targetMemberships = memberships.filter(membership => membership.company_id === target.id);
            const usedSeats=targetMemberships.filter(m=>m.is_active).length;
            return <div key={target.id} className={`rounded-xl border p-4 ${selectedCompanyId===target.id?"border-blue-300 ring-1 ring-blue-100":"border-slate-200"}`}>
              <div className="flex flex-wrap justify-between gap-3"><button type="button" className="text-left" onClick={()=>setSelectedCompanyId(target.id)}><div className="font-semibold text-slate-900">{target.name}</div><div className="text-xs text-slate-500">{target.code} · {statusLabel(target.status)} · {usedSeats}/{target.max_users} users · Expires {formatDate(target.subscription_expires_at)}</div></button><div className="flex gap-2"><button className="btn-secondary" disabled={saving} onClick={()=>beginCompanyEdit(target)}>Edit</button><button className="btn-secondary" disabled={saving} onClick={() => void patchCompanyStatus(target, target.status === "suspended" ? "active" : "suspended")}>{target.status === "suspended" ? "Activate" : "Suspend"}</button></div></div>
              {editingCompanyId===target.id&&<div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/30 p-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="text-xs font-semibold text-slate-700">Company Name<input className="input mt-1 w-full" value={companyEdit.name} onChange={event=>setCompanyEdit({...companyEdit,name:event.target.value})}/></label><label className="text-xs font-semibold text-slate-700">Company Code<input className="input mt-1 w-full" value={companyEdit.code} onChange={event=>setCompanyEdit({...companyEdit,code:event.target.value.toUpperCase()})}/></label><label className="text-xs font-semibold text-slate-700">Contact Email<input className="input mt-1 w-full" type="email" value={companyEdit.contact_email} onChange={event=>setCompanyEdit({...companyEdit,contact_email:event.target.value})}/></label><label className="text-xs font-semibold text-slate-700">Contact Phone<input className="input mt-1 w-full" value={companyEdit.contact_phone} onChange={event=>setCompanyEdit({...companyEdit,contact_phone:event.target.value})}/></label><label className="text-xs font-semibold text-slate-700 sm:col-span-2">Address<input className="input mt-1 w-full" value={companyEdit.address} onChange={event=>setCompanyEdit({...companyEdit,address:event.target.value})}/></label></div><label className="mt-3 block text-xs font-semibold text-slate-700">Internal Notes<textarea className="input mt-1 min-h-20 w-full" value={companyEdit.notes} onChange={event=>setCompanyEdit({...companyEdit,notes:event.target.value})}/></label><div className="mt-3 flex gap-2"><button className="btn-primary" disabled={saving} onClick={()=>void saveCompanyEdit(target)}>Save Changes</button><button className="btn-secondary" disabled={saving} onClick={()=>setEditingCompanyId(null)}>Cancel</button></div><p className="mt-2 text-[11px] text-slate-500">Internal database ID is not editable. Company code changes are checked for uniqueness.</p></div>}
              <div className="mt-4 space-y-2">{targetMemberships.filter(membership=>membership.role==="company_owner").map(membership => { const profile = profileMap.get(membership.user_id); return <div key={membership.id} className="rounded-lg bg-slate-50 p-2"><div className="truncate text-sm font-medium">{profile?.full_name || profile?.email || membership.user_id}</div>{profile?.email&&profile.full_name&&<div className="truncate text-xs text-slate-500">{profile.email}</div>}<div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Company Owner</div></div>; })}{targetMemberships.filter(membership=>membership.role==="company_owner").length===0&&<div className="text-xs text-slate-400">No company owner assigned.</div>}<div className="text-xs text-slate-500">User roles and enable/disable controls are managed in Users &amp; Access.</div></div>
            </div>;
          })}
        </div>
      </section>
    </>}

    {ownerView!=="overview"&&selected&&<section className="rounded-xl border border-blue-200 bg-blue-50/30 p-4 shadow-sm"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="font-semibold text-slate-900">Selected Customer</h2><p className="mt-1 text-xs text-slate-500">Controls in this section apply only to this customer.</p><SearchableSelect className="input mt-3 w-full sm:w-96" value={selectedCompanyId} onChange={event => setSelectedCompanyId(event.target.value)}>{companies.map(target => <option key={target.id} value={target.id} data-search={target.code}>{target.name}</option>)}</SearchableSelect></div><div className="grid min-w-[320px] grid-cols-2 gap-2 text-xs sm:grid-cols-4"><div className="rounded-lg border bg-white p-2"><div className="text-slate-500">Status</div><div className="font-semibold">{statusLabel(selectedSubscription?.status||selected.status)}</div></div><div className="rounded-lg border bg-white p-2"><div className="text-slate-500">Users</div><div className="font-semibold">{selectedUsers}/{selected.max_users}</div></div><div className="rounded-lg border bg-white p-2"><div className="text-slate-500">Business Units</div><div className="font-semibold">{selectedUnits}</div></div><div className="rounded-lg border bg-white p-2"><div className="text-slate-500">Modules</div><div className="font-semibold">{selectedModules}</div></div></div></div></section>}

    {ownerView==="access"&&<>
      {selectedCompanyId&&<BusinessUnitControl companyId={selectedCompanyId} onSaved={refreshAccess}/>}
      {selectedCompanyId&&<BusinessWorkspaceLoginControl companyId={selectedCompanyId}/>}
      <section className="rounded-xl border bg-white p-4 shadow-sm"><div className="mb-3"><h2 className="font-semibold">Existing Company Users</h2><p className="text-xs text-slate-500">Manage roles and enable or disable users for the selected customer.</p></div><div className="space-y-2">{memberships.filter(membership=>membership.company_id===selectedCompanyId).map(membership=>{const profile=profileMap.get(membership.user_id),isLastActiveOwner=membership.is_active&&membership.role==="company_owner"&&selectedActiveOwnerCount<=1;return <div key={membership.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2"><div className="min-w-0"><div className="truncate text-sm font-medium">{profile?.full_name||profile?.email||membership.user_id}</div>{profile?.email&&profile.full_name&&<div className="truncate text-xs text-slate-500">{profile.email}</div>}{isLastActiveOwner&&<div className="text-[11px] font-medium text-amber-700">Last active Company Owner — assign another owner before changing or disabling.</div>}{editingUserId===membership.user_id&&<div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-[11px] font-semibold text-slate-600">Full Name<input className="input mt-1 w-full" value={userEdit.full_name} onChange={event=>setUserEdit({...userEdit,full_name:event.target.value})}/></label><label className="text-[11px] font-semibold text-slate-600">Login Email<input className="input mt-1 w-full" type="email" value={userEdit.email} onChange={event=>setUserEdit({...userEdit,email:event.target.value})}/></label><div className="flex gap-2 sm:col-span-2"><button className="btn-primary h-8" disabled={saving} onClick={()=>void saveUserEdit(membership)}>Save Changes</button><button className="btn-secondary h-8" disabled={saving} onClick={()=>setEditingUserId(null)}>Cancel</button></div><div className="text-[11px] text-slate-500 sm:col-span-2">Updates the login email and NAVILO user profile together. Internal user ID is not editable.</div></div>}</div><div className="flex gap-2"><button className="btn-secondary h-8" disabled={saving||editingUserId!==null} onClick={()=>beginUserEdit(membership)}>Edit</button><SearchableSelect className="input h-8 py-1 text-xs" value={membership.role} disabled={saving||isLastActiveOwner||editingUserId!==null} title={isLastActiveOwner?"Assign another active Company Owner before changing this role.":undefined} onChange={event=>void updateMember(membership,{role:event.target.value})}>{roles.map(role=><option key={role} value={role}>{roleLabel(role)}</option>)}</SearchableSelect><button className="btn-secondary h-8" disabled={saving||isLastActiveOwner||editingUserId!==null} title={isLastActiveOwner?"Assign another active Company Owner before disabling this user.":undefined} onClick={()=>void updateMember(membership,{is_active:!membership.is_active})}>{membership.is_active?"Disable":"Enable"}</button><button className="btn-secondary h-8" disabled={saving||isLastActiveOwner||editingUserId!==null} title={isLastActiveOwner?"Assign another active Company Owner before removing this user.":"Remove this company assignment while preserving the global NAVILO login."} onClick={()=>void removeCompanyUser(membership)}>Remove</button></div></div>})}{memberships.filter(membership=>membership.company_id===selectedCompanyId).length===0&&<div className="text-xs text-slate-400">No company users assigned yet.</div>}</div></section>
      <section className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5"/><div><h2 className="font-semibold">Company User Access</h2><p className="text-xs text-slate-500">Create a company-level user who may access more than one assigned business unit. Dedicated single-business logins are managed above.</p></div></div>{!showNewCompanyUser&&<button type="button" className="btn-primary" disabled={saving||!selectedCompanyId} onClick={()=>{setUser({full_name:"",email:"",password:"",role:"viewer"});setShowNewCompanyUser(true)}}><Plus className="h-4 w-4"/>Add New Company User</button>}</div>{showNewCompanyUser&&<><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-semibold text-slate-700">Full Name<input className="input mt-1 w-full" name="navilo-new-company-user-full-name" autoComplete="off" value={user.full_name} onChange={event=>setUser({...user,full_name:event.target.value})}/></label><label className="text-xs font-semibold text-slate-700">Email / Login ID<input className="input mt-1 w-full" type="email" name="navilo-new-company-user-email" autoComplete="off" value={user.email} onChange={event=>setUser({...user,email:event.target.value})}/></label><label className="text-xs font-semibold text-slate-700">Temporary Password<input className="input mt-1 w-full" type="password" name="navilo-new-company-user-password" autoComplete="new-password" value={user.password} onChange={event=>setUser({...user,password:event.target.value})}/></label><label className="text-xs font-semibold text-slate-700">Company Role<SearchableSelect className="input mt-1 w-full" value={user.role} onChange={event=>setUser({...user,role:event.target.value})}>{roles.map(role=><option key={role} value={role}>{roleLabel(role)}</option>)}</SearchableSelect></label></div><p className="mt-2 text-xs text-slate-500">Use a temporary password only for onboarding; the user should change it through the account password flow after first access.</p><div className="mt-3 flex gap-2"><button className="btn-primary" disabled={saving||!selectedCompanyId} onClick={()=>void createUser()}>Create Company User</button><button type="button" className="btn-secondary" disabled={saving} onClick={()=>{setShowNewCompanyUser(false);setUser({full_name:"",email:"",password:"",role:"viewer"})}}>Cancel</button></div></>}</section>
    </>}

    {ownerView==="commercial"&&selectedCompanyId&&<>
      <PlanManagementControl/>
      <SubscriptionControl companyId={selectedCompanyId} onSaved={async () => { await load(); await refreshAccess(); }}/>
      <BillingLedgerControl companyId={selectedCompanyId}/>
    </>}

    {ownerView==="advanced"&&<>
      {selectedCompanyId&&<OwnerLanguageControl companyId={selectedCompanyId}/>}
      {selectedCompanyId&&<OwnerFeatureControl companyId={selectedCompanyId}/>}
      {selectedCompanyId&&<CoreAccountingControl companyId={selectedCompanyId}/>}
      <section className="rounded-xl border border-amber-200 bg-amber-50/30 p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2"><Building2 className="h-5 w-5"/><div><h2 className="font-semibold">Legacy / Manual Company Creation</h2><p className="text-xs text-slate-500">Advanced fallback that creates only a tenant company record. For normal new customers use New Customer Onboarding so owner login, licence, workspace, branch and modules are provisioned together.</p></div></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-semibold text-slate-700">Company Name<input className="input mt-1 w-full" value={company.name} onChange={event => setCompany({ ...company, name: event.target.value })}/></label>
          <label className="text-xs font-semibold text-slate-700">Company Code<input className="input mt-1 w-full" value={company.code} onChange={event => setCompany({ ...company, code: event.target.value })}/></label>
          <label className="text-xs font-semibold text-slate-700">Subscription Expiry<NaviloDateInput className="input mt-1 w-full" type="date" value={company.subscription_expires_at} onChange={event => setCompany({ ...company, subscription_expires_at: event.target.value })}/></label>
          <label className="text-xs font-semibold text-slate-700">Max Users<input className="input mt-1 w-full" type="number" min="1" value={company.max_users} onChange={event => setCompany({ ...company, max_users: event.target.value })}/></label>
          <label className="text-xs font-semibold text-slate-700">Contact Email<input className="input mt-1 w-full" type="email" value={company.contact_email} onChange={event => setCompany({ ...company, contact_email: event.target.value })}/></label>
          <label className="text-xs font-semibold text-slate-700">Contact Phone<input className="input mt-1 w-full" value={company.contact_phone} onChange={event => setCompany({ ...company, contact_phone: event.target.value })}/></label>
          <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Address<input className="input mt-1 w-full" value={company.address} onChange={event => setCompany({ ...company, address: event.target.value })}/></label>
        </div>
        <label className="mt-3 block text-xs font-semibold text-slate-700">Internal Notes<textarea className="input mt-1 min-h-20 w-full" value={company.notes} onChange={event => setCompany({ ...company, notes: event.target.value })}/></label>
        <button className="btn-primary mt-3" disabled={saving} onClick={() => void createCompany()}><Plus className="h-4 w-4"/>Create Company Record</button>
      </section>
      <section className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Migration & Onboarding</h2><p className="mt-1 text-xs text-slate-500">Controlled tools for bringing opening balances and legacy operational data into NAVILO.</p></div><Link className="btn-secondary" to="/owner/opening-balances"><FileSpreadsheet className="h-4 w-4"/>Opening Balance Migration</Link></div></section>
      {selected&&<OwnerOrderBookMigration companyId={selected.id} companyName={selected.name}/>}
      <section className="rounded-xl border border-red-200 bg-red-50/40 p-4"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-5 w-5 text-red-700"/><div><h2 className="font-semibold text-red-900">Danger Zone</h2><p className="text-xs text-red-700">Destructive lifecycle actions belong here. Use Suspend for normal company access control. Permanent deletion and transaction reset require deliberate confirmation.</p></div></div>{selected&&<div className="mt-4"><CompanyDeleteControl companyId={selected.id} companyName={selected.name} companyCode={selected.code} onDeleted={async () => { await load(); await refreshAccess(); }}/></div>}</section>
      {selected&&<TransactionResetControl companyId={selected.id} companyName={selected.name} companyCode={selected.code}/>}
    </>}
  </div>;
}
