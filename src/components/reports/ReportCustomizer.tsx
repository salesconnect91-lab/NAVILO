import NaviloSearchableSelect from "@/components/SearchableSelect";
import { useMemo, useState } from "react";

export type ReportColumn = {
  key: string;
  label: string;
  defaultVisible?: boolean;
};

export type ReportCustomizeState = {
  visibleColumns: string[];
  density: "compact" | "standard";
  orientation: "portrait" | "landscape";
  showTotals: boolean;
  showFilters: boolean;
};

type Props = {
  columns: ReportColumn[];
  value: ReportCustomizeState;
  onChange: (value: ReportCustomizeState) => void;
};

export function defaultReportCustomizeState(columns: ReportColumn[]): ReportCustomizeState {
  return {
    visibleColumns: columns.filter((column) => column.defaultVisible !== false).map((column) => column.key),
    density: "compact",
    orientation: "landscape",
    showTotals: true,
    showFilters: true,
  };
}

export default function ReportCustomizer({ columns, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const visible = useMemo(() => new Set(value.visibleColumns), [value.visibleColumns]);
  const patch = (next: Partial<ReportCustomizeState>) => onChange({ ...value, ...next });
  const toggleColumn = (key: string) => {
    const next = new Set(visible);
    if (next.has(key)) next.delete(key); else next.add(key);
    patch({ visibleColumns: columns.map((column) => column.key).filter((columnKey) => next.has(columnKey)) });
  };

  return (
    <div className="relative print:hidden">
      <button type="button" className="btn btn-secondary" onClick={() => setOpen((current) => !current)}>Customize Report</button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <strong>Columns & Print</strong>
            <button type="button" className="text-xs text-slate-500" onClick={() => patch(defaultReportCustomizeState(columns))}>Reset</button>
          </div>
          <div className="max-h-56 space-y-2 overflow-auto">
            {columns.map((column) => (
              <label key={column.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={visible.has(column.key)} onChange={() => toggleColumn(column.key)} />
                <span>{column.label}</span>
              </label>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <label>Density<NaviloSearchableSelect nativeCompatibility preserveLabel className="input mt-1" value={value.density} onChange={(event) => patch({ density: event.target.value as ReportCustomizeState["density"] })}><option value="compact">Compact</option><option value="standard">Standard</option></NaviloSearchableSelect></label>
            <label>Orientation<NaviloSearchableSelect nativeCompatibility preserveLabel className="input mt-1" value={value.orientation} onChange={(event) => patch({ orientation: event.target.value as ReportCustomizeState["orientation"] })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></NaviloSearchableSelect></label>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={value.showTotals} onChange={(event) => patch({ showTotals: event.target.checked })} /> Show totals</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={value.showFilters} onChange={(event) => patch({ showFilters: event.target.checked })} /> Print applied filters</label>
          </div>
        </div>
      )}
    </div>
  );
}
