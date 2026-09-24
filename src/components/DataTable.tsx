import { useEffect, useMemo, useRef, useState } from "react";

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

function storageKey(columns: { key: string }[]) {
  const path = typeof window === "undefined" ? "unknown" : window.location.pathname;
  return `navilo:table-columns:${path}:${columns.map((column) => column.key).join("|")}`;
}

function restoredHiddenKeys(raw: string | null, configurable: { key: string }[]): Set<string> {
  try {
    const saved = JSON.parse(raw || "[]");
    const keys = new Set(configurable.map((column) => column.key));
    const hidden = new Set<string>(Array.isArray(saved) ? saved.map(String).filter((key) => keys.has(key)) : []);
    // Older preferences may have hidden every column. A report must keep at
    // least one data column visible on screen, in exports and in print.
    if (configurable.length > 0 && configurable.every((column) => hidden.has(column.key))) hidden.delete(configurable[0].key);
    return hidden;
  } catch {
    return new Set();
  }
}

export default function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  emptyMessage,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyMessage?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const configurableColumns = useMemo(
    () => columns.filter((column) => column.key !== "actions" && column.key !== "action"),
    [columns]
  );
  const key = useMemo(() => storageKey(columns), [columns]);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    return restoredHiddenKeys(window.localStorage.getItem(storageKey(columns)), configurableColumns);
  });
  const [customizeOpen, setCustomizeOpen] = useState(false);

  useEffect(() => {
    setHiddenKeys(restoredHiddenKeys(window.localStorage.getItem(key), configurableColumns));
  }, [key, configurableColumns]);

  useEffect(() => {
    const openCustomizer = () => {
      const firstTable = document.querySelector<HTMLElement>("[data-navilo-data-table]");
      if (firstTable === rootRef.current) setCustomizeOpen(true);
    };
    window.addEventListener("navilo:report-customize", openCustomizer);
    return () => window.removeEventListener("navilo:report-customize", openCustomizer);
  }, []);

  const persist = (next: Set<string>) => {
    setHiddenKeys(next);
    try {
      window.localStorage.setItem(key, JSON.stringify([...next]));
    } catch {
      // Local storage is an enhancement only; table customization still works in-memory.
    }
  };

  const toggleColumn = (columnKey: string) => {
    const next = new Set(hiddenKeys);
    if (next.has(columnKey)) next.delete(columnKey);
    else {
      if (configurableColumns.filter((column) => !next.has(column.key)).length <= 1) return;
      next.add(columnKey);
    }
    persist(next);
  };

  const visibleColumns = columns.filter(
    (column) => column.key === "actions" || column.key === "action" || !hiddenKeys.has(column.key)
  );

  if (loading) {
    return <div role="status" className="card p-12 text-center text-slate-600">Loading records…</div>;
  }

  if (rows.length === 0) {
    return <div role="status" className="card p-12 text-center text-slate-600">{emptyMessage ?? "No records yet."}</div>;
  }

  return (
    <>
      <div ref={rootRef} className="card overflow-hidden" data-report-content data-navilo-data-table>
        <div className="overflow-x-auto">
          <table aria-label="ERP records" className="w-full min-w-max text-sm print:min-w-0">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {visibleColumns.map((col) => {
                  const actionColumn = col.key === "actions" || col.key === "action";
                  return (
                    <th
                      key={col.key}
                      data-no-print={actionColumn ? true : undefined}
                      data-no-export={actionColumn ? true : undefined}
                      className={`text-left px-4 py-3 font-medium text-slate-600 ${col.className ?? ""}`}
                    >
                      {col.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                  {visibleColumns.map((col) => {
                    const actionColumn = col.key === "actions" || col.key === "action";
                    return (
                      <td
                        key={col.key}
                        data-no-print={actionColumn ? true : undefined}
                        data-no-export={actionColumn ? true : undefined}
                        className={`px-4 py-3 text-slate-700 ${col.className ?? ""}`}
                      >
                        {col.render ? col.render(row) : (row as Record<string, unknown>)[col.key] as React.ReactNode}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {customizeOpen && (
        <div role="dialog" aria-modal="true" aria-label="Customize table columns" className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/30 p-4" data-no-print data-no-export>
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Customize Columns</h3>
                <p className="mt-1 text-xs text-slate-500">Choose which columns appear on screen, print and export.</p>
              </div>
              <button type="button" className="btn-secondary" onClick={() => setCustomizeOpen(false)}>Close</button>
            </div>

            <div className="mt-4 max-h-[50vh] space-y-1 overflow-auto rounded-lg border border-slate-200 p-2">
              {configurableColumns.map((column) => (
                <label key={column.key} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={!hiddenKeys.has(column.key)}
                    disabled={!hiddenKeys.has(column.key) && configurableColumns.filter((candidate) => !hiddenKeys.has(candidate.key)).length === 1}
                    onChange={() => toggleColumn(column.key)}
                  />
                  <span className="min-w-0 flex-1 text-slate-700">{column.label || column.key}</span>
                </label>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button type="button" className="btn-secondary" onClick={() => persist(new Set())}>Show All</button>
              <button type="button" className="btn-primary" onClick={() => setCustomizeOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
