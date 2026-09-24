import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  loadDocumentPrintSettings,
  documentContactText,
  documentTaxText,
} from "@/lib/documentPrintSettings";
import { ErrorBanner, formatCurrency } from "@/components/ui";
import { FileSpreadsheet, Printer, RefreshCw } from "lucide-react";
import { downloadAccountingReportPdf } from "@/lib/accountingReportPdf";

interface TrialBalanceRow {
  id: string;
  code: string;
  name: string;
  type: string;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
}

interface Totals {
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
}

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLocalToday() {
  return localDateValue(new Date());
}

function getYearStart() {
  const today = new Date();
  return localDateValue(new Date(today.getFullYear(), 0, 1));
}

function formatReportDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function splitBalance(value: number) {
  if (value > 0.004) return { debit: value, credit: 0 };
  if (value < -0.004) return { debit: 0, credit: Math.abs(value) };
  return { debit: 0, credit: 0 };
}

function emptyTotals(): Totals {
  return {
    openingDebit: 0,
    openingCredit: 0,
    periodDebit: 0,
    periodCredit: 0,
    closingDebit: 0,
    closingCredit: 0,
  };
}

export default function TrialBalance() {
  const [rows, setRows] = useState<TrialBalanceRow[]>([]);
  const [fromDate, setFromDate] = useState(getYearStart);
  const [toDate, setToDate] = useState(getLocalToday);
  const [hideZeroBalances, setHideZeroBalances] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportPrintSettings, setReportPrintSettings] = useState<any>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchTrialBalance = useCallback(async () => {
    if (!fromDate || !toDate) return;

    if (fromDate > toDate) {
      setError("From date cannot be after To date.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const [accountsRes, ledgerRes] = await Promise.all([
      supabase
        .from("chart_of_accounts")
        .select(
          "id, code, name, type, is_group, allow_manual_entries, is_active"
        )
        .order("code"),
      supabase
        .from("ledgers")
        .select("account_id, entry_date, debit, credit")
        .lte("entry_date", toDate),
    ]);

    if (accountsRes.error || ledgerRes.error) {
      setError(
        accountsRes.error?.message ??
          ledgerRes.error?.message ??
          "Unable to load Trial Balance."
      );
      setLoading(false);
      return;
    }

    const accounts = accountsRes.data ?? [];
    const ledgerLines = ledgerRes.data ?? [];
    const movementMap = new Map<
      string,
      {
        openingDebit: number;
        openingCredit: number;
        periodDebit: number;
        periodCredit: number;
      }
    >();

    ledgerLines.forEach((line) => {
      if (!line.account_id) return;

      const current = movementMap.get(line.account_id) ?? {
        openingDebit: 0,
        openingCredit: 0,
        periodDebit: 0,
        periodCredit: 0,
      };
      const debit = Number(line.debit ?? 0);
      const credit = Number(line.credit ?? 0);

      if (line.entry_date < fromDate) {
        current.openingDebit += debit;
        current.openingCredit += credit;
      } else {
        current.periodDebit += debit;
        current.periodCredit += credit;
      }

      movementMap.set(line.account_id, current);
    });

    const nextRows: TrialBalanceRow[] = accounts
      .map((account) => {
        const movement = movementMap.get(account.id) ?? {
          openingDebit: 0,
          openingCredit: 0,
          periodDebit: 0,
          periodCredit: 0,
        };
        const opening = splitBalance(
          movement.openingDebit - movement.openingCredit
        );
        const closing = splitBalance(
          movement.openingDebit -
            movement.openingCredit +
            movement.periodDebit -
            movement.periodCredit
        );

        return {
          id: account.id,
          code: String(account.code ?? ""),
          name: String(account.name ?? ""),
          type: String(account.type ?? "").toLowerCase(),
          openingDebit: opening.debit,
          openingCredit: opening.credit,
          periodDebit: movement.periodDebit,
          periodCredit: movement.periodCredit,
          closingDebit: closing.debit,
          closingCredit: closing.credit,
          isGroup: Boolean(account.is_group),
          allowManualEntries: Boolean(account.allow_manual_entries),
          isActive: account.is_active !== false,
        };
      })
      .filter((row) => {
        const hasMovement =
          Math.abs(row.openingDebit) >= 0.005 ||
          Math.abs(row.openingCredit) >= 0.005 ||
          Math.abs(row.periodDebit) >= 0.005 ||
          Math.abs(row.periodCredit) >= 0.005 ||
          Math.abs(row.closingDebit) >= 0.005 ||
          Math.abs(row.closingCredit) >= 0.005;

        if (hasMovement) return true;

        return (
          !hideZeroBalances &&
          !row.isGroup &&
          row.allowManualEntries &&
          row.isActive
        );
      })
      .map(({ isGroup: _isGroup, allowManualEntries: _allow, isActive: _active, ...row }) => row)
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

    setRows(nextRows);
    setLastUpdated(new Date());
    setLoading(false);
  }, [fromDate, toDate, hideZeroBalances]);

  useEffect(() => {
    void loadDocumentPrintSettings("reports")
      .then(setReportPrintSettings)
      .catch(() => setReportPrintSettings(null));
  }, []);

  useEffect(() => {
    fetchTrialBalance();
  }, [fetchTrialBalance]);

  const totals = useMemo(
    () =>
      rows.reduce<Totals>((sum, row) => {
        sum.openingDebit += row.openingDebit;
        sum.openingCredit += row.openingCredit;
        sum.periodDebit += row.periodDebit;
        sum.periodCredit += row.periodCredit;
        sum.closingDebit += row.closingDebit;
        sum.closingCredit += row.closingCredit;
        return sum;
      }, emptyTotals()),
    [rows]
  );

  const openingDifference = totals.openingDebit - totals.openingCredit;
  const periodDifference = totals.periodDebit - totals.periodCredit;
  const closingDifference = totals.closingDebit - totals.closingCredit;
  const isBalanced = Math.abs(closingDifference) < 0.01;

  const setThisMonth = () => {
    const today = new Date();
    setFromDate(localDateValue(new Date(today.getFullYear(), today.getMonth(), 1)));
    setToDate(localDateValue(today));
  };

  const setThisYear = () => {
    setFromDate(getYearStart());
    setToDate(getLocalToday());
  };

  const handleExportExcel = () => {
    const csvRows = [
      `"Trial Balance Period","${formatReportDate(fromDate)} to ${formatReportDate(toDate)}"`,
      `"Closing Status","${isBalanced ? "Balanced" : "Out of Balance"}"`,
      `"Closing Difference","${closingDifference.toFixed(2)}"`,
      "",
      "Account Code,Account Name,Type,Opening Debit,Opening Credit,Period Debit,Period Credit,Closing Debit,Closing Credit",
    ];

    rows.forEach((row) => {
      csvRows.push(
        `"${row.code}","${row.name}","${row.type}",${row.openingDebit},${row.openingCredit},${row.periodDebit},${row.periodCredit},${row.closingDebit},${row.closingCredit}`
      );
    });

    csvRows.push(
      `"TOTAL","","",${totals.openingDebit},${totals.openingCredit},${totals.periodDebit},${totals.periodCredit},${totals.closingDebit},${totals.closingCredit}`
    );

    const link = document.createElement("a");
    link.href = encodeURI(`data:text/csv;charset=utf-8,${csvRows.join("\r\n")}`);
    link.download = `Trial_Balance_${fromDate}_to_${toDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePdf = async () => {
    try {
      await downloadAccountingReportPdf({
        fileName: `Trial_Balance_${fromDate}_to_${toDate}.pdf`,
        title: "Trial Balance",
        subtitle: `${formatReportDate(fromDate)} to ${formatReportDate(toDate)}`,
        columns: [
          "Code",
          "Account",
          "Type",
          "Opening Dr",
          "Opening Cr",
          "Period Dr",
          "Period Cr",
          "Closing Dr",
          "Closing Cr",
        ],
        rows: rows.map((row) => [
          row.code,
          row.name,
          row.type,
          row.openingDebit.toFixed(2),
          row.openingCredit.toFixed(2),
          row.periodDebit.toFixed(2),
          row.periodCredit.toFixed(2),
          row.closingDebit.toFixed(2),
          row.closingCredit.toFixed(2),
        ]),
        summaryRows: [
          ["Opening Debit", totals.openingDebit.toFixed(2)],
          ["Opening Credit", totals.openingCredit.toFixed(2)],
          ["Period Debit", totals.periodDebit.toFixed(2)],
          ["Period Credit", totals.periodCredit.toFixed(2)],
          ["Closing Debit", totals.closingDebit.toFixed(2)],
          ["Closing Credit", totals.closingCredit.toFixed(2)],
          ["Status", isBalanced ? "Balanced" : "Out of Balance"],
          ["Difference", closingDifference.toFixed(2)],
        ],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create Trial Balance PDF.");
    }
  };

  const amountCell = (amount: number) =>
    Math.abs(amount) >= 0.005 ? formatCurrency(amount) : "—";

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-12">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #printable-trial-balance, #printable-trial-balance * { visibility: visible; }
          #printable-trial-balance {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      <div id="printable-trial-balance" className="space-y-6">
        {reportPrintSettings && (
          <div className="hidden print:block border-b border-slate-300 pb-4 text-center">
            {reportPrintSettings.visibility.show_logo &&
              reportPrintSettings.company.logo_url && (
                <img
                  src={reportPrintSettings.company.logo_url}
                  alt="Company Logo"
                  className="mx-auto mb-2 max-h-16 max-w-40 object-contain"
                />
              )}

            {reportPrintSettings.visibility.show_company_name && (
              <div className="text-xl font-bold">
                {reportPrintSettings.company.company_name}
              </div>
            )}

            {reportPrintSettings.visibility.show_address &&
              reportPrintSettings.company.address && (
                <div className="mt-1 text-xs">
                  {reportPrintSettings.company.address}
                </div>
              )}

            {reportPrintSettings.visibility.show_phone_email &&
              documentContactText(reportPrintSettings.company) && (
                <div className="mt-1 text-xs">
                  {documentContactText(reportPrintSettings.company)}
                </div>
              )}

            {reportPrintSettings.visibility.show_tax_details &&
              documentTaxText(reportPrintSettings.company) && (
                <div className="mt-1 text-xs">
                  {documentTaxText(reportPrintSettings.company)}
                </div>
              )}

            {reportPrintSettings.visibility.show_header &&
              (reportPrintSettings.company.document_header ||
                reportPrintSettings.company.document_header_urdu) && (
                <div className="mt-2 text-xs font-medium">
                  {reportPrintSettings.company.document_header}
                  {reportPrintSettings.company.document_header_urdu && (
                    <div>{reportPrintSettings.company.document_header_urdu}</div>
                  )}
                </div>
              )}
          </div>
        )}
        <header className="flex flex-col items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Trial Balance</h1>
            <p className="mt-1 text-sm text-slate-500">
              Opening, period movement and closing balances from posted ledgers
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {formatReportDate(fromDate)} to {formatReportDate(toDate)}
            </p>
          </div>

          <div className="no-print flex items-center gap-2">
            <button
              type="button"
              onClick={fetchTrialBalance}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <FileSpreadsheet className="h-4 w-4" /> Export Excel
            </button>
            <button
              type="button"
              onClick={() => void handlePdf()}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              PDF
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
            >
              <Printer className="h-4 w-4" />Print</button>
          </div>
        </header>

        {error && <ErrorBanner message={error} />}

        <div className="no-print rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1.35fr_auto] lg:items-end">
            <label>
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                From Date
              </span>
              <input
                type="date"
                value={fromDate}
                max={toDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <label>
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                To Date
              </span>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                max={getLocalToday()}
                onChange={(event) => setToDate(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <label className="flex h-10 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3">
              <input
                type="checkbox"
                checked={hideZeroBalances}
                onChange={(event) => setHideZeroBalances(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span className="text-sm font-medium text-slate-800">
                Hide zero-balance accounts
              </span>
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={setThisMonth}
                className="h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                This Month
              </button>
              <button
                type="button"
                onClick={setThisYear}
                className="h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                This Year
              </button>
            </div>
          </div>
          {lastUpdated && (
            <div className="mt-2 text-right text-[12px] text-slate-400">
              Posted ledger entries only · Updated {lastUpdated.toLocaleTimeString()}
            </div>
          )}
        </div>

        {!loading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="block text-[12px] font-bold uppercase tracking-wide text-slate-500">
                Accounts
              </span>
              <span className="mt-1 block text-xl font-bold text-slate-900">{rows.length}</span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="block text-[12px] font-bold uppercase tracking-wide text-slate-500">
                Closing Debit
              </span>
              <span className="mt-1 block font-mono text-base font-bold text-blue-700">
                {formatCurrency(totals.closingDebit)}
              </span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="block text-[12px] font-bold uppercase tracking-wide text-slate-500">
                Closing Credit
              </span>
              <span className="mt-1 block font-mono text-base font-bold text-rose-700">
                {formatCurrency(totals.closingCredit)}
              </span>
            </div>
            <div className={`rounded-xl border p-4 shadow-sm ${isBalanced ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50"}`}>
              <span className="block text-[12px] font-bold uppercase tracking-wide text-slate-500">
                Closing Difference
              </span>
              <span className={`mt-1 block font-mono text-base font-bold ${isBalanced ? "text-emerald-700" : "text-rose-700"}`}>
                {formatCurrency(closingDifference)}
              </span>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="p-16 text-center text-slate-400">Loading Trial Balance...</div>
          ) : rows.length === 0 ? (
            <div className="p-16 text-center text-slate-400">
              No posted transactions found for the selected period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1250px] text-xs">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-900 text-white">
                    <th rowSpan={2} className="px-3 py-3 text-left font-semibold">Code</th>
                    <th rowSpan={2} className="px-3 py-3 text-left font-semibold">Account Name</th>
                    <th rowSpan={2} className="px-3 py-3 text-left font-semibold">Type</th>
                    <th colSpan={2} className="border-l border-slate-700 px-3 py-2 text-center font-semibold">Opening Balance</th>
                    <th colSpan={2} className="border-l border-slate-700 px-3 py-2 text-center font-semibold">Period Movement</th>
                    <th colSpan={2} className="border-l border-slate-700 px-3 py-2 text-center font-semibold">Closing Balance</th>
                  </tr>
                  <tr className="border-b border-slate-300 bg-slate-800 text-slate-200">
                    {['Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit'].map((label, index) => (
                      <th key={`${label}-${index}`} className="border-l border-slate-700 px-3 py-2 text-right font-semibold">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-mono font-semibold text-slate-900">{row.code}</td>
                      <td className="px-3 py-2.5 text-slate-800">{row.name}</td>
                      <td className="px-3 py-2.5 text-[12px] font-semibold uppercase text-slate-500">{row.type}</td>
                      <td className="border-l border-slate-100 px-3 py-2.5 text-right font-mono">{amountCell(row.openingDebit)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{amountCell(row.openingCredit)}</td>
                      <td className="border-l border-slate-100 px-3 py-2.5 text-right font-mono">{amountCell(row.periodDebit)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{amountCell(row.periodCredit)}</td>
                      <td className="border-l border-slate-100 px-3 py-2.5 text-right font-mono font-semibold text-blue-700">{amountCell(row.closingDebit)}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-rose-700">{amountCell(row.closingCredit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-900 bg-slate-100 font-bold text-slate-900">
                    <td colSpan={3} className="px-3 py-3 text-sm uppercase">Total</td>
                    <td className="border-l border-slate-300 px-3 py-3 text-right font-mono">{formatCurrency(totals.openingDebit)}</td>
                    <td className="px-3 py-3 text-right font-mono">{formatCurrency(totals.openingCredit)}</td>
                    <td className="border-l border-slate-300 px-3 py-3 text-right font-mono">{formatCurrency(totals.periodDebit)}</td>
                    <td className="px-3 py-3 text-right font-mono">{formatCurrency(totals.periodCredit)}</td>
                    <td className="border-l border-slate-300 px-3 py-3 text-right font-mono text-blue-700">{formatCurrency(totals.closingDebit)}</td>
                    <td className="px-3 py-3 text-right font-mono text-rose-700">{formatCurrency(totals.closingCredit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {!loading && (
          <div className={`flex flex-col items-start justify-between gap-3 rounded-xl border-2 p-4 sm:flex-row sm:items-center ${isBalanced ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50"}`}>
            <div>
              <span className="block font-bold text-slate-900">Trial Balance Control Check</span>
              <span className="text-xs text-slate-500">
                Opening difference {formatCurrency(openingDifference)} · Period difference {formatCurrency(periodDifference)}
              </span>
            </div>
            <div className="text-left sm:text-right">
              <span className="block font-mono text-lg font-bold text-slate-900">
                Closing Difference: {formatCurrency(closingDifference)}
              </span>
              <span className={`text-xs font-bold ${isBalanced ? "text-emerald-700" : "text-rose-700"}`}>
                {isBalanced ? "Balanced" : "Out of Balance"}
              </span>
            </div>
          </div>
        )}
      </div>

      {reportPrintSettings && (
        <div className="hidden print:block mt-8 border-t border-slate-300 pt-3 text-xs text-slate-500">
          {reportPrintSettings.visibility.show_footer &&
            (reportPrintSettings.company.document_footer ||
              reportPrintSettings.company.document_footer_urdu) && (
              <div className="text-center">
                {reportPrintSettings.company.document_footer}
                {reportPrintSettings.company.document_footer_urdu && (
                  <div>{reportPrintSettings.company.document_footer_urdu}</div>
                )}
              </div>
            )}

          {reportPrintSettings.visibility.show_signatures && (
            <div className="mt-10 flex justify-between text-slate-700">
              <span>
                {reportPrintSettings.company.prepared_by_label || "Prepared By"}
              </span>
              <span>
                {reportPrintSettings.company.checked_by_label || "Checked By"}
              </span>
              <span>
                {reportPrintSettings.company.approved_by_label || "Approved By"}
              </span>
            </div>
          )}

          {reportPrintSettings.visibility.show_print_datetime && (
            <div className="mt-4">
              Printed: {new Date().toLocaleString("en-PK")}
            </div>
          )}

          {reportPrintSettings.visibility.show_page_numbers && (
            <div className="text-right">Page</div>
          )}
        </div>
      )}
    </div>
  );
}
