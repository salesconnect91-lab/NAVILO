import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ErrorBanner } from "@/components/ui";
import { getJurisdictionProfile } from "@/lib/jurisdictionConfig";

type Tax = { id?: string; name: string; rate: string; applies_to: "sales" | "purchase" | "both"; is_fixed: boolean; is_active: boolean; effective_from: string | null; effective_to: string | null };

export default function TaxSettings() {
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [countryCode,setCountryCode]=useState<string|null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const jurisdiction=getJurisdictionProfile(countryCode);

  const load = useCallback(async () => {
    setError(null);
    const [settingsResult,taxResult]=await Promise.all([
      supabase.from("company_settings").select("country_code").maybeSingle(),
      supabase.from("tax_rates").select("*").order("name"),
    ]);
    if(settingsResult.error){setError(settingsResult.error.message);return;}
    if(taxResult.error){setError(taxResult.error.message);return;}
    setCountryCode(settingsResult.data?.country_code||null);
    setTaxes((taxResult.data ?? []).map((row) => ({ ...row, rate: String(row.rate) })) as Tax[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setError(null);
    try {
      for (const tax of taxes) {
        const payload = { name: tax.name.trim(), rate: Number(tax.rate) || 0, applies_to: tax.applies_to, is_fixed: tax.is_fixed, is_active: tax.is_active, effective_from: tax.effective_from || null, effective_to: tax.effective_to || null };
        if (!payload.name) throw new Error(`${jurisdiction.taxLabel} name is required.`);
        if (payload.rate < 0 || payload.rate > 100) throw new Error("Tax rate must be between 0 and 100.");
        if (payload.effective_from && payload.effective_to && payload.effective_to < payload.effective_from) throw new Error("Effective To must be on or after Effective From.");
        const result = tax.id ? await supabase.from("tax_rates").update(payload).eq("id", tax.id) : await supabase.from("tax_rates").insert(payload);
        if (result.error) throw result.error;
      }
      setSaved(true); setTimeout(() => setSaved(false), 2500); await load();
    } catch (saveError: unknown) {
      const message = saveError instanceof Error ? saveError.message : typeof saveError === "object" && saveError !== null && "message" in saveError ? String(saveError.message) : "Save failed.";
      setError(`Save failed: ${message}`);
    }
  };

  const remove = async (tax: Tax, index: number) => {
    if (!tax.id) { setTaxes((rows) => rows.filter((_, rowIndex) => rowIndex !== index)); return; }
    const { error: deleteError } = await supabase.from("tax_rates").delete().eq("id", tax.id);
    if (deleteError) setError(deleteError.message); else await load();
  };

  return <div className="space-y-4">
    <div className="rounded-xl border bg-white p-5"><h1 className="text-xl font-bold">{jurisdiction.taxLabel} Settings</h1><p className="mt-1 text-xs text-slate-500">{jurisdiction.name} statutory profile · {jurisdiction.authorityLabel}. Configure company {jurisdiction.taxLabel} rates for sales and purchases. Rates stay configurable because statutory rates may change.</p></div>
    {!countryCode&&<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Select Country / Jurisdiction in Company Settings first. NAVILO will then use the correct statutory terminology and defaults.</div>}
    {error && <ErrorBanner message={error} />}
    {saved && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">Saved successfully</div>}
    <section className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">{jurisdiction.taxLabel} Rates</h2><p className="text-[12px] text-slate-400">Add a new rate with an Effective From date when the rate changes. Existing invoice rates stay saved on the document.</p></div><button className="btn-secondary" onClick={() => setTaxes([...taxes, { name: `New ${jurisdiction.taxLabel}`, rate: "0", applies_to: "both", is_fixed: false, is_active: true, effective_from: new Date().toISOString().slice(0,10), effective_to: null }])}><Plus className="h-3.5 w-3.5" /> Add</button></div>
      <div className="space-y-2">{taxes.map((tax, index) => <div key={tax.id ?? index} className="grid grid-cols-1 gap-2 rounded border p-3 md:grid-cols-4 xl:grid-cols-[2fr_1fr_1fr_1fr_1.5fr_1fr_1fr_auto]">
        <input className="input" value={tax.name} onChange={(event) => setTaxes(taxes.map((row, i) => i === index ? { ...row, name: event.target.value } : row))} />
        <input className="input" type="number" min="0" max="100" step="0.01" value={tax.rate} onChange={(event) => setTaxes(taxes.map((row, i) => i === index ? { ...row, rate: event.target.value } : row))} />
        <label className="text-xs">Effective From<input className="input" type="date" value={tax.effective_from || ""} onChange={(event) => setTaxes(taxes.map((row,i) => i === index ? { ...row, effective_from: event.target.value || null } : row))} /></label>
        <label className="text-xs">Effective To<input className="input" type="date" value={tax.effective_to || ""} onChange={(event) => setTaxes(taxes.map((row,i) => i === index ? { ...row, effective_to: event.target.value || null } : row))} /></label>
        <SearchableSelect className="input" value={tax.applies_to} onChange={(event) => setTaxes(taxes.map((row, i) => i === index ? { ...row, applies_to: event.target.value as Tax["applies_to"] } : row))}><option value="sales">Sales</option><option value="purchase">Purchase</option><option value="both">Both</option></SearchableSelect>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={tax.is_fixed} onChange={(event) => setTaxes(taxes.map((row, i) => i === index ? { ...row, is_fixed: event.target.checked } : row))} /> Fixed</label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={tax.is_active} onChange={(event) => setTaxes(taxes.map((row, i) => i === index ? { ...row, is_active: event.target.checked } : row))} /> Active</label>
        <button type="button" className="rounded border p-2 text-rose-600" onClick={() => void remove(tax, index)} title="Delete tax"><Trash2 className="h-4 w-4" /></button>
      </div>)}</div>
    </section>
    <div className="flex justify-end"><button className="btn-primary" onClick={() => void save()}><Save className="h-3.5 w-3.5" /> Save Settings</button></div>
  </div>;
}
