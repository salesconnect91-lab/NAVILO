import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  documentContactText,
  documentTaxText,
  loadDocumentPrintSettings,
} from "@/lib/documentPrintSettings";
import { ErrorBanner, formatCurrency } from "@/components/ui";
import { fetchAllPages, fetchByIdChunks } from "@/lib/fetchAllPages";

type PLBucket =
  | "operatingRevenue"
  | "otherIncome"
  | "costOfSales"
  | "operatingExpenses"
  | "otherExpenses";

type PLItem = { name: string; amount: number; detailType: string };
type PLSectionData = { total: number; items: PLItem[] };
type PLData = Record<PLBucket, PLSectionData>;

type AccountRow = {
  id: string;
  code: string | null;
  name: string | null;
  type: string | null;
  parent_head: string | null;
  detail_type: string | null;
  is_group: boolean | null;
  allow_manual_entries: boolean | null;
  is_active: boolean | null;
};

type LedgerRow = {
  account_id: string | null;
  journal_entry_id: string | null;
  entry_date: string;
  debit: number | string | null;
  credit: number | string | null;
};

type JournalMeta = {
  id: string;
  trans_type: string | null;
  fiscal_year_closure_id: string | null;
};

const emptySection = (): PLSectionData => ({ total: 0, items: [] });
const emptyPLData = (): PLData => ({
  operatingRevenue: emptySection(),
  otherIncome: emptySection(),
  costOfSales: emptySection(),
  operatingExpenses: emptySection(),
  otherExpenses: emptySection(),
});

function localDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const getLocalToday = () => localDateValue(new Date());
const getYearStart = () => {
  const today = new Date();
  return localDateValue(new Date(today.getFullYear(), 0, 1));
};

function formatReportDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function normalized(value?: string) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function classifyAccount(type: string, name: string, parentHead?: string, detailType?: string): PLBucket | null {
  const text = normalized(`${name} ${parentHead ?? ""} ${detailType ?? ""}`);
  if (type === "revenue" || type === "income") {
    return ["otherincome", "interestincome", "financeincome", "gainon", "miscellaneousincome"].some((key) => text.includes(key))
      ? "otherIncome"
      : "operatingRevenue";
  }
  if (type === "expense") {
    if (["costofgoodssold", "costofsales", "cogs", "directcost", "materialconsumption", "manufacturingcost", "productioncost"].some((key) => text.includes(key))) {
      return "costOfSales";
    }
    return ["financecost", "interestexpense", "bankcharges", "losson", "otherexpense", "taxexpense"].some((key) => text.includes(key))
      ? "otherExpenses"
      : "operatingExpenses";
  }
  return null;
}

function StatementSection({ title, section, tone }: { title: string; section: PLSectionData; tone: "income" | "expense" }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-slate-700">{title}</h3>
        <span className={`font-mono text-sm font-bold ${tone === "income" ? "text-emerald-700" : "text-rose-700"}`}>
          {formatCurrency(section.total)}
        </span>
      </div>
      {section.items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-slate-400">No balances for this period.</div>
      ) : (
        <div className="divide-y divide-slate-100 px-4">
          {section.items.map((item) => (
            <div key={item.name} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <div className="min-w-0">
                <span className="block truncate font-medium text-slate-800">{item.name}</span>
                <span className="block text-[12px] text-slate-400">{item.detailType}</span>
              </div>
              <span className={`shrink-0 font-mono font-semibold ${item.amount < 0 ? "text-rose-600" : "text-slate-900"}`}>
                {formatCurrency(item.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ResultRow({ label, amount, prominent = false }: { label: string; amount: number; prominent?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${prominent ? (amount >= 0 ? "border-emerald-400 bg-slate-900 text-white" : "border-rose-400 bg-rose-950 text-white") : "border-slate-300 bg-slate-100 text-slate-900"}`}>
      <span className="text-sm font-bold uppercase tracking-wide">{label}</span>
      <span className="font-mono text-lg font-bold">{formatCurrency(amount)}</span>
    </div>
  );
}

export default function ProfitLoss() {
  const [data, setData] = useState<PLData>(emptyPLData);
  const [fromDate, setFromDate] = useState(getYearStart);
  const [toDate, setToDate] = useState(getLocalToday);
  const [hideZeroBalances, setHideZeroBalances] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportPrintSettings, setReportPrintSettings] = useState<any>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchPL = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (fromDate > toDate) {
      setError("From date cannot be after To date.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    let accounts: AccountRow[] = [];
    let rawLedger: LedgerRow[] = [];

    try {
      [accounts, rawLedger] = await Promise.all([
        fetchAllPages<AccountRow>((fromRow,toRow) =>
          supabase
            .from("chart_of_accounts")
            .select("id,code,name,type,parent_head,detail_type,is_group,allow_manual_entries,is_active")
            .order("id",{ascending:true})
            .range(fromRow,toRow)
        ),
        fetchAllPages<LedgerRow>((fromRow,toRow) =>
          supabase
            .from("ledgers")
            .select("account_id,journal_entry_id,entry_date,debit,credit")
            .gte("entry_date",fromDate)
            .lte("entry_date",toDate)
            .order("entry_date",{ascending:true})
            .order("journal_entry_id",{ascending:true})
            .order("account_id",{ascending:true})
            .range(fromRow,toRow)
        ),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Profit & Loss statement.");
      setLoading(false);
      return;
    }

    const journalIds = Array.from(new Set(rawLedger.map((line) => line.journal_entry_id).filter(Boolean))) as string[];

    let closingJournalIds = new Set<string>();
    if (journalIds.length) {
      let journalRows: JournalMeta[] = [];
      try {
        journalRows = await fetchByIdChunks<JournalMeta>(
          journalIds,
          (ids,fromRow,toRow) =>
            supabase
              .from("journal_entries")
              .select("id,trans_type,fiscal_year_closure_id")
              .in("id",ids)
              .order("id",{ascending:true})
              .range(fromRow,toRow)
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load journal metadata.");
        setLoading(false);
        return;
      }
      closingJournalIds = new Set(
        journalRows
          .filter((entry) => entry.trans_type === "Year End Closing" || Boolean(entry.fiscal_year_closure_id))
          .map((entry) => entry.id)
      );
    }

    // Year-end closing journals transfer annual profit/loss to Retained Earnings.
    // They belong in the General Ledger and Balance Sheet, but NOT in the historical
    // P&L itself, otherwise a closed year would incorrectly show zero profit/loss.
    const ledgerLines = rawLedger.filter((line) => !line.journal_entry_id || !closingJournalIds.has(line.journal_entry_id));

    const accountMap = new Map<string, {
      name: string;
      type: string;
      detailType: string;
      bucket: PLBucket | null;
      isGroup: boolean;
      allowManualEntries: boolean;
      isActive: boolean;
    }>();

    accounts.forEach((account) => {
      const type = String(account.type ?? "").toLowerCase();
      const name = `${account.code ?? ""} - ${account.name ?? ""}`.trim();
      const detailType = account.detail_type || "General";
      accountMap.set(account.id, {
        name,
        type,
        detailType,
        bucket: classifyAccount(type, name, account.parent_head || "General", detailType),
        isGroup: Boolean(account.is_group),
        allowManualEntries: Boolean(account.allow_manual_entries),
        isActive: account.is_active !== false,
      });
    });

    const bucketMaps: Record<PLBucket, Map<string, PLItem>> = {
      operatingRevenue: new Map(),
      otherIncome: new Map(),
      costOfSales: new Map(),
      operatingExpenses: new Map(),
      otherExpenses: new Map(),
    };

    if (!hideZeroBalances) {
      accountMap.forEach((account) => {
        if (account.bucket && !account.isGroup && account.allowManualEntries && account.isActive) {
          bucketMaps[account.bucket].set(account.name, { name: account.name, amount: 0, detailType: account.detailType });
        }
      });
    }

    ledgerLines.forEach((line) => {
      if (!line.account_id) return;
      const account = accountMap.get(line.account_id);
      if (!account?.bucket) return;
      const debit = Number(line.debit ?? 0);
      const credit = Number(line.credit ?? 0);
      const movement = account.type === "revenue" || account.type === "income" ? credit - debit : debit - credit;
      const current = bucketMaps[account.bucket].get(account.name);
      bucketMaps[account.bucket].set(account.name, {
        name: account.name,
        amount: (current?.amount ?? 0) + movement,
        detailType: account.detailType,
      });
    });

    const next = emptyPLData();
    (Object.keys(bucketMaps) as PLBucket[]).forEach((bucket) => {
      const items = Array.from(bucketMaps[bucket].values())
        .filter((item) => !hideZeroBalances || Math.abs(item.amount) >= 0.005)
        .sort((a, b) => a.name.localeCompare(b.name));
      next[bucket] = { items, total: items.reduce((sum, item) => sum + item.amount, 0) };
    });

    setData(next);
    setLastUpdated(new Date());
    setLoading(false);
  }, [fromDate, toDate, hideZeroBalances]);

  useEffect(() => {
    void loadDocumentPrintSettings("reports").then(setReportPrintSettings).catch(() => setReportPrintSettings(null));
  }, []);

  useEffect(() => { void fetchPL(); }, [fetchPL]);

  const metrics = useMemo(() => {
    const grossProfit = data.operatingRevenue.total - data.costOfSales.total;
    const operatingProfit = grossProfit - data.operatingExpenses.total;
    const netProfit = operatingProfit + data.otherIncome.total - data.otherExpenses.total;
    const totalIncome = data.operatingRevenue.total + data.otherIncome.total;
    const totalExpenses = data.costOfSales.total + data.operatingExpenses.total + data.otherExpenses.total;
    return {
      grossProfit,
      operatingProfit,
      netProfit,
      totalIncome,
      totalExpenses,
      netMargin: totalIncome === 0 ? 0 : (netProfit / totalIncome) * 100,
    };
  }, [data]);

  const setThisMonth = () => {
    const today = new Date();
    setFromDate(localDateValue(new Date(today.getFullYear(), today.getMonth(), 1)));
    setToDate(localDateValue(today));
  };

  const setThisYear = () => {
    setFromDate(getYearStart());
    setToDate(getLocalToday());
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <style>{`@media print{body *{visibility:hidden}#printable-profit-loss,#printable-profit-loss *{visibility:visible}#printable-profit-loss{position:absolute;left:0;top:0;width:100%}.no-print{display:none!important}}`}</style>

      <div id="printable-profit-loss" className="space-y-6">
        {reportPrintSettings && (
          <div className="hidden border-b border-slate-300 pb-4 text-center print:block">
            {reportPrintSettings.visibility.show_logo && reportPrintSettings.company.logo_url && <img src={reportPrintSettings.company.logo_url} alt="Company Logo" className="mx-auto mb-2 max-h-16 max-w-40 object-contain" />}
            {reportPrintSettings.visibility.show_company_name && <div className="text-xl font-bold">{reportPrintSettings.company.company_name}</div>}
            {reportPrintSettings.visibility.show_address && reportPrintSettings.company.address && <div className="mt-1 text-xs">{reportPrintSettings.company.address}</div>}
            {reportPrintSettings.visibility.show_phone_email && documentContactText(reportPrintSettings.company) && <div className="mt-1 text-xs">{documentContactText(reportPrintSettings.company)}</div>}
            {reportPrintSettings.visibility.show_tax_details && documentTaxText(reportPrintSettings.company) && <div className="mt-1 text-xs">{documentTaxText(reportPrintSettings.company)}</div>}
          </div>
        )}

        <header className="flex flex-col items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Profit & Loss Statement</h1>
            <p className="mt-1 text-sm text-slate-500">For the period {formatReportDate(fromDate)} to {formatReportDate(toDate)}</p>
            <p className="mt-1 text-xs text-slate-400">Year-end closing journals are excluded from P&L presentation.</p>
          </div>
          <button type="button" onClick={() => void fetchPL()} disabled={loading} className="no-print flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </header>

        {error && <ErrorBanner message={error} />}

        <div className="no-print rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-report-filters>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1.35fr_auto] lg:items-end">
            <label><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">From Date</span><input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
            <label><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">To Date</span><input type="date" value={toDate} min={fromDate} max={getLocalToday()} onChange={(e) => setToDate(e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
            <label className="flex h-10 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3"><input type="checkbox" checked={hideZeroBalances} onChange={(e) => setHideZeroBalances(e.target.checked)} className="h-4 w-4" /><span className="text-sm font-medium text-slate-800">Hide zero-balance accounts</span></label>
            <div className="flex gap-2"><button type="button" onClick={setThisMonth} className="h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">This Month</button><button type="button" onClick={setThisYear} className="h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">This Year</button></div>
          </div>
          {lastUpdated && <div className="mt-2 text-right text-[12px] text-slate-400">Posted operational ledger entries only ┬╖ Updated {lastUpdated.toLocaleTimeString()}</div>}
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-slate-400 shadow-sm">Loading Profit & Loss statement...</div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {([
                ["Revenue", data.operatingRevenue.total, "text-emerald-700"],
                ["Cost of Sales", data.costOfSales.total, "text-rose-700"],
                ["Gross Profit", metrics.grossProfit, metrics.grossProfit >= 0 ? "text-emerald-700" : "text-rose-700"],
                ["Operating Expenses", data.operatingExpenses.total, "text-rose-700"],
                ["Net Profit / Loss", metrics.netProfit, metrics.netProfit >= 0 ? "text-blue-700" : "text-rose-700"],
              ] as Array<[string, number, string]>).map(([label, value, tone]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><span className="block text-[12px] font-bold uppercase tracking-wide text-slate-500">{label}</span><span className={`mt-1 block font-mono text-base font-bold ${tone}`}>{formatCurrency(value)}</span></div>
              ))}
            </div>

            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <StatementSection title="Operating Revenue" section={data.operatingRevenue} tone="income" />
              <StatementSection title="Less: Cost of Sales" section={data.costOfSales} tone="expense" />
              <ResultRow label="Gross Profit / (Loss)" amount={metrics.grossProfit} />
              <StatementSection title="Operating Expenses" section={data.operatingExpenses} tone="expense" />
              <ResultRow label="Operating Profit / (Loss)" amount={metrics.operatingProfit} />
              {(data.otherIncome.items.length > 0 || !hideZeroBalances) && <StatementSection title="Other Income" section={data.otherIncome} tone="income" />}
              {(data.otherExpenses.items.length > 0 || !hideZeroBalances) && <StatementSection title="Other Expenses" section={data.otherExpenses} tone="expense" />}
              <ResultRow label="Net Profit / (Loss)" amount={metrics.netProfit} prominent />
              <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-3" data-report-total>
                <div><span className="block text-xs text-slate-500">Total Income</span><span className="font-mono font-bold text-emerald-700">{formatCurrency(metrics.totalIncome)}</span></div>
                <div><span className="block text-xs text-slate-500">Total Expenses</span><span className="font-mono font-bold text-rose-700">{formatCurrency(metrics.totalExpenses)}</span></div>
                <div><span className="block text-xs text-slate-500">Net Margin</span><span className={`font-mono font-bold ${metrics.netMargin >= 0 ? "text-blue-700" : "text-rose-700"}`}>{metrics.netMargin.toFixed(2)}%</span></div>
              </div>
            </div>
          </>
        )}
      </div>

      {reportPrintSettings && (
        <div className="mt-8 hidden border-t border-slate-300 pt-3 text-xs text-slate-500 print:block">
          {reportPrintSettings.visibility.show_footer && reportPrintSettings.company.document_footer && <div className="text-center">{reportPrintSettings.company.document_footer}</div>}
          {reportPrintSettings.visibility.show_signatures && <div className="mt-10 flex justify-between text-slate-700"><span>{reportPrintSettings.company.prepared_by_label || "Prepared By"}</span><span>{reportPrintSettings.company.checked_by_label || "Checked By"}</span><span>{reportPrintSettings.company.approved_by_label || "Approved By"}</span></div>}
          {reportPrintSettings.visibility.show_print_datetime && <div className="mt-4">Printed: {new Date().toLocaleString("en-PK")}</div>}
        </div>
      )}
    </div>
  );
}
