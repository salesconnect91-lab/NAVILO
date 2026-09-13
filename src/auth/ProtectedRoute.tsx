import { Navigate, useLocation } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission, type ModuleKey } from "@/auth/permissions";

function moduleForPath(pathname:string):ModuleKey|null{
  if(pathname.startsWith("/owner"))return null;
  if(pathname==="/")return "dashboard";
  if(pathname.startsWith("/sales/report"))return "reports";
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
  const { user, loading, accessContext, accessError, isPlatformOwner, activeCompany, activeBusinessUnit, signOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="text-slate-400">Loading… / لوڈ ہو رہا ہے…</div></div>;
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

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
