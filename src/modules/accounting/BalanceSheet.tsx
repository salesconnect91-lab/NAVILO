import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  loadDocumentPrintSettings,
  documentContactText,
  documentTaxText,
} from "@/lib/documentPrintSettings";
import { ErrorBanner, formatCurrency } from "@/components/ui";

interface BSItem {
  name: string;
  amount: number;
  parentHead?: string;
  detailType?: string;
}

interface BSSection {
  total: number;
  items: BSItem[];
}

interface BSGroup {
  head: string;
  total: number;
  items: BSItem[];
}

function getLocalToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatReportDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function normalizedDetailType(value?: string) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function balanceSheetAccountName(type: string, accountName: string, detailType?: string) {
  const detail = normalizedDetailType(detailType);
  if (type === "asset" && detail === "accountsreceivable") return "Accounts Receivable (Total)";
  if (type === "liability" && detail === "accountspayable") return "Accounts Payable (Total)";
  return accountName;
}

function professionalParentHead(type: string, accountName: string, detailType?: string, configuredHead?: string) {
  const text = normalizedDetailType(`${accountName} ${detailType ?? ""} ${configuredHead ?? ""}`);

  if (type === "asset") {
    const isNonCurrent = [
      "noncurrent",
      "fixedasset",
      "machinery",
      "equipment",
      "building",
      "land",
      "vehicle",
      "furniture",
      "accumulateddepreciation",
    ].some((keyword) => text.includes(keyword));
    return isNonCurrent ? "Non-Current Assets" : "Current Assets";
  }

  if (type === "liability") {
    const isNonCurrent = ["noncurrent", "longterm", "termloan", "deferredtax"].some((keyword) =>
      text.includes(keyword)
    );
    return isNonCurrent ? "Non-Current Liabilities" : "Current Liabilities";
  }

  return "Capital & Reserves";
}

function groupItems(items: BSItem[], preferredOrder: string[]): BSGroup[] {
  const groups = new Map<string, BSItem[]>();
  items.forEach((item) => {
    const head = item.parentHead || "Other";
    groups.set(head, [...(groups.get(head) ?? []), item]);
  });

  return Array.from(groups.entries())
    .map(([head, group]) => ({
      head,
      items: [...group].sort((a, b) => a.name.localeCompare(b.name)),
      total: group.reduce((sum, item) => sum + item.amount, 0),
    }))
    .sort((a, b) => {
      const aIndex = preferredOrder.indexOf(a.head);
      const bIndex = preferredOrder.indexOf(b.head);
      if (aIndex === -1 && bIndex === -1) return a.head.localeCompare(b.head);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
}

function StatementRows({
  title,
  groups,
  totalLabel,
  total,
}: {
  title: string;
  groups: BSGroup[];
  totalLabel: string;
  total: number;
}) {
  return (
    <>
      <tr className="bg-slate-100">
        <td colSpan={3} className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-800">
          {title}
        </td>
      </tr>
      {groups.length === 0 ? (
        <tr>
          <td colSpan={3} className="px-4 py-7 text-center text-sm text-slate-400">
            No balances found.
          </td>
        </tr>
      ) : (
        groups.map((group) => (
          <tbody key={`${title}-${group.head}`} className="contents">
            <tr className="bg-slate-50/80">
              <td className="px-4 py-2 text-xs font-semibold text-slate-700">{group.head}</td>
              <td className="px-4 py-2 text-xs text-slate-500">Subtotal</td>
              <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-slate-700">
                {formatCurrency(group.total)}
              </td>
            </tr>
            {group.items.map((item) => (
              <tr key={`${group.head}-${item.name}`}>
                <td className="px-6 py-2.5 text-sm font-medium text-slate-800">{item.name}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{item.detailType || "General"}</td>
                <td
                  className={`px-4 py-2.5 text-right font-mono text-sm font-semibold ${
                    item.amount < -0.005 ? "text-rose-700" : "text-slate-900"
                  }`}
                >
                  {formatCurrency(item.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        ))
      )}
      <tr data-report-total className="border-t-2 border-slate-700 bg-white">
        <td colSpan={2} className="px-4 py-3 text-sm font-bold text-slate-900">
          {totalLabel}
        </td>
        <td className="px-4 py-3 text-right font-mono text-sm font-bold text-slate-900">
          {formatCurrency(total)}
        </td>
      </tr>
    </>
  );
}

export default function BalanceSheet() {
  const [assets, setAssets] = useState<BSSection>({ total: 0, items: [] });
  const [liabilities, setLiabilities] = useState<BSSection>({ total: 0, items: [] });
  const [equity, setEquity] = useState<BSSection>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportPrintSettings, setReportPrintSettings] = useState<any>(null);
  const [asOfDate, setAsOfDate] = useState(getLocalToday);
  const [hideZeroBalances, setHideZeroBalances] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchBalanceSheet = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [accountsRes, ledgerRes] = await Promise.all([
      supabase
        .from("chart_of_accounts")
        .select("id, code, name, type, parent_head, detail_type, is_group, allow_manual_entries, is_active"),
      supabase
        .from("ledgers")
        .select("account_id, entry_date, debit, credit")
        .lte("entry_date", asOfDate),
    ]);

    if (accountsRes.error || ledgerRes.error) {
      setError(accountsRes.error?.message ?? ledgerRes.error?.message ?? "Unable to load balance sheet.");
      setLoading(false);
      return;
    }

    const accounts = accountsRes.data ?? [];
    const ledgerLines = ledgerRes.data ?? [];

    const accountMetaMap: Record<
      string,
      {
        name: string;
        type: string;
        parentHead: string;
        detailType: string;
        isGroup: boolean;
        allowManualEntries: boolean;
        isActive: boolean;
      }
    > = {};

    accounts.forEach((acc) => {
      const type = acc.type?.toLowerCase() || "";
      accountMetaMap[acc.id] = {
        name: acc.name,
        type,
        parentHead: professionalParentHead(
          type,
          acc.name,
          acc.detail_type,
          acc.parent_head
        ),
        detailType: acc.detail_type || "General",
        isGroup: Boolean(acc.is_group),
        allowManualEntries: Boolean(acc.allow_manual_entries),
        isActive: acc.is_active !== false,
      };
    });

    const assetMap: Record<string, { amount: number; parentHead: string; detailType: string }> = {};
    const liabilityMap: Record<string, { amount: number; parentHead: string; detailType: string }> = {};
    const equityMap: Record<string, { amount: number; parentHead: string; detailType: string }> = {};
    let totalRevenue = 0;
    let totalExpenses = 0;

    accounts.forEach((acc) => {
      const meta = accountMetaMap[acc.id];
      if (!meta) return;
      const target =
        meta.type === "asset"
          ? assetMap
          : meta.type === "liability"
            ? liabilityMap
            : meta.type === "equity"
              ? equityMap
              : null;
      const displayName = balanceSheetAccountName(meta.type, meta.name, meta.detailType);

      if (target && !meta.isGroup && meta.allowManualEntries && meta.isActive && !target[displayName]) {
        target[displayName] = {
          amount: 0,
          parentHead: meta.parentHead,
          detailType: meta.detailType,
        };
      }
    });

    ledgerLines.forEach((line) => {
      const meta = accountMetaMap[line.account_id];
      if (!meta) return;

      const type = meta.type;
      const debit = Number(line.debit ?? 0);
      const credit = Number(line.credit ?? 0);
      const accountName = balanceSheetAccountName(meta.type, meta.name, meta.detailType);

      if (type === "asset") {
        const net = debit - credit;
        if (!assetMap[accountName]) {
          assetMap[accountName] = { amount: 0, parentHead: meta.parentHead, detailType: meta.detailType };
        }
        assetMap[accountName].amount += net;
      } else if (type === "liability") {
        const net = credit - debit;
        if (!liabilityMap[accountName]) {
          liabilityMap[accountName] = { amount: 0, parentHead: meta.parentHead, detailType: meta.detailType };
        }
        liabilityMap[accountName].amount += net;
      } else if (type === "equity") {
        const net = credit - debit;
        if (!equityMap[accountName]) {
          equityMap[accountName] = { amount: 0, parentHead: meta.parentHead, detailType: meta.detailType };
        }
        equityMap[accountName].amount += net;
      } else if (type === "revenue") {
        totalRevenue += credit - debit;
      } else if (type === "expense") {
        totalExpenses += debit - credit;
      }
    });

    const currentProfitOrLoss = totalRevenue - totalExpenses;
    if (Math.abs(currentProfitOrLoss) >= 0.005) {
      equityMap["Current Profit / (Loss)"] = {
        amount: currentProfitOrLoss,
        parentHead: "Capital & Reserves",
        detailType: "Current Earnings",
      };
    }

    Object.entries(assetMap).forEach(([name, item]) => {
      const detail = normalizedDetailType(`${name} ${item.detailType ?? ""}`);
      if (item.amount < -0.005 && detail.includes("accountsreceivable")) {
        liabilityMap["Customer Advances"] = {
          amount: (liabilityMap["Customer Advances"]?.amount ?? 0) + Math.abs(item.amount),
          parentHead: "Current Liabilities",
          detailType: "Customer Credit Balances",
        };
        delete assetMap[name];
      } else if (
        item.amount < -0.005 &&
        (detail.includes("bankaccount") || detail.includes("bankbalance"))
      ) {
        liabilityMap["Bank Overdraft"] = {
          amount: (liabilityMap["Bank Overdraft"]?.amount ?? 0) + Math.abs(item.amount),
          parentHead: "Current Liabilities",
          detailType: "Bank Overdraft",
        };
        delete assetMap[name];
      }
    });

    Object.entries(liabilityMap).forEach(([name, item]) => {
      const detail = normalizedDetailType(`${name} ${item.detailType ?? ""}`);
      if (item.amount < -0.005 && detail.includes("accountspayable")) {
        assetMap["Supplier Advances"] = {
          amount: (assetMap["Supplier Advances"]?.amount ?? 0) + Math.abs(item.amount),
          parentHead: "Current Assets",
          detailType: "Supplier Debit Balances",
        };
        delete liabilityMap[name];
      }
    });

    const assetList: BSItem[] = Object.keys(assetMap)
      .map((key) => ({
        name: key,
        amount: assetMap[key].amount,
        parentHead: assetMap[key].parentHead,
        detailType: assetMap[key].detailType,
      }))
      .filter((item) => !hideZeroBalances || Math.abs(item.amount) >= 0.005);

    const liabilityList: BSItem[] = Object.keys(liabilityMap)
      .map((key) => ({
        name: key,
        amount: liabilityMap[key].amount,
        parentHead: liabilityMap[key].parentHead,
        detailType: liabilityMap[key].detailType,
      }))
      .filter((item) => !hideZeroBalances || Math.abs(item.amount) >= 0.005);

    const equityList: BSItem[] = Object.keys(equityMap)
      .map((key) => ({
        name: key,
        amount: equityMap[key].amount,
        parentHead: equityMap[key].parentHead,
        detailType: equityMap[key].detailType,
      }))
      .filter((item) => !hideZeroBalances || Math.abs(item.amount) >= 0.005);

    setAssets({ total: assetList.reduce((sum, item) => sum + item.amount, 0), items: assetList });
    setLiabilities({ total: liabilityList.reduce((sum, item) => sum + item.amount, 0), items: liabilityList });
    setEquity({ total: equityList.reduce((sum, item) => sum + item.amount, 0), items: equityList });
    setLastUpdated(new Date());
    setLoading(false);
  }, [asOfDate, hideZeroBalances]);

  useEffect(() => {
    void loadDocumentPrintSettings("reports")
      .then(setReportPrintSettings)
      .catch(() => setReportPrintSettings(null));
  }, []);

  useEffect(() => {
    void fetchBalanceSheet();
  }, [fetchBalanceSheet]);

  const totalLiabilitiesAndEquity = liabilities.total + equity.total;
  const equationDifference = assets.total - totalLiabilitiesAndEquity;
  const isBalanced = Math.abs(equationDifference) < 0.01;

  const assetGroups = useMemo(
    () => groupItems(assets.items, ["Current Assets", "Non-Current Assets"]),
    [assets.items]
  );
  const liabilityGroups = useMemo(
    () => groupItems(liabilities.items, ["Current Liabilities", "Non-Current Liabilities"]),
    [liabilities.items]
  );
  const equityGroups = useMemo(() => groupItems(equity.items, ["Capital & Reserves"]), [equity.items]);

  const negativeInventoryItems = assets.items.filter(
    (item) =>
      normalizedDetailType(`${item.name} ${item.detailType ?? ""}`).includes("inventory") &&
      item.amount < -0.005
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-12">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #printable-balance-sheet, #printable-balance-sheet * { visibility: visible; }
          #printable-balance-sheet { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div id="printable-balance-sheet" className="space-y-6">
        {reportPrintSettings && (
          <div className="hidden print:block border-b border-slate-300 pb-4 text-center">
            {reportPrintSettings.visibility.show_logo && reportPrintSettings.company.logo_url && (
              <img
                src={reportPrintSettings.company.logo_url}
                alt="Company Logo"
                className="mx-auto mb-2 max-h-16 max-w-40 object-contain"
              />
            )}
            {reportPrintSettings.visibility.show_company_name && (
              <div className="text-xl font-bold">{reportPrintSettings.company.company_name}</div>
            )}
            {reportPrintSettings.visibility.show_address && reportPrintSettings.company.address && (
              <div className="mt-1 text-xs">{reportPrintSettings.company.address}</div>
            )}
            {reportPrintSettings.visibility.show_phone_email && documentContactText(reportPrintSettings.company) && (
              <div className="mt-1 text-xs">{documentContactText(reportPrintSettings.company)}</div>
            )}
            {reportPrintSettings.visibility.show_tax_details && documentTaxText(reportPrintSettings.company) && (
              <div className="mt-1 text-xs">{documentTaxText(reportPrintSettings.company)}</div>
            )}
          </div>
        )}

        <header className="flex flex-col items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Balance Sheet / بیلنس شیٹ</h1>
            <p className="mt-1 text-sm text-slate-500">Financial position from posted ledgers</p>
            <p className="mt-1 text-xs text-slate-400">As of {formatReportDate(asOfDate)}</p>
          </div>
          <div className="no-print flex items-center gap-2">
            <button
              type="button"
              data-navilo-keep-local-action="true"
              onClick={() => void fetchBalanceSheet()}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh / تازہ کریں
            </button>
          </div>
        </header>

        {error && <ErrorBanner message={error} />}

        <div data-report-filters className="no-print rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[260px_1fr_auto] lg:items-end">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">As-of Date</span>
              <input
                type="date"
                value={asOfDate}
                max={getLocalToday()}
                onChange={(event) => setAsOfDate(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <label className="flex h-10 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3">
              <input
                type="checkbox"
                checked={hideZeroBalances}
                onChange={(event) => setHideZeroBalances(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-800">Hide zero-balance accounts / صفر بیلنس اکاؤنٹس چھپائیں</span>
            </label>

            <div className="text-left text-xs text-slate-500 lg:text-right">
              <div>Posted entries through selected date</div>
              {lastUpdated && <div>Updated {lastUpdated.toLocaleTimeString()}</div>}
            </div>
          </div>
        </div>

        {negativeInventoryItems.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="font-semibold">Inventory warning:</span>{" "}
            {negativeInventoryItems.map((item) => item.name).join(", ")} has a negative balance. Review stock posting and valuation entries.
          </div>
        )}

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-slate-400 shadow-sm">
            Loading Balance Sheet...
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-bold text-slate-900">Statement of Financial Position</div>
                <div className="mt-0.5 text-xs text-slate-500">As of {formatReportDate(asOfDate)}</div>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-500">Accounting equation</span>
                <span className={`rounded-full px-2.5 py-1 font-semibold ${isBalanced ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                  {isBalanced ? "Balanced" : "Out of Balance"}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-white text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="border-b border-slate-200 px-4 py-3 font-semibold">Account</th>
                    <th className="border-b border-slate-200 px-4 py-3 font-semibold">Classification</th>
                    <th className="border-b border-slate-200 px-4 py-3 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <StatementRows title="Assets / اثاثے" groups={assetGroups} totalLabel="Total Assets" total={assets.total} />
                  <StatementRows title="Liabilities / واجبات" groups={liabilityGroups} totalLabel="Total Liabilities" total={liabilities.total} />
                  <StatementRows title="Equity / سرمایہ" groups={equityGroups} totalLabel="Total Equity" total={equity.total} />
                  <tr data-report-total className="border-t-2 border-slate-900 bg-slate-50">
                    <td colSpan={2} className="px-4 py-3.5 text-sm font-bold text-slate-900">Total Liabilities & Equity</td>
                    <td className="px-4 py-3.5 text-right font-mono text-sm font-bold text-slate-900">
                      {formatCurrency(totalLiabilitiesAndEquity)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className={`flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${isBalanced ? "border-emerald-200 bg-emerald-50/60" : "border-rose-200 bg-rose-50/70"}`}>
              <div>
                <div className="text-sm font-semibold text-slate-900">Accounting Equation Check</div>
                <div className="mt-0.5 text-xs text-slate-500">Total Assets = Total Liabilities + Equity</div>
              </div>
              <div className="text-left sm:text-right">
                <div className="font-mono text-sm font-bold text-slate-900">Difference {formatCurrency(equationDifference)}</div>
                <div className={`mt-0.5 text-xs font-semibold ${isBalanced ? "text-emerald-700" : "text-rose-700"}`}>
                  {isBalanced ? "Balanced" : "Review required"}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {reportPrintSettings && (
        <div className="hidden print:block mt-8 border-t border-slate-300 pt-3 text-xs text-slate-500">
          {reportPrintSettings.visibility.show_footer &&
            (reportPrintSettings.company.document_footer || reportPrintSettings.company.document_footer_urdu) && (
              <div className="text-center">
                {reportPrintSettings.company.document_footer}
                {reportPrintSettings.company.document_footer_urdu && <div>{reportPrintSettings.company.document_footer_urdu}</div>}
              </div>
            )}
          {reportPrintSettings.visibility.show_signatures && (
            <div className="mt-10 flex justify-between text-slate-700">
              <span>{reportPrintSettings.company.prepared_by_label || "Prepared By"}</span>
              <span>{reportPrintSettings.company.checked_by_label || "Checked By"}</span>
              <span>{reportPrintSettings.company.approved_by_label || "Approved By"}</span>
            </div>
          )}
          {reportPrintSettings.visibility.show_print_datetime && (
            <div className="mt-4">Printed: {new Date().toLocaleString("en-PK")}</div>
          )}
        </div>
      )}
    </div>
  );
}
