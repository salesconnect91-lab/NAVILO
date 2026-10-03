import { useEffect, useState, createContext, useContext, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type BusinessUnitAccess = {
  business_unit_id: string;
  business_unit_code: string;
  business_unit_name: string;
  business_unit_type: "steel" | "transport" | "retail" | "fuel" | "construction" | "custom" | string;
  is_default: boolean;
  membership_role: string;
  membership_active: boolean;
  permissions: Record<string, unknown>;
  enabled_modules: string[];
  access_allowed: boolean;
};

type CompanyAccess = {
  company_id: string;
  company_name: string;
  company_code: string;
  company_status: "trial" | "active" | "suspended" | "expired" | "closed";
  subscription_expires_at: string | null;
  membership_role: string;
  membership_active: boolean;
  permissions: Record<string, unknown>;
  enabled_modules?: string[];
  business_units?: BusinessUnitAccess[];
  access_allowed: boolean;
};

type AccessContext = {
  user_id: string;
  profile_active: boolean;
  platform_role: "super_admin" | "support" | "user";
  is_platform_owner: boolean;
  current_company_id: string | null;
  current_business_unit_id: string | null;
  companies: CompanyAccess[];
};

type AccountingSetupState = {
  userId: string | null;
  companyId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
};

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  accessContext: AccessContext | null;
  accessError: string | null;
  isPlatformOwner: boolean;
  activeCompany: CompanyAccess | null;
  availableCompanies: CompanyAccess[];
  activeBusinessUnit: BusinessUnitAccess | null;
  availableBusinessUnits: BusinessUnitAccess[];
  switchingCompany: boolean;
  switchingBusinessUnit: boolean;
  accountingSetupError: string | null;
  retryAccountingSetup: () => void;
  refreshAccess: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<{ error: string | null }>;
  switchBusinessUnit: (businessUnitId: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(false);
  const [switchingCompany, setSwitchingCompany] = useState(false);
  const [switchingBusinessUnit, setSwitchingBusinessUnit] = useState(false);
  const [accessContext, setAccessContext] = useState<AccessContext | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accountingAttempt, setAccountingAttempt] = useState(0);
  const [accountingSetup, setAccountingSetup] = useState<AccountingSetupState>({ userId: null, companyId: null, status: "idle", error: null });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadAccess = async (): Promise<AccessContext | null> => {
    if (!session?.user.id) { setAccessContext(null); setAccessError(null); return null; }
    setAccessLoading(true); setAccessError(null);
    const { data, error } = await supabase.rpc("get_my_access_context");
    if (error) { setAccessContext(null); setAccessError(error.message); setAccessLoading(false); return null; }
    if (!data) { setAccessContext(null); setAccessError("Your login profile has not been provisioned by the software owner."); setAccessLoading(false); return null; }
    const next = data as AccessContext;
    setAccessContext(next); setAccessLoading(false); return next;
  };

  useEffect(() => { void loadAccess(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [session?.user.id]);

  const currentCompanyId = accessContext?.current_company_id ?? null;
  const activeCompany = accessContext?.companies.find((company) => company.company_id === currentCompanyId && company.access_allowed) ?? accessContext?.companies.find((company) => company.access_allowed) ?? null;
  const availableCompanies = accessContext?.companies.filter((company) => company.access_allowed) ?? [];
  const availableBusinessUnits = activeCompany?.business_units?.filter((unit) => unit.access_allowed) ?? [];
  const activeBusinessUnit = availableBusinessUnits.find((unit) => unit.business_unit_id === accessContext?.current_business_unit_id) ?? availableBusinessUnits.find((unit) => unit.is_default) ?? availableBusinessUnits[0] ?? null;

  useEffect(() => {
    const userId = session?.user.id;
    const companyId = activeCompany?.company_id ?? null;
    if (!userId || accessLoading || !accessContext) { setAccountingSetup((current) => current.userId === null && current.companyId === null && current.status === "idle" && current.error === null ? current : { userId: null, companyId: null, status: "idle", error: null }); return; }
    const allowed = accessContext.profile_active && Boolean(activeCompany?.access_allowed);
    if (!allowed || !companyId) { setAccountingSetup({ userId, companyId, status: "ready", error: null }); return; }
    const role = activeCompany?.membership_role;
    const canInitializeAccounting = accessContext.is_platform_owner || role === "company_owner" || role === "admin" || role === "accounts";
    if (!canInitializeAccounting) { setAccountingSetup({ userId, companyId, status: "ready", error: null }); return; }
    let cancelled = false;
    setAccountingSetup({ userId, companyId, status: "loading", error: null });
    void (async () => {
      const { count, error: countError } = await supabase.from("chart_of_accounts").select("id", { count: "exact", head: true });
      if (cancelled) return;
      if (countError) { setAccountingSetup({ userId, companyId, status: "error", error: countError.message }); return; }
      if ((count ?? 0) === 0) {
        const { error } = await supabase.rpc("initialize_default_coa");
        if (cancelled) return;
        if (error) { setAccountingSetup({ userId, companyId, status: "error", error: error.hint || error.details || error.message }); return; }
      }
      setAccountingSetup({ userId, companyId, status: "ready", error: null });
    })();
    return () => { cancelled = true; };
  }, [session?.user.id, accessContext, accessLoading, activeCompany?.company_id, accountingAttempt]);

  const retryAccountingSetup = () => { setAccountingSetup((current) => ({ ...current, status: "loading", error: null })); setAccountingAttempt((attempt) => attempt + 1); };
  const refreshAccess = async () => { await loadAccess(); };

  const switchCompany = async (companyId: string) => {
    if (!companyId || companyId === activeCompany?.company_id) return { error: null };
    setSwitchingCompany(true); setAccessError(null);
    setAccountingSetup({ userId: session?.user.id ?? null, companyId, status: "idle", error: null });
    const { error } = await supabase.rpc("set_current_company", { p_company_id: companyId });
    if (error) { setSwitchingCompany(false); setAccessError(error.message); return { error: error.message }; }
    const next = await loadAccess(); setSwitchingCompany(false);
    if (!next || next.current_company_id !== companyId) { const message = "Company switch could not be confirmed."; setAccessError(message); return { error: message }; }
    return { error: null };
  };

  const switchBusinessUnit = async (businessUnitId: string) => {
    if (!businessUnitId || businessUnitId === activeBusinessUnit?.business_unit_id) return { error: null };
    setSwitchingBusinessUnit(true); setAccessError(null);
    const { error } = await supabase.rpc("set_current_business_unit", { p_business_unit_id: businessUnitId });
    if (error) { setSwitchingBusinessUnit(false); setAccessError(error.message); return { error: error.message }; }
    const next = await loadAccess(); setSwitchingBusinessUnit(false);
    if (!next || next.current_business_unit_id !== businessUnitId) { const message = "Business unit switch could not be confirmed."; setAccessError(message); return { error: message }; }
    return { error: null };
  };

  const signIn = async (email: string, password: string) => { const { error } = await supabase.auth.signInWithPassword({ email, password }); return { error: error?.message ?? null }; };
  const signUp = async (email: string, password: string) => { const { error } = await supabase.auth.signUp({ email, password }); return { error: error?.message ?? null }; };
  const signOut = async () => { await supabase.auth.signOut(); setAccessContext(null); setAccessError(null); };

  const currentUserId = session?.user.id ?? null;
  const accountingStateMatchesContext = accountingSetup.userId === currentUserId && accountingSetup.companyId === (activeCompany?.company_id ?? null);
  const accountingSetupError = currentUserId && accountingStateMatchesContext && accountingSetup.status === "error" ? accountingSetup.error : null;
  const accountingLoading = Boolean(currentUserId && accessContext && activeCompany) && (!accountingStateMatchesContext || accountingSetup.status === "idle" || accountingSetup.status === "loading");
  const isPlatformOwner = Boolean(accessContext?.is_platform_owner);
  const loading = authLoading || accessLoading || switchingCompany || switchingBusinessUnit || accountingLoading;

  return <AuthContext.Provider value={{ user: session?.user ?? null, session, loading, accessContext, accessError, isPlatformOwner, activeCompany, availableCompanies, activeBusinessUnit, availableBusinessUnits, switchingCompany, switchingBusinessUnit, accountingSetupError, retryAccountingSetup, refreshAccess, switchCompany, switchBusinessUnit, signIn, signUp, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() { const ctx = useContext(AuthContext); if (!ctx) throw new Error("useAuth must be used within AuthProvider"); return ctx; }
