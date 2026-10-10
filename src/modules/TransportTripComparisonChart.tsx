import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";

type MonthlyRow = { month: number; current: number; previous: number };
type YearlyRow = { year: number; trips: number };
type Comparison = {
  as_of: string;
  current_year: number;
  previous_year: number;
  monthly: MonthlyRow[];
  yearly: YearlyRow[];
};
type View = "monthly" | "yearly";
const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmt = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);

export default function TransportTripComparisonChart({
  companyId, businessUnitId, asOf,
}: {
  companyId: string;
  businessUnitId: string;
  asOf: string;
}) {
  const [view, setView] = useState<View>("monthly");
  const [data, setData] = useState<Comparison | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setError("");
    void (async () => {
      const result = await supabase.rpc("transport_trip_volume_comparison", { p_as_of: asOf });
      if (cancelled) return;
      setLoading(false);
      if (result.error) { setError(result.error.message); return; }
      setData(result.data as Comparison);
    })();
    return () => { cancelled = true; };
  }, [companyId, businessUnitId, asOf]);

  const monthly = useMemo(() => (data?.monthly ?? []).map(row => ({
    month: monthNames[row.month - 1] ?? String(row.month),
    current: Number(row.current) || 0,
    previous: Number(row.previous) || 0,
  })), [data]);
  const yearly = useMemo(() => (data?.yearly ?? []).map(row => ({
    year: String(row.year),
    trips: Number(row.trips) || 0,
  })), [data]);
  const currentTotal = monthly.reduce((sum,row) => sum + row.current,0);
  const previousTotal = monthly.reduce((sum,row) => sum + row.previous,0);
  const delta = previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : null;
  const hasTrips = monthly.some(row => row.current !== 0 || row.previous !== 0);
  const cutoffLabel = data ? new Date(data.as_of + "T00:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short"}) : "";

  return <section aria-label="Monthly and yearly trip comparison" className="rounded-lg border border-slate-200 bg-white p-2.5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-xs font-black text-slate-900">Trip Volume Comparison</h3>
        <p className="text-[10px] text-slate-500">Trip dates · same {cutoffLabel || "date"} cutoff each year · current operating location</p>
      </div>
      <div role="group" aria-label="Comparison period" className="flex gap-1 rounded-md bg-slate-100 p-1">
        <button type="button" aria-pressed={view==="monthly"} onClick={()=>setView("monthly")}
          className={`rounded px-2.5 py-1 text-[11px] font-bold ${view==="monthly"?"bg-blue-700 text-white":"text-slate-600 hover:bg-white"}`}>Monthly</button>
        <button type="button" aria-pressed={view==="yearly"} onClick={()=>setView("yearly")}
          className={`rounded px-2.5 py-1 text-[11px] font-bold ${view==="yearly"?"bg-blue-700 text-white":"text-slate-600 hover:bg-white"}`}>Yearly</button>
      </div>
    </div>
    {data && <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-700">
      <span><strong>{data.current_year} YTD:</strong> {fmt(currentTotal)} trips</span>
      <span><strong>{data.previous_year} same period:</strong> {fmt(previousTotal)} trips</span>
      <span><strong>Change:</strong> {delta === null ? (currentTotal ? "No prior-year baseline" : "—") : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`}</span>
    </div>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    {loading ? <div className="flex h-44 items-center justify-center text-xs text-slate-500">Loading trip comparison…</div>
    : !data ? <div className="flex h-44 items-center justify-center text-xs text-slate-500">Trip comparison unavailable.</div>
    : !hasTrips && !yearly.some(row=>row.trips) ? <div className="flex h-44 items-center justify-center rounded-md bg-slate-50 text-xs font-semibold text-slate-500">No trips recorded in the comparison period.</div>
    : <div className="mt-2 h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {view==="monthly"
          ? <BarChart data={monthly} margin={{top:4,right:8,left:-20,bottom:0}}>
            <CartesianGrid stroke="#e2e8f0" vertical={false}/>
            <XAxis dataKey="month" tick={{fontSize:10}}/>
            <YAxis allowDecimals={false} tick={{fontSize:10}}/>
            <Tooltip formatter={(v)=>`${fmt(Number(v))} trips`}/>
            <Legend wrapperStyle={{fontSize:11}}/>
            <Bar dataKey="previous" name={String(data.previous_year)} fill="#94a3b8" radius={[2,2,0,0]}/>
            <Bar dataKey="current" name={String(data.current_year)} fill="#2563eb" radius={[2,2,0,0]}/>
          </BarChart>
          : <BarChart data={yearly} margin={{top:4,right:8,left:-20,bottom:0}}>
            <CartesianGrid stroke="#e2e8f0" vertical={false}/>
            <XAxis dataKey="year" tick={{fontSize:10}}/>
            <YAxis allowDecimals={false} tick={{fontSize:10}}/>
            <Tooltip formatter={(v)=>`${fmt(Number(v))} trips`}/>
            <Bar dataKey="trips" name="Trips (same-period YTD)" fill="#2563eb" radius={[3,3,0,0]}/>
          </BarChart>}
      </ResponsiveContainer>
    </div>}
    <p className="mt-1 text-[10px] text-slate-500">Comparison uses recorded trips, not invoices or payments. All years are measured through the same calendar cutoff.</p>
  </section>;
}
