import { useEffect, useMemo, useRef, useState } from "react";

export interface BulkAction<T> { key: string; label: string; onClick: (rows: T[]) => void | Promise<void>; danger?: boolean; disabled?: boolean; }

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
}

type Density = "compact" | "comfortable" | "spacious";
type PinSide = "left" | "right" | null;
type ViewPrefs = {
  order: string[];
  widths: Record<string, number>;
  pins: Record<string, PinSide>;
  density: Density;
  hidden: string[];
  sort: { key: string; dir: "asc" | "desc" } | null;
  sorts?: { key: string; dir: "asc" | "desc" }[];
  pageSize: number;
};

function storageKey(columns: { key: string }[]) {
  const path = typeof window === "undefined" ? "unknown" : window.location.pathname;
  return `navilo:table-columns:${path}:${columns.map((column) => column.key).join("|")}`;
}
function prefsKey(columns: { key: string }[]) { return `${storageKey(columns)}:neus-v3`; }
function viewsKey(columns: { key: string }[]) { return `${storageKey(columns)}:views-v3`; }

function restoredHiddenKeys(raw: string | null, configurable: { key: string }[]): Set<string> {
  try {
    const saved = JSON.parse(raw || "[]");
    const keys = new Set(configurable.map((column) => column.key));
    const hidden = new Set<string>(Array.isArray(saved) ? saved.map(String).filter((key) => keys.has(key)) : []);
    if (configurable.length > 0 && configurable.every((column) => hidden.has(column.key))) hidden.delete(configurable[0].key);
    return hidden;
  } catch { return new Set(); }
}

function defaultPrefs<T>(columns: Column<T>[]): ViewPrefs {
  return { order: columns.map(c => c.key), widths: {}, pins: {}, density: "comfortable", hidden: [], sort: null, sorts: [], pageSize: 25 };
}
function readPrefs<T>(columns: Column<T>[]): ViewPrefs {
  const fallback = defaultPrefs(columns);
  if (typeof window === "undefined") return fallback;
  try {
    const raw = JSON.parse(window.localStorage.getItem(prefsKey(columns)) || "{}");
    const valid = new Set(columns.map(c => c.key));
    const order = Array.isArray(raw.order) ? raw.order.map(String).filter((k: string) => valid.has(k)) : [];
    return {
      ...fallback, ...raw,
      order: [...order, ...columns.map(c => c.key).filter(k => !order.includes(k))],
      widths: raw.widths && typeof raw.widths === "object" ? raw.widths : {},
      pins: raw.pins && typeof raw.pins === "object" ? raw.pins : {},
      density: ["compact","comfortable","spacious"].includes(raw.density) ? raw.density : "comfortable",
      pageSize: [25,50,100,250].includes(Number(raw.pageSize)) ? Number(raw.pageSize) : 25,
      sort: raw.sort && valid.has(raw.sort.key) ? raw.sort : null,
      sorts: Array.isArray(raw.sorts) ? raw.sorts.filter((x: {key?: string; dir?: string}) => x && valid.has(String(x.key)) && (x.dir === "asc" || x.dir === "desc")) : (raw.sort && valid.has(raw.sort.key) ? [raw.sort] : []),
    };
  } catch { return fallback; }
}

export default function DataTable<T extends { id: string }>({
  columns, rows, loading, emptyMessage, onSelectionChange, bulkActions = [],
}: { columns: Column<T>[]; rows: T[]; loading?: boolean; emptyMessage?: string; onSelectionChange?: (rows: T[]) => void; bulkActions?: BulkAction<T>[] }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const configurableColumns = useMemo(() => columns.filter(c => c.key !== "actions" && c.key !== "action"), [columns]);
  const key = useMemo(() => storageKey(columns), [columns]);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : restoredHiddenKeys(window.localStorage.getItem(storageKey(columns)), configurableColumns)
  );
  const [prefs, setPrefs] = useState<ViewPrefs>(() => readPrefs(columns));
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [viewName, setViewName] = useState("");
  const [savedViews, setSavedViews] = useState<Record<string, ViewPrefs>>(() => {
    try { return JSON.parse(window.localStorage.getItem(viewsKey(columns)) || "{}"); } catch { return {}; }
  });

  useEffect(() => {
    setHiddenKeys(restoredHiddenKeys(window.localStorage.getItem(key), configurableColumns));
    setPrefs(readPrefs(columns));
  }, [key, configurableColumns, columns]);

  useEffect(() => {
    const openCustomizer = () => {
      const firstTable = document.querySelector<HTMLElement>("[data-navilo-data-table]");
      if (firstTable === rootRef.current) setCustomizeOpen(true);
    };
    window.addEventListener("navilo:report-customize", openCustomizer);
    return () => window.removeEventListener("navilo:report-customize", openCustomizer);
  }, []);

  const savePrefs = (next: ViewPrefs) => {
    setPrefs(next);
    try { window.localStorage.setItem(prefsKey(columns), JSON.stringify(next)); } catch {}
  };
  const persistHidden = (next: Set<string>) => {
    setHiddenKeys(next);
    try { window.localStorage.setItem(key, JSON.stringify([...next])); } catch {}
    savePrefs({ ...prefs, hidden: [...next] });
  };
  const toggleColumn = (columnKey: string) => {
    const next = new Set(hiddenKeys);
    if (next.has(columnKey)) next.delete(columnKey);
    else {
      if (configurableColumns.filter(c => !next.has(c.key)).length <= 1) return;
      next.add(columnKey);
    }
    persistHidden(next);
  };

  useEffect(() => { setPage(1); setSelected(new Set()); }, [rows.length, prefs.pageSize]);
  useEffect(() => {
    const selectedRows = rows.filter(row => selected.has(row.id));
    onSelectionChange?.(selectedRows);
    if (!rootRef.current) return;
    rootRef.current.dataset.naviloSelectedCount = String(selectedRows.length);
    rootRef.current.dataset.naviloExportScope = selectedRows.length ? "selected" : "filtered";
    const event = new CustomEvent("navilo:table-selection-changed", { detail: { selectedIds: selectedRows.map(row => row.id), selectedCount: selectedRows.length } });
    window.dispatchEvent(event);
  }, [selected, rows, onSelectionChange]);

  const orderedColumns = useMemo(() => {
    const rank = new Map(prefs.order.map((k, i) => [k, i]));
    return [...columns].sort((a,b) => (rank.get(a.key) ?? 9999) - (rank.get(b.key) ?? 9999));
  }, [columns, prefs.order]);

  const visibleColumns = orderedColumns.filter(c => c.key === "actions" || c.key === "action" || !hiddenKeys.has(c.key));
  const activeSorts = prefs.sorts?.length ? prefs.sorts : prefs.sort ? [prefs.sort] : [];
  const sortedRows = useMemo(() => {
    if (!activeSorts.length) return rows;
    return [...rows].sort((a,b) => {
      for (const { key: sortKey, dir } of activeSorts) {
        const d = dir === "asc" ? 1 : -1;
        const result = String((a as Record<string,unknown>)[sortKey] ?? "").localeCompare(
          String((b as Record<string,unknown>)[sortKey] ?? ""), undefined, { numeric: true, sensitivity: "base" }
        ) * d;
        if (result) return result;
      }
      return 0;
    });
  }, [rows, activeSorts]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / prefs.pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = sortedRows.slice((safePage - 1) * prefs.pageSize, safePage * prefs.pageSize);
  const allPageSelected = pagedRows.length > 0 && pagedRows.every(row => selected.has(row.id));
  const rowPad = prefs.density === "compact" ? "py-1.5" : prefs.density === "spacious" ? "py-4" : "py-3";
  const selectedRows = useMemo(() => rows.filter(row => selected.has(row.id)), [rows, selected]);

  const reorder = (from: string, to: string) => {
    if (from === to) return;
    const next = prefs.order.filter(k => k !== from);
    const at = next.indexOf(to);
    next.splice(at < 0 ? next.length : at, 0, from);
    savePrefs({ ...prefs, order: next });
  };
  const beginResize = (columnKey: string, startX: number, startWidth: number) => {
    const move = (event: MouseEvent) => setPrefs(current => {
      const next = { ...current, widths: { ...current.widths, [columnKey]: Math.max(90, startWidth + event.clientX - startX) } };
      try { window.localStorage.setItem(prefsKey(columns), JSON.stringify(next)); } catch {}
      return next;
    });
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const pin = (columnKey: string, side: PinSide) => savePrefs({ ...prefs, pins: { ...prefs.pins, [columnKey]: side } });

  const pinOffsets = useMemo(() => {
    const left: Record<string, number> = {}, right: Record<string, number> = {};
    let l = 40, r = 0;
    for (const c of visibleColumns) if (prefs.pins[c.key] === "left") { left[c.key] = l; l += prefs.widths[c.key] || 160; }
    for (const c of [...visibleColumns].reverse()) if (prefs.pins[c.key] === "right") { right[c.key] = r; r += prefs.widths[c.key] || 160; }
    return { left, right };
  }, [visibleColumns, prefs.pins, prefs.widths]);
  const stickyStyle = (key: string): React.CSSProperties => prefs.pins[key] === "left"
    ? { position:"sticky", left:pinOffsets.left[key], zIndex:12, background:"white" }
    : prefs.pins[key] === "right"
      ? { position:"sticky", right:pinOffsets.right[key], zIndex:12, background:"white" } : {};

  if (loading) return <div role="status" className="card p-12 text-center text-slate-600">Loading records…</div>;
  if (rows.length === 0) return <div role="status" className="card p-12 text-center text-slate-600">{emptyMessage ?? "No records yet."}</div>;

  return <>
    <div ref={rootRef} className="card overflow-hidden" data-report-content data-navilo-data-table data-neus-grid="true" data-navilo-selected-count={selected.size}>
      {selectedRows.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2" data-no-print data-no-export data-navilo-bulk-actions>
        <span className="text-xs font-semibold text-slate-700">{selectedRows.length} selected</span>
        <div className="flex flex-wrap items-center gap-2">
          {bulkActions.map(action => <button key={action.key} type="button" disabled={action.disabled} className={action.danger ? "btn-secondary text-red-600" : "btn-secondary"} onClick={()=>void action.onClick(selectedRows)}>{action.label}</button>)}
          <button type="button" className="btn-secondary" onClick={()=>setSelected(new Set())}>Clear selection</button>
        </div>
      </div>}
      <div className="max-h-[65vh] overflow-auto">
        <table aria-label="ERP records" className="w-full min-w-max text-sm print:min-w-0">
          <thead className="sticky top-0 z-20">
            <tr className="border-b border-slate-200 bg-slate-50">
              <th aria-label="Select rows" className="sticky left-0 z-30 w-10 bg-slate-50 px-3" data-no-print data-no-export>
                <input aria-label="Select all rows on page" type="checkbox" checked={allPageSelected} onChange={() => {
                  const next = new Set(selected); pagedRows.forEach(row => allPageSelected ? next.delete(row.id) : next.add(row.id)); setSelected(next);
                }}/>
              </th>
              {visibleColumns.map(col => {
                const action = col.key === "actions" || col.key === "action";
                return <th key={col.key} aria-label={col.label} draggable={!action}
                  onDragStart={() => setDragKey(col.key)} onDragOver={e => e.preventDefault()}
                  onDrop={() => { if (dragKey) reorder(dragKey,col.key); setDragKey(null); }}
                  data-no-print={action || undefined} data-no-export={action || undefined}
                  style={{ width:prefs.widths[col.key], minWidth:prefs.widths[col.key], ...stickyStyle(col.key) }}
                  className={`relative select-none bg-slate-50 px-4 py-3 text-left font-medium text-slate-600 ${col.className ?? ""}`}>
                  <button type="button" className="inline-flex items-center gap-1 text-left"
                    disabled={action || col.sortable === false}
                    title={!action ? "Click to sort; Shift+Click for multi-column sort" : undefined}
                    onClick={(event) => {
                      if (action || col.sortable === false) return;
                      const current = activeSorts;
                      const existing = current.find(x => x.key === col.key);
                      const nextSpec = { key: col.key, dir: existing?.dir === "asc" ? "desc" as const : "asc" as const };
                      const sorts = event.shiftKey ? [...current.filter(x => x.key !== col.key), nextSpec] : [nextSpec];
                      savePrefs({ ...prefs, sort: sorts[0] ?? null, sorts });
                    }}>
                    <span className={!action ? "cursor-grab" : ""}>{col.label}</span>
                    {activeSorts.some(x=>x.key===col.key) ? <span aria-hidden="true">{activeSorts.find(x=>x.key===col.key)?.dir === "asc" ? "↑" : "↓"}{activeSorts.length>1 ? activeSorts.findIndex(x=>x.key===col.key)+1 : ""}</span> : null}
                  </button>
                  {!action ? <span aria-hidden="true" className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-slate-300"
                    role="separator" tabIndex={0} aria-label={`Resize ${col.label} column`}
                    onKeyDown={e=>{if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();const width=prefs.widths[col.key]||e.currentTarget.parentElement?.getBoundingClientRect().width||160;savePrefs({...prefs,widths:{...prefs.widths,[col.key]:Math.max(90,width+(e.key==="ArrowRight"?10:-10))}})}}
                    onMouseDown={e => { e.preventDefault(); beginResize(col.key,e.clientX,e.currentTarget.parentElement?.getBoundingClientRect().width || 160); }}/> : null}
                </th>;
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pagedRows.map(row => <tr key={row.id} className={`transition-colors hover:bg-slate-50 ${selected.has(row.id) ? "bg-slate-50" : ""}`}>
              <td className={`sticky left-0 z-10 bg-white px-3 ${rowPad}`} data-no-print data-no-export>
                <input aria-label="Select row" type="checkbox" checked={selected.has(row.id)} onChange={() => {
                  const next = new Set(selected); next.has(row.id) ? next.delete(row.id) : next.add(row.id); setSelected(next);
                }}/>
              </td>
              {visibleColumns.map(col => {
                const action = col.key === "actions" || col.key === "action";
                return <td key={col.key} data-no-print={action || undefined} data-no-export={action || undefined}
                  style={{ width:prefs.widths[col.key], minWidth:prefs.widths[col.key], ...stickyStyle(col.key) }}
                  className={`px-4 ${rowPad} text-slate-700 ${col.className ?? ""}`}>
                  {col.render ? col.render(row) : (row as Record<string,unknown>)[col.key] as React.ReactNode}
                </td>;
              })}
            </tr>)}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3" data-no-print data-no-export>
        <div className="text-xs text-slate-500">
          Showing {(safePage-1)*prefs.pageSize+1}–{Math.min(safePage*prefs.pageSize,sortedRows.length)} of {sortedRows.length}
          {selected.size ? <span className="ml-3 font-semibold">{selected.size} selected · <button type="button" className="underline" onClick={() => setSelected(new Set())}>Clear</button></span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Table density" className="input h-8 min-h-8 w-auto py-0 text-xs" value={prefs.density} onChange={e => savePrefs({ ...prefs, density:e.target.value as Density })}>
            <option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option>
          </select>
          <select aria-label="Rows per page" className="input h-8 min-h-8 w-auto py-0 text-xs" value={prefs.pageSize} onChange={e => savePrefs({ ...prefs, pageSize:Number(e.target.value) })}>
            {[25,50,100,250].map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <button type="button" className="btn-secondary h-8 min-h-8 px-2 text-xs" disabled={safePage<=1} onClick={()=>setPage(1)}>First</button>
          <button type="button" className="btn-secondary h-8 min-h-8 px-2 text-xs" disabled={safePage<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</button>
          <span className="text-xs font-semibold text-slate-600">{safePage} / {totalPages}</span>
          <button type="button" className="btn-secondary h-8 min-h-8 px-2 text-xs" disabled={safePage>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Next</button>
          <button type="button" className="btn-secondary h-8 min-h-8 px-2 text-xs" disabled={safePage>=totalPages} onClick={()=>setPage(totalPages)}>Last</button>
        </div>
      </div>
    </div>

    {customizeOpen && <div role="dialog" aria-modal="true" aria-label="Customize table columns" className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/30 p-4" data-no-print data-no-export>
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div><h3 className="text-base font-bold text-slate-900">Customize Table</h3><p className="mt-1 text-xs text-slate-500">Show, hide, reorder, resize, pin and save your view.</p></div>
          <button type="button" className="btn-secondary" onClick={()=>setCustomizeOpen(false)}>Close</button>
        </div>
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
          <span className="text-xs font-semibold text-slate-500">{configurableColumns.filter(c=>!hiddenKeys.has(c.key)).length} visible</span>
          <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={()=>persistHidden(new Set())}>Select All</button>
          <button type="button" className="btn-secondary" onClick={()=>{const keep=configurableColumns[0]?.key;persistHidden(new Set(configurableColumns.filter(c=>c.key!==keep).map(c=>c.key)))}}>Clear All</button></div>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-5">
          {configurableColumns.map(column => <div key={column.key} draggable onDragStart={()=>setDragKey(column.key)} onDragOver={e=>e.preventDefault()} onDrop={()=>{if(dragKey)reorder(dragKey,column.key);setDragKey(null)}} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-slate-50">
            <span className="cursor-grab text-slate-400" aria-hidden="true">⋮⋮</span>
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
              <input type="checkbox" aria-label={column.label || column.key} checked={!hiddenKeys.has(column.key)}
                disabled={!hiddenKeys.has(column.key) && configurableColumns.filter(c=>!hiddenKeys.has(c.key)).length===1}
                onChange={()=>toggleColumn(column.key)}/>
              <span className="min-w-0 flex-1 text-slate-700">{column.label || column.key}</span>
            </label>
            <button type="button" className="btn-secondary h-7 px-2 text-xs" onClick={()=>pin(column.key,prefs.pins[column.key]==="left"?null:"left")}>{prefs.pins[column.key]==="left"?"Unpin":"Pin L"}</button>
            <button type="button" className="btn-secondary h-7 px-2 text-xs" onClick={()=>pin(column.key,prefs.pins[column.key]==="right"?null:"right")}>{prefs.pins[column.key]==="right"?"Unpin":"Pin R"}</button>
          </div>)}
          <div className="mt-4 border-t border-slate-200 pt-4">
            <div className="flex gap-2"><input className="input flex-1" placeholder="Saved view name" value={viewName} onChange={e=>setViewName(e.target.value)}/>
              <button type="button" className="btn-primary" onClick={()=>{const name=viewName.trim();if(!name)return;const snap={...prefs,hidden:[...hiddenKeys]};const next={...savedViews,[name]:snap};setSavedViews(next);try{window.localStorage.setItem(viewsKey(columns),JSON.stringify(next))}catch{}setViewName("")}}>Save View</button>
            </div>
            {Object.keys(savedViews).length ? <div className="mt-2 flex flex-wrap gap-2">{Object.keys(savedViews).map(name=><button type="button" key={name} className="btn-secondary text-xs" onClick={()=>{const v=savedViews[name];savePrefs(v);persistHidden(restoredHiddenKeys(JSON.stringify(v.hidden),configurableColumns))}}>{name}</button>)}</div> : null}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white p-5">
          <button type="button" className="btn-secondary" onClick={()=>{try{window.localStorage.removeItem(key);window.localStorage.removeItem(prefsKey(columns))}catch{}persistHidden(new Set());savePrefs(defaultPrefs(columns))}}>Reset Default</button>
          <button type="button" className="btn-primary" onClick={()=>setCustomizeOpen(false)}>Done</button>
        </div>
      </div>
    </div>}
  </>;
}
