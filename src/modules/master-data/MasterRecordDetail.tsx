import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Boxes, Mail, MapPin, Package, Phone, Truck, UserRound } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";

type Entity = "item" | "customer" | "supplier";
type RecordRow = Record<string, unknown>;

const CONFIG: Record<Entity, { table: string; listRoute: string; title: string }> = {
  item: { table: "items", listRoute: "/master-data", title: "Item Detail" },
  customer: { table: "customers", listRoute: "/master-data/customers", title: "Customer Detail" },
  supplier: { table: "suppliers", listRoute: "/master-data/suppliers", title: "Supplier Detail" },
};

const value = (v: unknown) => String(v ?? "").trim();
const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 2 })}` : "—";
};

export default function MasterRecordDetail({ entity }: { entity: Entity }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const config = CONFIG[entity];
  const [row, setRow] = useState<RecordRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!id) { setError("Record ID missing."); setLoading(false); return; }
      setLoading(true); setError(null);
      const { data, error } = await supabase.from(config.table).select("*").eq("id", id).maybeSingle();
      if (cancelled) return;
      if (error) { setError(error.message); setRow(null); }
      else if (!data) { setError("Record not found or you do not have access."); setRow(null); }
      else setRow(data as RecordRow);
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [config.table, id]);

  const fields = useMemo(() => {
    if (!row) return [] as Array<{ label: string; value: string; icon?: typeof Package }>;
    if (entity === "item") return [
      { label: "SKU", value: value(row.sku) || "—", icon: Package },
      { label: "Name", value: value(row.name) || "—" },
      { label: "Type", value: value(row.type) || "—" },
      { label: "Grade", value: value(row.grade) || "—" },
      { label: "Size", value: value(row.size) || "—" },
      { label: "Unit", value: value(row.unit) || "—" },
      { label: "Cost", value: money(row.cost) },
      { label: "Sale Price", value: money(row.price) },
    ];
    return [
      { label: "Name", value: value(row.name) || "—", icon: entity === "customer" ? UserRound : Truck },
      { label: "Phone", value: value(row.phone) || "—", icon: Phone },
      { label: "Email", value: value(row.email) || "—", icon: Mail },
      { label: "Address", value: value(row.address) || "—", icon: MapPin },
    ];
  }, [entity, row]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" /></button>
          <div><h2 className="text-lg font-black text-slate-950">{config.title}</h2><p className="text-xs font-semibold text-slate-500">Opened directly from Global Search.</p></div>
        </div>
        <button type="button" onClick={() => navigate(config.listRoute)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-4 text-xs font-black text-white hover:bg-slate-800"><Boxes className="h-4 w-4" /> Open Master List</button>
      </div>

      {loading ? <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-500">Loading record…</div> : error ? <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700">{error}</div> : row ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 border-b border-slate-100 pb-4"><div className="text-[11px] font-black uppercase tracking-wider text-slate-400">Record</div><div className="mt-1 text-2xl font-black text-slate-950">{value(row.name) || value(row.sku) || "Record"}</div>{entity === "item" && value(row.sku) && <div className="mt-1 text-xs font-bold text-slate-500">{value(row.sku)}</div>}</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map((field) => { const Icon = field.icon; return <div key={field.label} className="rounded-lg border border-slate-100 bg-slate-50 p-4"><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-slate-400">{Icon && <Icon className="h-3.5 w-3.5" />}{field.label}</div><div className="mt-2 break-words text-sm font-black text-slate-900">{field.value}</div></div>; })}</div>
        </div>
      ) : null}
    </div>
  );
}
