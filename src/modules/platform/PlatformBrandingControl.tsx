import { useEffect, useState } from "react";
import { Eye, EyeOff, ImagePlus, Loader2, Save, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ConfirmModal } from "@/components/ui";
import { HIDDEN_PLATFORM_BRANDING, invalidatePlatformBranding, loadPlatformBranding, type PlatformBranding } from "@/lib/platformBranding";

export default function PlatformBrandingControl() {
  const [form, setForm] = useState<PlatformBranding>(HIDDEN_PLATFORM_BRANDING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmHideBranding, setConfirmHideBranding] = useState(false);

  useEffect(() => {
    void loadPlatformBranding(true)
      .then(setForm)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load NAVILO branding."))
      .finally(() => setLoading(false));
  }, []);

  const patch = <K extends keyof PlatformBranding>(key: K, value: PlatformBranding[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (form.show_branding && !form.erp_name.trim()) {
      setError("Product name is required when NAVILO branding is enabled.");
      return;
    }
    setSaving(true); setError(""); setMessage("");
    const { error: saveError } = await supabase.from("platform_branding").update({
      erp_name: form.erp_name.trim() || "NAVILO",
      tagline: form.tagline?.trim() || null,
      logo_url: form.logo_url || null,
      show_branding: form.show_branding,
      show_on_login: form.show_on_login,
      show_in_sidebar: form.show_in_sidebar,
      show_on_prints: form.show_on_prints,
      show_tagline: form.show_tagline,
      updated_at: new Date().toISOString(),
      updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    }).eq("id", 1);
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    invalidatePlatformBranding();
    setMessage("NAVILO branding saved. Visibility now follows the selected locations below.");
  };

  const uploadLogo = async (file: File | null) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type)) { setError("Use PNG, JPG, WebP or SVG."); return; }
    if (file.size > 2 * 1024 * 1024) { setError("NAVILO logo must be 2 MB or smaller."); return; }
    setUploading(true); setError(""); setMessage("");
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `erp/platform-logo.${ext}`;
      const { error: uploadError } = await supabase.storage.from("platform-branding").upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("platform-branding").getPublicUrl(path);
      const logoUrl = `${data.publicUrl}?v=${Date.now()}`;
      const { error: updateError } = await supabase.from("platform_branding").update({ logo_url: logoUrl, updated_at: new Date().toISOString() }).eq("id", 1);
      if (updateError) throw updateError;
      setForm((current) => ({ ...current, logo_url: logoUrl }));
      invalidatePlatformBranding();
      setMessage("NAVILO logo uploaded and saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Logo upload failed.");
    } finally { setUploading(false); }
  };

  const removeLogo = async () => {
    setUploading(true); setError(""); setMessage("");
    try {
      const { data: files, error: listError } = await supabase.storage.from("platform-branding").list("erp");
      if (listError) throw listError;
      const paths = (files ?? []).filter((f) => f.name.startsWith("platform-logo.")).map((f) => `erp/${f.name}`);
      if (paths.length) {
        const { error: removeError } = await supabase.storage.from("platform-branding").remove(paths);
        if (removeError) throw removeError;
      }
      const { error: updateError } = await supabase.from("platform_branding").update({ logo_url: null, updated_at: new Date().toISOString() }).eq("id", 1);
      if (updateError) throw updateError;
      setForm((current) => ({ ...current, logo_url: null }));
      invalidatePlatformBranding();
      setMessage("NAVILO logo removed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove NAVILO logo.");
    } finally { setUploading(false); }
  };

  if (loading) return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading NAVILO branding...</div></section>;

  return <section className="rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-base font-black text-slate-950">{form.show_branding ? <Eye className="h-5 w-5 text-blue-600"/> : <EyeOff className="h-5 w-5 text-slate-500"/>}NAVILO Branding</h2><p className="mt-1 max-w-3xl text-xs text-slate-500">Platform Owner controls the NAVILO product identity. Company names and company logos remain separate company-level branding.</p></div>
      <label className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-2 text-sm font-bold ${form.show_branding ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-slate-50 text-slate-700"}`}><input type="checkbox" checked={form.show_branding} onChange={(e)=>{ if(e.target.checked) patch("show_branding",true); else setConfirmHideBranding(true); }} /><span>{form.show_branding ? "Show NAVILO Branding" : "NAVILO product branding hidden globally"}</span></label>
    </div>
    {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    {message && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}
    <div className="mt-4 grid gap-4 lg:grid-cols-[180px_1fr]">
      <div className="flex min-h-32 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">{form.logo_url ? <img src={form.logo_url} alt="NAVILO logo" className="max-h-28 max-w-full object-contain"/> : <span className="text-center text-xs text-slate-400">No NAVILO logo</span>}</div>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Product Name<input className="input mt-1 w-full" value={form.erp_name} onChange={(e)=>patch("erp_name",e.target.value)} placeholder="NAVILO" /></label><label className="text-xs font-semibold text-slate-700">Tagline<input className="input mt-1 w-full" value={form.tagline ?? ""} onChange={(e)=>patch("tagline",e.target.value)} placeholder="Run Your Business as One." /></label></div>
        <div className="flex flex-wrap gap-2"><label className="btn btn-secondary cursor-pointer">{uploading ? <Loader2 className="h-4 w-4 animate-spin"/> : <ImagePlus className="h-4 w-4"/>}{form.logo_url ? "Change NAVILO Logo" : "Upload NAVILO Logo"}<input type="file" className="hidden" disabled={uploading} accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e)=>{void uploadLogo(e.target.files?.[0] ?? null); e.currentTarget.value="";}}/></label>{form.logo_url && <button type="button" className="btn btn-danger" disabled={uploading} onClick={()=>void removeLogo()}><Trash2 className="h-4 w-4"/>Remove Logo</button>}</div>
      </div>
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{([
      ["show_on_login","Login screen"],["show_in_sidebar","Sidebar / workspace"],["show_on_prints","Print / PDF"],["show_tagline","Tagline"]
    ] as const).map(([key,label])=><label key={key} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"><span>{label}</span><input type="checkbox" checked={form[key]} disabled={!form.show_branding} onChange={(e)=>patch(key,e.target.checked)} /></label>)}</div>
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">When <strong>Show NAVILO Branding</strong> is ON, NAVILO appears only in the selected locations. When it is OFF, NAVILO product branding stays hidden everywhere.</div>
    <div className="mt-4 flex justify-end"><button type="button" className="btn btn-primary" disabled={saving || uploading} onClick={()=>void save()}>{saving ? <Loader2 className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4"/>}Save NAVILO Branding</button></div>
    <ConfirmModal open={confirmHideBranding} title="Hide NAVILO product branding globally?" message="Login, Sidebar / workspace, Print / PDF and Tagline branding will be hidden after you save. Their individual selections will be preserved and become active again when global branding is turned back on." tone="danger" onCancel={()=>setConfirmHideBranding(false)} onConfirm={()=>{ patch("show_branding",false); setConfirmHideBranding(false); }} />
  </section>;
}
