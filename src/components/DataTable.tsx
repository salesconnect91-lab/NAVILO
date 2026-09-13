export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
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
  if (loading) {
    return <div className="card p-12 text-center text-slate-400">Loading… / لوڈ ہو رہا ہے…</div>;
  }

  if (rows.length === 0) {
    return <div className="card p-12 text-center text-slate-400">{emptyMessage ?? "No records yet."}</div>;
  }

  return (
    <div className="card overflow-hidden" data-report-content data-navilo-data-table>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {columns.map((col) => {
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
                {columns.map((col) => {
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
  );
}
