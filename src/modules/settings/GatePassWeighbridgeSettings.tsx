import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthContext";

type Mode = "fixed_only" | "percentage_only" | "greater_of_both";
type Config = {
  tolerance_mode: Mode;
  fixed_tolerance_kg: number;
  percentage_tolerance: number;
};

const defaults: Config = {
  tolerance_mode: "greater_of_both",
  fixed_tolerance_kg: 1,
  percentage_tolerance: 0.5,
};

export default function GatePassWeighbridgeSettings() {
  const { activeBusinessUnit } = useAuth();
  const [config, setConfig] = useState<Config>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const exampleNet = 1000;
  const exampleAllowed = useMemo(() => {
    const pct = exampleNet * config.percentage_tolerance / 100;
    if (config.tolerance_mode === "fixed_only") return config.fixed_tolerance_kg;
    if (config.tolerance_mode === "percentage_only") return pct;
    return Math.max(config.fixed_tolerance_kg, pct);
  }, [config]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.rpc("get_gate_pass_weighbridge_settings");
      if (!mounted) return;
      if (error) setError(error.message);
      else if (data) {
        const d = data as Partial<Config>;
        setConfig({
          tolerance_mode: (d.tolerance_mode as Mode) || defaults.tolerance_mode,
          fixed_tolerance_kg: Number(d.fixed_tolerance_kg ?? defaults.fixed_tolerance_kg),
          percentage_tolerance: Number(d.percentage_tolerance ?? defaults.percentage_tolerance),
        });
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [activeBusinessUnit?.business_unit_id]);

  const save = async () => {
    setError(null); setSuccess(null);
    if (config.fixed_tolerance_kg < 0 || config.fixed_tolerance_kg > 1000) return setError("Fixed tolerance must be between 0 and 1000 kg.0 1000 ");
    if (config.percentage_tolerance < 0 || config.percentage_tolerance > 10) return setError("Percentage tolerance must be between 0% and 10%.010");
    setSaving(true);
    const { error } = await supabase.rpc("save_gate_pass_weighbridge_settings", {
      p_mode: config.tolerance_mode,
      p_fixed_tolerance_kg: config.fixed_tolerance_kg,
      p_percentage_tolerance: config.percentage_tolerance,
    });
    setSaving(false);
    if (error) setError(error.message);
    else setSuccess("Gate Pass / Weighbridge tolerance settings saved successfully.");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Gate Pass / Weighbridge Settings"
        subtitle="Set the allowed difference between loaded quantity and weighbridge net weight."
      />

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div>}

      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-base font-bold text-slate-900">Weight Reconciliation Tolerance</h2>
          <p className="mt-1 text-sm text-slate-500">This rule is checked at the 2nd Kanta and again before the Final Gate Pass.</p>
        </div>

        {loading ? <div className="py-8 text-sm text-slate-500">Loading settings……</div> : <div className="space-y-5">
          <div>
            <label className="label">Tolerance Rule</label>
            <select className="input max-w-xl" value={config.tolerance_mode} onChange={e => setConfig(v => ({ ...v, tolerance_mode: e.target.value as Mode }))}>
              <option value="greater_of_both">Greater of Fixed or Percentage</option>
              <option value="fixed_only">Fixed Kg Only</option>
              <option value="percentage_only">Percentage Only</option>
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">Fixed Tolerance (kg)</label>
              <input type="number" min="0" max="1000" step="0.1" className="input" value={config.fixed_tolerance_kg} onChange={e => setConfig(v => ({ ...v, fixed_tolerance_kg: Number(e.target.value) }))} />
              <p className="mt-1 text-xs text-slate-500">Example: 1 means ±1 kg is allowed.: 1 ±1 </p>
            </div>
            <div>
              <label className="label">Percentage Tolerance (%)%)</label>
              <input type="number" min="0" max="10" step="0.01" className="input" value={config.percentage_tolerance} onChange={e => setConfig(v => ({ ...v, percentage_tolerance: Number(e.target.value) }))} />
              <p className="mt-1 text-xs text-slate-500">Example: 0.5 means ±0.5% is allowed.: 0.5 ±0.5</p>
            </div>
          </div>

          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
            <div className="font-bold">Live Example</div>
            <div className="mt-1">For Net Material = {exampleNet.toLocaleString()} kg, the current rule allows approximately ±{exampleAllowed.toFixed(2)} kg difference.{exampleNet.toLocaleString()} ±{exampleAllowed.toFixed(2)} </div>
          </div>

          <div className="flex justify-end">
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving……" : "Save Settings"}</button>
          </div>
        </div>}
      </div>
    </div>
  );
}
