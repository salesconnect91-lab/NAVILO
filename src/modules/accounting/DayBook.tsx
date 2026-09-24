import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, FilePlus2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import DataTable, { Column } from "@/components/DataTable";
import { ErrorBanner, PageHeader, formatCurrency, formatDate } from "@/components/ui";
import { exportToCSV, exportToExcel } from "@/lib/exportUtils";

interface PostedEntry {
  id: string;
  entry_no: string;
  entry_date: string;
  description: string | null;
  status: "posted";
}

interface DayBookLine {
  id: string;
  entry_id: string;
  account: string | null;
  debit: number;
  credit: number;
  coa?: { code: string; name: string } | null;
}

interface DayBookRow {
  id: string;
  entry_id: string;
  entry_no: string;
  entry_date: string;
  description: string;
  account: string;
  debit: number;
  credit: number;
}

const exportColumns = [
  { key: "entry_no", label: "Entry No" },
  { key: "entry_date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "account", label: "Account" },
  { key: "debit", label: "Debit" },
  { key: "credit", label: "Credit" },
];

export default function DayBook() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<PostedEntry[]>([]);
  const [lines, setLines] = useState<DayBookLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterDate, setFilterDate] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("journal_entries")
        .select("id, entry_no, entry_date, description, status")
        .eq("status", "posted")
        .order("entry_date", { ascending: false })
        .order("entry_no", { ascending: false });

      if (filterDate) query = query.eq("entry_date", filterDate);

      const { data, error: entryError } = await query;
      if (entryError) throw new Error(entryError.message);

      const postedEntries = (data ?? []) as PostedEntry[];
      setEntries(postedEntries);
      const entryIds = postedEntries.map((entry) => entry.id);

      if (entryIds.length === 0) {
        setLines([]);
        return;
      }

      const { data: lineData, error: lineError } = await supabase
        .from("journal_lines")
        .select("id, entry_id, account, debit, credit, coa:chart_of_accounts(code,name)")
        .in("entry_id", entryIds);

      if (lineError) throw new Error(lineError.message);
      setLines((lineData ?? []) as unknown as DayBookLine[]);
    } catch (err) {
      setEntries([]);
      setLines([]);
      setError(err instanceof Error ? err.message : "Unable to load the Day Book.");
    } finally {
      setLoading(false);
    }
  }, [filterDate]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const rows = useMemo<DayBookRow[]>(() => {
    const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
    return lines.flatMap((line) => {
      const entry = entryMap.get(line.entry_id);
      if (!entry) return [];
      return [{
        id: line.id,
        entry_id: entry.id,
        entry_no: entry.entry_no,
        entry_date: entry.entry_date,
        description: entry.description ?? "",
        account: line.coa?.name || line.account || "Unlinked account",
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
      }];
    });
  }, [entries, lines]);

  const totals = useMemo(() => {
    const debit = rows.reduce((sum, row) => sum + row.debit, 0);
    const credit = rows.reduce((sum, row) => sum + row.credit, 0);
    return { debit, credit, difference: debit - credit };
  }, [rows]);

  const columns: Column<DayBookRow>[] = [
    {
      key: "entry_no",
      label: "Entry No",
      render: (row) => (
        <button className="font-semibold text-primary-600 hover:underline" onClick={() => navigate(`/accounting/${row.entry_id}`)}>
          {row.entry_no}
        </button>
      ),
    },
    { key: "entry_date", label: "Date", render: (row) => formatDate(row.entry_date) },
    { key: "description", label: "Description" },
    { key: "account", label: "Account", render: (row) => <span className="font-medium text-slate-700">{row.account}</span> },
    { key: "debit", label: "Debit", className: "text-right tabular-nums", render: (row) => row.debit > 0 ? formatCurrency(row.debit) : "—" },
    { key: "credit", label: "Credit", className: "text-right tabular-nums", render: (row) => row.credit > 0 ? formatCurrency(row.credit) : "—" },
  ];

  const exportRows = rows as unknown as Record<string, unknown>[];

  return (
    <div>
      <PageHeader
        title="Day Book"
        subtitle="Posted journal transactions only — draft and incomplete entries are excluded."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={() => navigate("/accounting")}>
              <FilePlus2 size={16} /> New Journal Entry
            </button>
            <input aria-label="Filter Day Book by date" className="input w-auto" type="date" value={filterDate} onChange={(event) => setFilterDate(event.target.value)} />
            <button className="btn-secondary" disabled={!filterDate} onClick={() => setFilterDate("")}>Clear</button>
            <button className="btn-secondary" disabled={rows.length === 0} onClick={() => exportToCSV("posted-day-book.csv", exportColumns, exportRows)}>CSV</button>
            <button className="btn-secondary" disabled={rows.length === 0} onClick={() => exportToExcel("posted-day-book.xls", exportColumns, exportRows)}>Excel</button>
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="mb-4 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <BookOpen className="mt-0.5 shrink-0" size={18} />
        <p>This is a read-only accounting report. Create, import, validate and post transactions from Journal Entries; only successfully posted lines appear here.</p>
      </div>

      <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No posted journal transactions found for the selected date." />

      {!loading && rows.length > 0 && (
        <div className="card mt-4 p-4">
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div><p className="text-slate-500">Total Debit</p><p className="mt-1 text-lg font-bold tabular-nums">{formatCurrency(totals.debit)}</p></div>
            <div><p className="text-slate-500">Total Credit</p><p className="mt-1 text-lg font-bold tabular-nums">{formatCurrency(totals.credit)}</p></div>
            <div><p className="text-slate-500">Difference</p><p className={`mt-1 text-lg font-bold tabular-nums ${Math.abs(totals.difference) < 0.01 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(totals.difference)}</p></div>
          </div>
        </div>
      )}
    </div>
  );
}
