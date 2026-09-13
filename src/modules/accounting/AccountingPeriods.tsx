import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Lock, LockOpen } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ErrorBanner, LoadingState, PageHeader, formatDate } from "@/components/ui";

interface AccountingPeriod {
  id: string;
  period_name: string;
  period_start: string;
  period_end: string;
  status: "open" | "closed";
  closed_at: string | null;
}

export default function AccountingPeriods() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadPeriods = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("accounting_periods")
      .select("id,period_name,period_start,period_end,status,closed_at")
      .gte("period_start", `${year}-01-01`)
      .lte("period_end", `${year}-12-31`)
      .order("period_start");
    if (fetchError) setError(fetchError.message);
    setPeriods((data ?? []) as AccountingPeriod[]);
    setLoading(false);
  }, [year]);

  useEffect(() => { void loadPeriods(); }, [loadPeriods]);

  const summary = useMemo(() => ({
    open: periods.filter((period) => period.status === "open").length,
    closed: periods.filter((period) => period.status === "closed").length,
  }), [periods]);

  async function initializeYear() {
    setSavingId("year"); setError(""); setSuccess("");
    const { data, error: rpcError } = await supabase.rpc("initialize_accounting_year", { p_year: year });
    if (rpcError) setError(rpcError.message);
    else {
      setSuccess(`${Number(data?.periods_created ?? 0)} monthly periods created for ${year}.`);
      await loadPeriods();
    }
    setSavingId(null);
  }

  async function changeStatus(period: AccountingPeriod) {
    const nextStatus = period.status === "open" ? "closed" : "open";
    const action = nextStatus === "closed" ? "close" : "reopen";
    if (!window.confirm(`Are you sure you want to ${action} ${period.period_name}?`)) return;
    setSavingId(period.id); setError(""); setSuccess("");
    const { error: rpcError } = await supabase.rpc("set_accounting_period_status", {
      p_period_id: period.id,
      p_status: nextStatus,
    });
    if (rpcError) setError(rpcError.message);
    else {
      setSuccess(`${period.period_name} is now ${nextStatus}.`);
      await loadPeriods();
    }
    setSavingId(null);
  }

  return (
    <div className="navilo-closing-workflow space-y-4">
      <PageHeader
        title="Accounting Periods / اکاؤنٹنگ پیریڈز"
        subtitle="Close finalized months to prevent backdated accounting postings."
        action={
          <div className="flex items-center gap-2">
            <input className="input w-28" type="number" min="2000" max="2200" value={year} onChange={(event) => setYear(Number(event.target.value))} />
            <button className="btn-primary" disabled={savingId !== null} onClick={() => void initializeYear()}>
              <CalendarRange size={16} /> {savingId === "year" ? "Creating…" : "Create Year"}
            </button>
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}
      {success && <div className="navilo-status-success">{success}</div>}

      <div className="navilo-closing-summary-grid">
        <div className="navilo-summary-tile"><p>Year</p><strong>{year}</strong></div>
        <div className="navilo-summary-tile"><p>Open Months</p><strong>{summary.open}</strong></div>
        <div className="navilo-summary-tile"><p>Closed Months</p><strong>{summary.closed}</strong></div>
      </div>

      <div className="navilo-closing-note">
        Closing a month blocks new Sale, Purchase, Receipt, Payment and Journal postings dated inside that month. Existing posted records remain unchanged.
      </div>

      {loading ? <LoadingState /> : periods.length === 0 ? (
        <div className="navilo-workflow-panel p-10 text-center text-slate-500">No periods exist for {year}. Click Create Year to initialize all 12 months.</div>
      ) : (
        <div className="navilo-workflow-panel overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="navilo-closing-table w-full text-sm">
              <thead><tr><th>Period</th><th>Start</th><th>End</th><th>Status</th><th className="text-right">Action</th></tr></thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.id}>
                    <td className="font-semibold text-slate-900">{period.period_name}</td>
                    <td>{formatDate(period.period_start)}</td>
                    <td>{formatDate(period.period_end)}</td>
                    <td><span className={`navilo-status-pill ${period.status === "closed" ? "is-closed" : "is-open"}`}>{period.status === "closed" ? "Closed" : "Open"}</span></td>
                    <td className="text-right"><button className={period.status === "closed" ? "btn-secondary" : "btn-primary"} disabled={savingId !== null} onClick={() => void changeStatus(period)}>{period.status === "closed" ? <LockOpen size={15} /> : <Lock size={15} />}{savingId === period.id ? "Saving…" : period.status === "closed" ? "Reopen" : "Close"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
