import { useEffect, useRef, useState, createContext, useContext, ReactNode } from "react";
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

const AUTH_BOOT_TIMEOUT_MS = 12000;
const OWNER_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const USER_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ABSOLUTE_SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const SESSION_WARNING_MS = 5 * 60 * 1000;
const ACTIVITY_STORAGE_PREFIX = "navilo.auth.activity.";
const START_STORAGE_PREFIX = "navilo.auth.started.";

const sessionKey = (prefix: string, userId: string) => `${prefix}${userId}`;
async function withBootTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out. Check your connection and retry.`)), AUTH_BOOT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  const lastActivityWrite = useRef(0);
  const [sessionWarning, setSessionWarning] = useState<{ remainingMs: number; absolute: boolean } | null>(null);

  useEffect(() => {
    void withBootTimeout(supabase.auth.getSession(), "Session check")
      .then(({ data }) => setSession(data.session))
      .catch((error) => setAccessError(error instanceof Error ? error.message : "Session check failed."))
      .finally(() => setAuthLoading(false));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadAccess = async (): Promise<AccessContext | null> => {
    if (!session?.user.id) { setAccessContext(null); setAccessError(null); return null; }
    setAccessLoading(true); setAccessError(null);
    try {
      const { data, error } = await withBootTimeout(supabase.rpc("get_my_access_context"), "Access context");
      if (error) { setAccessContext(null); setAccessError(error.message); return null; }
      if (!data) { setAccessContext(null); setAccessError("Your login profile has not been provisioned by the software owner."); return null; }
      const next = data as AccessContext;
      setAccessContext(next); return next;
    } catch (error) {
      setAccessContext(null);
      setAccessError(error instanceof Error ? error.message : "Access context failed.");
      return null;
    } finally {
      setAccessLoading(false);
    }
  };

  useEffect(() => { void loadAccess(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [session?.user.id]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !accessContext) return;
    const activityKey = sessionKey(ACTIVITY_STORAGE_PREFIX, userId);
    const startKey = sessionKey(START_STORAGE_PREFIX, userId);
    const now = Date.now();
    if (!localStorage.getItem(startKey)) localStorage.setItem(startKey, String(now));
    if (!localStorage.getItem(activityKey)) localStorage.setItem(activityKey, String(now));

    const recordActivity = () => {
      // Once the warning is visible, incidental pointer/keyboard activity must not
      // silently extend the session. The user must explicitly choose Continue.
      if (sessionWarning) return;
      const at = Date.now();
      if (at - lastActivityWrite.current < 15_000) return;
      lastActivityWrite.current = at;
      localStorage.setItem(activityKey, String(at));
    };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, recordActivity, { passive: true }));

    const check = async () => {
      const at = Date.now();
      const lastActivity = Number(localStorage.getItem(activityKey) || at);
      const started = Number(localStorage.getItem(startKey) || at);
      const idleLimit = accessContext.is_platform_owner ? OWNER_IDLE_TIMEOUT_MS : USER_IDLE_TIMEOUT_MS;
      const idleRemaining = idleLimit - (at - lastActivity);
      const absoluteRemaining = ABSOLUTE_SESSION_TIMEOUT_MS - (at - started);
      const absolute = absoluteRemaining <= idleRemaining;
      const remaining = Math.min(idleRemaining, absoluteRemaining);
      if (remaining <= 0) {
        localStorage.removeItem(activityKey);
        localStorage.removeItem(startKey);
        setSessionWarning(null);
        await supabase.auth.signOut({ scope: "local" });
        setAccessContext(null);
        setAccessError(absoluteRemaining <= 0 ? "Your 12-hour NAVILO session expired. Please sign in again." : "You were signed out after a period of inactivity.");
      } else if (remaining <= SESSION_WARNING_MS) {
        setSessionWarning({ remainingMs: remaining, absolute });
      } else {
        setSessionWarning(null);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 1_000);
    const visibility = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearInterval(timer);
      events.forEach((event) => window.removeEventListener(event, recordActivity));
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [session?.user.id, accessContext, sessionWarning]);

  const continueSession = () => {
    const userId = session?.user.id;
    if (!userId || sessionWarning?.absolute) return;
    localStorage.setItem(sessionKey(ACTIVITY_STORAGE_PREFIX, userId), String(Date.now()));
    lastActivityWrite.current = Date.now();
    setSessionWarning(null);
  };

  const warningLogout = async () => {
    setSessionWarning(null);
    await supabase.auth.signOut();
    setAccessContext(null);
  };

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
      try {
      const { count, error: countError } = await withBootTimeout(
        supabase.from("chart_of_accounts").select("id", { count: "exact", head: true }),
        "Accounting setup check",
      );
      if (cancelled) return;
      if (countError) { setAccountingSetup({ userId, companyId, status: "error", error: countError.message }); return; }
      if ((count ?? 0) === 0) {
        const { error } = await withBootTimeout(supabase.rpc("initialize_default_coa"), "Accounting initialization");
        if (cancelled) return;
        if (error) { setAccountingSetup({ userId, companyId, status: "error", error: error.hint || error.details || error.message }); return; }
      }
      setAccountingSetup({ userId, companyId, status: "ready", error: null });
      } catch (error) {
        if (!cancelled) setAccountingSetup({ userId, companyId, status: "error", error: error instanceof Error ? error.message : "Accounting setup failed." });
      }
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
  const signOut = async () => {
    const userId = session?.user.id;
    await supabase.auth.signOut();
    if (userId) {
      localStorage.removeItem(sessionKey(ACTIVITY_STORAGE_PREFIX, userId));
      localStorage.removeItem(sessionKey(START_STORAGE_PREFIX, userId));
    }
    setAccessContext(null); setAccessError(null);
  };

  const currentUserId = session?.user.id ?? null;
  const accountingStateMatchesContext = accountingSetup.userId === currentUserId && accountingSetup.companyId === (activeCompany?.company_id ?? null);
  const accountingSetupError = currentUserId && accountingStateMatchesContext && accountingSetup.status === "error" ? accountingSetup.error : null;
  const accountingLoading = Boolean(currentUserId && accessContext && activeCompany) && (!accountingStateMatchesContext || accountingSetup.status === "idle" || accountingSetup.status === "loading");
  const isPlatformOwner = Boolean(accessContext?.is_platform_owner);
  const loading = authLoading || accessLoading || switchingCompany || switchingBusinessUnit || accountingLoading;

  const warningSeconds = sessionWarning ? Math.max(0, Math.ceil(sessionWarning.remainingMs / 1000)) : 0;
  const warningClock = `${String(Math.floor(warningSeconds / 60)).padStart(2, "0")}:${String(warningSeconds % 60).padStart(2, "0")}`;
  return <AuthContext.Provider value={{ user: session?.user ?? null, session, loading, accessContext, accessError, isPlatformOwner, activeCompany, availableCompanies, activeBusinessUnit, availableBusinessUnits, switchingCompany, switchingBusinessUnit, accountingSetupError, retryAccountingSetup, refreshAccess, switchCompany, switchBusinessUnit, signIn, signUp, signOut }}>
    {children}
    {sessionWarning && <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-labelledby="session-warning-title">
      <div className="w-full max-w-md rounded-xl border border-amber-200 bg-white p-5 shadow-2xl">
        <div id="session-warning-title" className="text-base font-bold text-slate-900">{sessionWarning.absolute ? "Session limit reached soon" : "Are you still working?"}</div>
        <p className="mt-2 text-sm text-slate-600">{sessionWarning.absolute ? "NAVILO requires a fresh login after 12 hours for security." : "Your NAVILO session will sign out due to inactivity unless you continue."}</p>
        <div className="my-4 text-center font-mono text-3xl font-black tabular-nums text-amber-700">{warningClock}</div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => void warningLogout()}>Log Out Now</button>
          {!sessionWarning.absolute && <button type="button" className="btn-primary" onClick={continueSession}>Continue Session</button>}
        </div>
      </div>
    </div>}
  </AuthContext.Provider>;
}

export function useAuth() { const ctx = useContext(AuthContext); if (!ctx) throw new Error("useAuth must be used within AuthProvider"); return ctx; }
