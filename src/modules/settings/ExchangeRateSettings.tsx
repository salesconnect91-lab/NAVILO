import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Currency = { code: string; name: string };
type Rate = { id: string; foreign_currency_code: string; base_currency_code: string; effective_on: string; rate: number; source: string };

export default function ExchangeRateSettings() {
  const [companyId, setCompanyId] = useState("");
  const [base, setBase] = useState("");
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [foreign, setForeign] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(() => {
    const today = new Date();
    return new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  });
  const [rate, setRate] = useState("");
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    const { data: activeId, error: contextError } = await supabase.rpc("current_company_id");
    if (contextError) throw contextError;
    if (!activeId) throw new Error("Select a company to manage exchange rates.");
    const id = String(activeId);
    const [companyResult, currencyResult, rateResult] = await Promise.all([
      supabase.from("companies").select("base_currency_code").eq("id", id).single(),
      supabase.from("currency_master").select("code,name").eq("is_active", true).order("code"),
      supabase.from("company_exchange_rates").select("id,foreign_currency_code,base_currency_code,effective_on,rate,source").eq("company_id", id).order("effective_on", { ascending: false }).limit(50),
    ]);
    const missingSchema = [companyResult.error, currencyResult.error, rateResult.error]
      .some(problem => problem && ["42P01", "42703", "PGRST205"].includes(problem.code));
    if (missingSchema) { setUnavailable(true); return; }
    if (companyResult.error) throw companyResult.error;
    if (currencyResult.error) throw currencyResult.error;
    if (rateResult.error) throw rateResult.error;
    setUnavailable(false);
    setCompanyId(id);
    setBase(companyResult.data.base_currency_code);
    setCurrencies(currencyResult.data || []);
    setRates(rateResult.data || []);
  }, []);

  useEffect(() => {
    void load().catch((problem: unknown) => setError(problem instanceof Error ? problem.message : "Exchange rates could not be loaded."));
    const reload = () => { void load().catch((problem: unknown) => setError(problem instanceof Error ? problem.message : "Exchange rates could not be loaded.")); };
    window.addEventListener("navilo-workspace-changed", reload);
    return () => window.removeEventListener("navilo-workspace-changed", reload);
  }, [load]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(""); setNotice("");
    const parsedRate = Number(rate);
    if (!companyId || !foreign || foreign === base || !effectiveOn || !Number.isFinite(parsedRate) || parsedRate <= 0 || !source.trim()) {
      setError("Choose a foreign currency, effective date, positive rate and source.");
      return;
    }
    setSaving(true);
    try {
      const { error: insertError } = await supabase.from("company_exchange_rates").insert({
        company_id: companyId, foreign_currency_code: foreign, base_currency_code: base,
        effective_on: effectiveOn, rate: parsedRate, source: source.trim(),
      });
      if (insertError) throw insertError;
      setRate(""); setSource(""); setNotice("Exchange rate recorded. Earlier posted entries keep their original snapshots.");
      await load();
    } catch (problem: unknown) {
      setError(problem instanceof Error ? problem.message : "Exchange rate could not be saved.");
    } finally { setSaving(false); }
  };

  if (unavailable) return null;
  return <section className="mt-5 max-w-5xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
    <h2 className="font-bold text-slate-900">Company exchange rates</h2>
    <p className="mt-1 text-sm text-slate-600">Accounting base: <strong>{base || "Loading…"}</strong>. Rate means one unit of foreign currency in {base || "company base currency"}. Rates apply from their effective date; earlier journal snapshots stay unchanged.</p>
    <p className="mt-1 text-xs text-amber-800">Foreign-currency invoice and journal posting stays unavailable until the ledger, party balances and reversal flows support conversion.</p>
    {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}
    <form onSubmit={save} className="mt-4 grid gap-3 md:grid-cols-5">
      <label className="text-xs font-semibold">Foreign currency
        <select className="input mt-1 w-full" value={foreign} onChange={event => setForeign(event.target.value)} required>
          <option value="">Select…</option>{currencies.filter(currency => currency.code !== base).map(currency => <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>)}
        </select>
      </label>
      <label className="text-xs font-semibold">Effective from
        <input className="input mt-1 w-full" type="date" value={effectiveOn} onChange={event => setEffectiveOn(event.target.value)} required />
      </label>
      <label className="text-xs font-semibold">1 foreign = {base || "base"}
        <input className="input mt-1 w-full" type="number" step="any" min="0.0000000001" value={rate} onChange={event => setRate(event.target.value)} required />
      </label>
      <label className="text-xs font-semibold">Source
        <input className="input mt-1 w-full" value={source} onChange={event => setSource(event.target.value)} placeholder="Bank / agreed rate" required />
      </label>
      <button className="btn btn-primary self-end" type="submit" disabled={saving || !base}>{saving ? "Saving…" : "Record rate"}</button>
    </form>
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="py-2">Effective from</th><th>Currency</th><th>Base</th><th>Rate</th><th>Source</th></tr></thead>
        <tbody>{rates.map(entry => <tr key={entry.id} className="border-b border-slate-100"><td className="py-2">{entry.effective_on}</td><td>{entry.foreign_currency_code}</td><td>{entry.base_currency_code}</td><td>{entry.rate}</td><td>{entry.source}</td></tr>)}</tbody>
      </table>
      {!rates.length && <p className="py-3 text-sm text-slate-500">No exchange rates recorded for this company.</p>}
    </div>
  </section>;
}
