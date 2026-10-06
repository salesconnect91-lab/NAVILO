import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { usePlatformBranding } from "@/lib/platformBranding";

type LoginMode = "password" | "otp";

export default function Login() {
  const navigate = useNavigate();
  const { branding } = usePlatformBranding();
  const [mode, setMode] = useState<LoginMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const normalizedEmail = email.trim().toLowerCase();
  const showBranding = branding.show_branding && branding.show_on_login;

  useEffect(() => {
    document.title = showBranding && branding.erp_name ? `${branding.erp_name} ERP` : "ERP Login";
  }, [showBranding, branding.erp_name]);

  const clearStatus = () => { setError(null); setMessage(null); };
  const signInWithPassword = async (event: FormEvent) => { event.preventDefault(); if (!normalizedEmail || !password) return; clearStatus(); setLoading(true); const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password }); setLoading(false); if (signInError) { setError("We could not sign you in. Check your Login ID and password, then try again."); return; } if (data.session) { navigate("/", { replace: true }); return; } setError("Login could not be completed. Please try again."); };
  const sendPasswordReset = async () => { if (!normalizedEmail) { setError("Enter your registered email first."); return; } clearStatus(); setLoading(true); const redirectTo = `${window.location.origin}/reset-password`; const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo }); setLoading(false); if (resetError) { setError(resetError.message); return; } setMessage("Password reset link has been sent to your registered email. Please check your inbox."); };
  const sendOtp = async (event?: FormEvent) => { event?.preventDefault(); if (!normalizedEmail) return; clearStatus(); setLoading(true); const { error: otpError } = await supabase.auth.signInWithOtp({ email: normalizedEmail, options: { shouldCreateUser: false } }); setLoading(false); if (otpError) { setError(otpError.message); return; } setOtp(""); setOtpSent(true); setMessage("6-digit login OTP has been sent to your email."); };
  const verifyOtp = async (event?: FormEvent) => { event?.preventDefault(); if (otp.length !== 6) { setError("Please enter the complete 6-digit OTP."); return; } clearStatus(); setLoading(true); const { data, error: verifyError } = await supabase.auth.verifyOtp({ email: normalizedEmail, token: otp, type: "email" }); setLoading(false); if (verifyError) { setError(verifyError.message); return; } if (data.session) { navigate("/", { replace: true }); return; } setError("OTP verification failed. Please request a new code and try again."); };
  const changeLoginId = () => { setOtpSent(false); setOtp(""); clearStatus(); };
  const changeMode = (next: LoginMode) => { setMode(next); setOtpSent(false); setOtp(""); setPassword(""); clearStatus(); };

  const productName = showBranding && branding.erp_name ? branding.erp_name : "NAVILO";
  const tagline = showBranding && branding.show_tagline && branding.tagline ? branding.tagline : "Business Management, Simplified.";

  return <div className="min-h-screen bg-slate-100 lg:grid lg:grid-cols-[1.08fr_.92fr]">
    <section className="relative hidden min-h-screen overflow-hidden bg-slate-950 px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between">
      <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl"/><div className="absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl"/>
      <div className="relative flex items-center gap-3">{showBranding&&branding.logo_url?<img src={branding.logo_url} alt={productName} className="h-11 w-11 rounded-xl bg-white object-contain p-1"/>:<div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-lg font-black">N</div>}<div><div className="text-lg font-black tracking-tight">{productName}</div><div className="text-[11px] font-semibold uppercase tracking-[.18em] text-slate-400">ERP Business Workspace</div></div></div>
      <div className="relative max-w-xl"><div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-300"><ShieldCheck className="h-4 w-4 text-blue-400"/>Secure business workspace</div><h1 className="text-5xl font-black leading-[1.08] tracking-tight">{tagline}</h1><p className="mt-5 max-w-lg text-base leading-7 text-slate-400">One professional workspace for Sales, Purchase, Inventory, Accounting, Operations and Transport.</p><div className="mt-8 grid grid-cols-2 gap-3 text-sm font-semibold text-slate-300"><div className="rounded-xl border border-white/10 bg-white/[.04] p-3">Sales & Purchase</div><div className="rounded-xl border border-white/10 bg-white/[.04] p-3">Accounting & Reports</div><div className="rounded-xl border border-white/10 bg-white/[.04] p-3">Inventory & Operations</div><div className="rounded-xl border border-white/10 bg-white/[.04] p-3">Transport Management</div></div></div>
      <div className="relative text-xs text-slate-500">NAVILO · Secure Business Workspace</div>
    </section>
    <main className="flex min-h-screen items-center justify-center px-5 py-8 sm:px-10">
      <div className="w-full max-w-md">
        <div className="mb-7 lg:hidden">{showBranding&&branding.logo_url?<img src={branding.logo_url} alt={productName} className="mb-3 h-12 max-w-[12rem] object-contain"/>:<div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 font-black text-white">N</div>}<div className="text-xl font-black text-slate-900">{productName}</div><div className="text-sm text-slate-500">{tagline}</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-8">
          <div className="mb-6"><div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><LockKeyhole className="h-5 w-5"/></div><h2 className="text-2xl font-black tracking-tight text-slate-900">{mode==="otp"&&otpSent?"Verify your login":"Welcome back"}</h2><p className="mt-1 text-sm text-slate-500">{mode==="password"?"Sign in to continue to your NAVILO workspace.":otpSent?`Enter the code sent to ${normalizedEmail}`:"We'll send a secure one-time code to your registered email."}</p></div>
          <div className="mb-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-xs font-bold"><button type="button" onClick={()=>changeMode("password")} className={`rounded-md px-3 py-2 transition ${mode==="password"?"bg-white text-slate-900 shadow-sm":"text-slate-500 hover:text-slate-700"}`}>Password</button><button type="button" onClick={()=>changeMode("otp")} className={`rounded-md px-3 py-2 transition ${mode==="otp"?"bg-white text-slate-900 shadow-sm":"text-slate-500 hover:text-slate-700"}`}>Email OTP</button></div>
          {error&&<div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</div>}{message&&<div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-700">{message}</div>}
          {mode==="password"?<form onSubmit={signInWithPassword} className="space-y-4"><div><label className="label">Login ID / Email</label><input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="input mt-1" placeholder="you@company.com"/></div><div><div className="flex items-center justify-between"><label className="label">Password</label><button type="button" disabled={loading} onClick={()=>void sendPasswordReset()} className="text-xs font-bold text-blue-700 hover:text-blue-800 disabled:opacity-50">Forgot password?</button></div><div className="relative mt-1"><input type={showPassword?"text":"password"} required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} className="input w-full pr-11" placeholder="Enter your password"/><button type="button" aria-label={showPassword?"Hide password":"Show password"} onClick={()=>setShowPassword(v=>!v)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-700">{showPassword?<EyeOff className="h-4 w-4"/>:<Eye className="h-4 w-4"/>}</button></div></div><button type="submit" disabled={loading||!normalizedEmail||!password} className="btn-primary flex w-full items-center justify-center gap-2 py-2.5">{loading?"Signing in…":<>Sign in to NAVILO<ArrowRight className="h-4 w-4"/></>}</button></form>:!otpSent?<form onSubmit={sendOtp} className="space-y-4"><div><label className="label">Login ID / Email</label><input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="input mt-1" placeholder="you@company.com"/></div><button type="submit" disabled={loading||!normalizedEmail} className="btn-primary w-full py-2.5">{loading?"Sending OTP…":"Send secure login code"}</button></form>:<form onSubmit={verifyOtp} className="space-y-4"><div><label className="label">6-digit security code</label><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,"").slice(0,6))} className="input mt-1 text-center text-xl tracking-[.35em]" placeholder="123456" autoFocus/></div><button type="submit" disabled={loading||otp.length!==6} className="btn-primary w-full py-2.5">{loading?"Verifying…":"Verify & enter workspace"}</button><div className="flex justify-between text-xs"><button type="button" onClick={changeLoginId} className="font-semibold text-slate-500 hover:text-slate-800">Change Login ID</button><button type="button" disabled={loading} onClick={()=>void sendOtp()} className="font-bold text-blue-700 disabled:opacity-50">Resend code</button></div></form>}
          <div className="mt-6 flex items-center justify-center gap-2 border-t border-slate-100 pt-5 text-[11px] font-semibold text-slate-400"><ShieldCheck className="h-3.5 w-3.5"/>Protected NAVILO workspace</div>
        </div>
        <p className="mt-5 text-center text-xs text-slate-400">Access is restricted to registered users. Need help signing in? Contact your NAVILO administrator.</p>
      </div>
    </main>
  </div>;
}
