import SearchableSelect from "@/components/SearchableSelect";
import { Navigate, useLocation } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission, type ModuleKey } from "@/auth/permissions";
import { Building2, Loader2 } from "lucide-react";
import { useState } from "react";

function moduleForPath(pathname:string):ModuleKey|null{
  if(pathname.startsWith("/owner"))return null;
  if(pathname==="/")return "dashboard";
  if(pathname.startsWith("/sales/report")||pathname.startsWith("/sales/person-ledger"))return "reports";
  if(pathname.startsWith("/sales/charges"))return "master";
  if(pathname.startsWith("/sales"))return "sales";
  if(pathname.startsWith("/purchase"))return "purchase";
  if(pathname.startsWith("/master-data"))return "master";
  if(pathname.startsWith("/godown/master"))return "inventory";
  if(pathname.startsWith("/godown"))return "inventory";
  if(pathname.startsWith("/production")||pathname.startsWith("/cutting"))return "production";
  if(pathname.startsWith("/transport"))return "transport";
  if(pathname.startsWith("/reports"))return "reports";
  if(pathname.startsWith("/accounting"))return "accounting";
  if(pathname.startsWith("/settings"))return "settings";
  return null;
}

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, accessContext, accessError, isPlatformOwner, activeCompany, activeBusinessUnit, availableCompanies, requiresCompanySelection, switchingCompany, switchCompany, signOut } = useAuth();
  const [selectionError,setSelectionError]=useState("");
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="text-slate-400">Loading… / لوڈ ہو رہا ہے…</div></div>;
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  if (requiresCompanySelection && accessContext) {
    return <div className="min-h-screen bg-slate-100 px-4 py-12"><div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"><div className="flex items-center gap-3"><div className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><Building2 className="h-5 w-5"/></div><div><h1 className="text-xl font-black text-slate-900">Select Business</h1><p className="text-sm text-slate-500">Your login has access to more than one business. Select the business you want to open.</p></div></div>{selectionError&&<div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{selectionError}</div>}{isPlatformOwner ? (
      <div className="mt-5">
        <label htmlFor="navilo-owner-business-picker" className="mb-1.5 block text-xs font-bold text-slate-700">
          Select Business
        </label>
        <SearchableSelect
          id="navilo-owner-business-picker"
          aria-label="Select business to open"
          value=""
          disabled={switchingCompany}
          searchPlaceholder="Search business by name or code..."
          className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          onChange={(event) => {
            const companyId = event.target.value;
            if (!availableCompanies.some((company) => company.company_id === companyId)) return;
            setSelectionError("");
            void switchCompany(companyId).then(({ error }) => {
              if (error) setSelectionError(error);
            });
          }}
        >
          <option value="" disabled>Choose a business...</option>
          {availableCompanies.map((company) => (
            <option key={company.company_id} value={company.company_id} data-search={company.company_code}>
              {company.company_name} · {company.company_code}
            </option>
          ))}
        </SearchableSelect>
        <p className="mt-2 text-xs text-slate-500">
          Only businesses available to your software-owner login are shown. Selecting a business opens its workspace.
        </p>
        {switchingCompany && <p className="mt-2 flex items-center gap-2 text-xs text-blue-700"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening business...</p>}
      </div>
    ) : (
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{availableCompanies.map(company=><button key={company.company_id} type="button" disabled={switchingCompany} onClick={()=>{setSelectionError("");void switchCompany(company.company_id).then(({error})=>{if(error)setSelectionError(error)})}} className="rounded-xl border border-slate-200 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"><div className="flex items-center justify-between gap-2"><span className="font-bold text-slate-900">{company.company_name}</span>{switchingCompany&&<Loader2 className="h-4 w-4 animate-spin text-blue-600"/>}</div><div className="mt-1 text-xs font-semibold text-slate-500">{company.company_code} · {company.membership_role.replace(/_/g," ")}</div></button>)}</div>
    )}<div className="mt-5 flex justify-end border-t pt-4"><button type="button" className="btn-secondary" onClick={()=>void signOut()}>Sign out</button></div></div></div>;
  }

    const profileBlocked = accessContext && !accessContext.profile_active;
  const noCompanyAccess = accessContext && !isPlatformOwner && !activeCompany;
  if (accessError || !accessContext || profileBlocked || noCompanyAccess) {
    const reason = accessError ? accessError : profileBlocked ? "Your Login ID has been suspended by the software owner." : !accessContext ? "Your Login ID has not been provisioned." : "Your company access is suspended, expired, or inactive.";
    return <div className="min-h-screen bg-slate-50 px-4 py-12"><div className="mx-auto max-w-lg rounded-2xl border border-amber-200 bg-white p-6 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wider text-amber-600">NAVILO Access Control</div><h1 className="mt-2 text-xl font-bold text-slate-900">Access unavailable</h1><p className="mt-2 text-sm text-slate-600">{reason}</p><p className="mt-3 text-xs text-slate-500">Contact the NAVILO software owner or your company administrator.</p><button type="button" className="btn mt-5" onClick={() => void signOut()}>Sign out</button></div></div>;
  }

  const module=moduleForPath(location.pathname);
  if(module&&!isPlatformOwner&&activeCompany){
    const role=activeBusinessUnit?.membership_role??activeCompany.membership_role;
    const permissions=activeBusinessUnit?.permissions??activeCompany.permissions;
    if(!hasPermission(role,module,"view",permissions,false))return <Navigate to="/" replace/>;
  }

  return <>{children}</>;
}
