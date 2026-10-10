import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileClock, ReceiptText, Route, Truck } from "lucide-react";
import { supabase } from "@/lib/supabase";

type TransportSummary = {
  currency: string;
  total_trips: number;
  draft_trips: number;
  incomplete_trips: number;
  complete_trips: number;
  locked_trips: number;
  settled_trips: number;
  ppr_pending: number;
  customer_rate_pending: number;
  supplier_rent_pending: number;
  trips_without_linked_sales_invoice: number;
  customer_billed: number;
};
type Contribution = { ownership: string; trips: number; revenue: number; cost: number; profit: number };
const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value) || 0);

export default function TransportDashboardPanel({
  companyId, businessUnitId, startDate, endDate,
}: {
  companyId: string;
  businessUnitId: string;
  startDate: string;
  endDate: string;
}) {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<TransportSummary | null>(null);
  const [contributions, setContributions] = useState<Contribution[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setContributions(null);
    setError("");
    void (async () => {
      const [operational, financial] = await Promise.all([
        supabase.rpc("transport_dashboard_operational_summary", { p_from: startDate, p_to: endDate }),
        supabase.rpc("transport_contribution_summary", { p_from: startDate, p_to: endDate }),
      ]);
      if (cancelled) return;
      if (operational.error) {
        setError(operational.error.message);
        return;
      }
      setSummary(operational.data as TransportSummary);
      // Server-side permission checks protect both sides of financial data.
      if (!financial.error && Array.isArray(financial.data)) {
        setContributions(financial.data as Contribution[]);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, businessUnitId, startDate, endDate]);

  const tiles = [
    { label: "Trips", value: summary?.total_trips, icon: Truck },
    { label: "Draft", value: summary?.draft_trips, icon: FileClock },
    { label: "Incomplete", value: summary?.incomplete_trips, icon: AlertTriangle },
    { label: "Complete", value: summary?.complete_trips, icon: ClipboardCheck },
    { label: "Locked", value: summary?.locked_trips, icon: Route },
    { label: "Settled", value: summary?.settled_trips, icon: CheckCircle2 },
    { label: "PPR Pending", value: summary?.ppr_pending, icon: ReceiptText },
  ];
  const financial = contributions && [
    { label: "Posted trip revenue", value: contributions.reduce((n, row) => n + Number(row.revenue || 0), 0) },
    { label: "Posted trip cost", value: contributions.reduce((n, row) => n + Number(row.cost || 0), 0) },
    { label: "Posted trip contribution", value: contributions.reduce((n, row) => n + Number(row.profit || 0), 0) },
  ];
  return (
    <section aria-label="Transport operations overview" className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-black text-slate-900">
            <Truck className="h-4 w-4 text-blue-700" /> Transport Operations
          </h2>
          <p className="text-[10px] text-slate-500">Current operating location · {startDate} → {endDate}</p>
        </div>
        <button type="button" onClick={() => navigate("/transport")} className="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700">
          Open Trip Register →
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {tiles.map(({ label, value, icon: Icon }) => (
          <button key={label} type="button" onClick={() => navigate("/transport")}
            className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-2 text-left hover:border-blue-300">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600">
              <Icon className="h-3.5 w-3.5 shrink-0" /> {label}
            </div>
            <div className="mt-1 text-lg font-black tabular-nums text-slate-900">{summary ? number(value || 0) : "—"}</div>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-semibold text-slate-600">
        <span>Customer rates pending: <strong>{summary ? number(summary.customer_rate_pending) : "—"}</strong></span>
        <span>Supplier rents pending: <strong>{summary ? number(summary.supplier_rent_pending) : "—"}</strong></span>
        <span>Trips without direct sales invoice link: <strong>{summary ? number(summary.trips_without_linked_sales_invoice) : "—"}</strong></span>
        <span>Trips with direct sales invoice link: <strong>{summary ? number(summary.customer_billed) : "—"}</strong></span>
      </div>
      {financial && (
        <div className="grid gap-2 sm:grid-cols-3">
          {financial.map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-200 px-3 py-2">
              <div className="text-[10px] font-semibold text-slate-500">{item.label}</div>
              <div className="text-base font-black tabular-nums">{summary?.currency || "SAR"} {number(item.value)}</div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-slate-500">
        Financial figures use posted transport contribution evidence and require both customer and supplier financial view permissions. External invoices may not have a direct trip link.
      </p>
    </section>
  );
}
